import { GetWorkspaceStateTool } from '../../../src/tools/vault';
import { ToolExecutionContext } from '../../../src/tools/types';

// Mock gemini-utils (needed by file-classification, imported by vault-tools)
vi.mock('@allenhutchison/gemini-utils', () => ({
	EXTENSION_TO_MIME: {
		'.md': 'text/markdown',
		'.txt': 'text/plain',
		'.html': 'text/html',
		'.py': 'text/x-python',
	},
	TEXT_FALLBACK_EXTENSIONS: new Set(['.ts', '.js', '.json', '.css', '.yaml']),
}));

// Mock ScribeFile
vi.mock('../../../src/files', () => ({
	ScribeFile: vi.fn().mockImplementation(function () {
		return {
			getUniqueLinks: vi.fn().mockReturnValue(new Set()),
			getLinkText: vi.fn((file: any) => `[[${file.name || file.path}]]`),
			getBacklinks: vi.fn().mockReturnValue(new Set()),
		};
	}),
}));

// Use the existing mock by extending it
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../../__mocks__/obsidian.js')),
	TFolder: class TFolder {
		path: string;
		name: string;
		children: any[];

		constructor() {
			this.path = '';
			this.name = '';
			this.children = [];
		}
	},
}));

// Import the mocked classes
import { TFile, MarkdownView } from 'obsidian';

const mockVault = {
	getAbstractFileByPath: vi.fn(),
	read: vi.fn(),
	readBinary: vi.fn(),
	cachedRead: vi.fn(),
	create: vi.fn(),
	modify: vi.fn(),
	delete: vi.fn(),
	createFolder: vi.fn(),
	getMarkdownFiles: vi.fn(),
	getFiles: vi.fn(),
	getRoot: vi.fn(),
	rename: vi.fn(),
	adapter: {
		exists: vi.fn(),
	},
};

const mockMetadataCache = {
	getFirstLinkpathDest: vi.fn(),
};

const mockPlugin = {
	app: {
		vault: mockVault,
		metadataCache: mockMetadataCache,
		fileManager: {
			renameFile: vi.fn().mockResolvedValue(undefined),
		},
		workspace: {
			getLeavesOfType: vi.fn().mockReturnValue([]),
		},
	},
	settings: {
		historyFolder: 'test-history-folder',
	},
	gfile: {
		getUniqueLinks: vi.fn().mockReturnValue(new Set()),
		getLinkText: vi.fn((file: any) => `[[${file.name || file.path}]]`),
		getBacklinks: vi.fn().mockReturnValue(new Set()),
	},
	logger: {
		log: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
} as any;

const mockContext: ToolExecutionContext = {
	plugin: mockPlugin,
	session: {
		id: 'test-session',
		type: 'agent-session',
		context: {
			contextFiles: [],
			contextDepth: 2,
			enabledTools: [],
			requireConfirmation: [],
		},
	},
} as any;

describe('GetWorkspaceStateTool', () => {
	let tool: GetWorkspaceStateTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new GetWorkspaceStateTool();
	});

	it('should return open files with metadata', async () => {
		// Note: iterateAllLeaves won't produce results in unit tests because
		// mock views don't pass the `instanceof MarkdownView` check.
		// Full behavior is verified via integration testing in Obsidian.
		const mockWorkspace = {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			iterateAllLeaves: vi.fn(),
		};

		const contextWithWorkspace = {
			...mockContext,
			plugin: {
				...mockPlugin,
				app: {
					...mockPlugin.app,
					workspace: mockWorkspace,
				},
			},
		};

		const result = await tool.execute({}, contextWithWorkspace);

		expect(result.success).toBe(true);
		expect(result.data.openFiles).toEqual([]);
		expect(result.data.project).toBeNull();
	});

	it('should return empty openFiles when no leaves are open', async () => {
		const mockWorkspace = {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			iterateAllLeaves: vi.fn(),
		};

		const contextWithWorkspace = {
			...mockContext,
			plugin: {
				...mockPlugin,
				app: {
					...mockPlugin.app,
					workspace: mockWorkspace,
				},
			},
		};

		const result = await tool.execute({}, contextWithWorkspace);

		expect(result.success).toBe(true);
		expect(result.data.openFiles).toEqual([]);
		expect(result.data.project).toBeNull();
	});

	describe('cached selection fallback', () => {
		// Builds the minimum plumbing to exercise the fallback: a single
		// markdown leaf whose editor.getSelection() returns `liveSelection`,
		// with the plugin's cached selection set to `cached`.
		function buildContext(opts: {
			liveSelection: string;
			cached: { path: string; text: string } | null;
			filePath?: string;
		}) {
			const filePath = opts.filePath ?? 'notes/test.md';
			const file = new TFile();
			(file as any).path = filePath;
			(file as any).name = 'test.md';

			// Cast through unknown: the runtime MarkdownView mock is a
			// zero-arg class, but the d.ts signature requires a leaf.
			const view = new (MarkdownView as unknown as new () => MarkdownView)();
			(view as any).file = file;
			(view as any).editor.getSelection.mockReturnValue(opts.liveSelection);

			const leaf = { view, containerEl: { isShown: () => true } };

			const mockWorkspace = {
				getActiveFile: vi.fn().mockReturnValue(file),
				getActiveViewOfType: vi.fn().mockReturnValue(view),
				iterateAllLeaves: vi.fn((cb: (l: any) => void) => cb(leaf)),
			};

			const metadataCache = {
				...mockMetadataCache,
				fileToLinktext: vi.fn((f: any) => f.path.replace(/\.md$/, '')),
			};

			return {
				...mockContext,
				plugin: {
					...mockPlugin,
					app: {
						...mockPlugin.app,
						workspace: mockWorkspace,
						metadataCache,
					},
					lastEditorSelection: opts.cached,
				},
			};
		}

		it('uses cached selection when live read is empty and path matches', async () => {
			const context = buildContext({
				liveSelection: '',
				cached: { path: 'notes/test.md', text: 'remembered foo' },
			});

			const result = await tool.execute({}, context);

			expect(result.success).toBe(true);
			expect(result.data.openFiles).toHaveLength(1);
			expect(result.data.openFiles[0].selection).toBe('remembered foo');
		});

		it('ignores cached selection when path does not match', async () => {
			const context = buildContext({
				liveSelection: '',
				cached: { path: 'other/file.md', text: 'unrelated' },
			});

			const result = await tool.execute({}, context);

			expect(result.data.openFiles[0].selection).toBeNull();
		});

		it('prefers live selection over cached', async () => {
			const context = buildContext({
				liveSelection: 'live text',
				cached: { path: 'notes/test.md', text: 'stale cache' },
			});

			const result = await tool.execute({}, context);

			expect(result.data.openFiles[0].selection).toBe('live text');
		});

		it('truncates long cached selections', async () => {
			const longText = 'x'.repeat(1500);
			const context = buildContext({
				liveSelection: '',
				cached: { path: 'notes/test.md', text: longText },
			});

			const result = await tool.execute({}, context);

			const selection: string = result.data.openFiles[0].selection;
			expect(selection.endsWith('...')).toBe(true);
			expect(selection.length).toBe(1003); // 1000 chars + '...'
		});

		it('returns null selection when no cache and live is empty', async () => {
			const context = buildContext({
				liveSelection: '',
				cached: null,
			});

			const result = await tool.execute({}, context);

			expect(result.data.openFiles[0].selection).toBeNull();
		});
	});
});
