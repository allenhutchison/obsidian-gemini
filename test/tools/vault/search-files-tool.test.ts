import { SearchFilesTool } from '../../../src/tools/vault';
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
import { TFile } from 'obsidian';

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

describe('SearchFilesTool', () => {
	let tool: SearchFilesTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new SearchFilesTool();
	});

	it('should search files by substring pattern', async () => {
		const files = [
			{ name: 'test.md', path: 'test.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'another.md', path: 'another.md', stat: { size: 200, mtime: Date.now() } },
			{ name: 'document.md', path: 'folder/document.md', stat: { size: 300, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		const result = await tool.execute({ pattern: 'test' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(1);
		expect(result.data?.matches[0].name).toBe('test.md');
	});

	it('should support wildcard patterns', async () => {
		const files = [
			{ name: 'Test.md', path: 'Test.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'TestCase.md', path: 'TestCase.md', stat: { size: 200, mtime: Date.now() } },
			{ name: 'UnitTest.md', path: 'UnitTest.md', stat: { size: 150, mtime: Date.now() } },
			{ name: 'README.md', path: 'README.md', stat: { size: 300, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		// Test * wildcard
		const result1 = await tool.execute({ pattern: '*Test*' }, mockContext);
		expect(result1.success).toBe(true);
		expect(result1.data?.matches).toHaveLength(3);
		const names1 = result1.data?.matches.map((f: any) => f.name);
		expect(names1).toContain('Test.md');
		expect(names1).toContain('TestCase.md');
		expect(names1).toContain('UnitTest.md');

		// Test pattern at start
		const result2 = await tool.execute({ pattern: 'Test*' }, mockContext);
		expect(result2.success).toBe(true);
		expect(result2.data?.matches).toHaveLength(2);
		const names2 = result2.data?.matches.map((f: any) => f.name);
		expect(names2).toContain('Test.md');
		expect(names2).toContain('TestCase.md');

		// Test pattern at end
		const result3 = await tool.execute({ pattern: '*Test.md' }, mockContext);
		expect(result3.success).toBe(true);
		// This should match both Test.md and UnitTest.md since * matches any characters
		expect(result3.data?.matches).toHaveLength(2);
		const names3 = result3.data?.matches.map((f: any) => f.name);
		expect(names3).toContain('Test.md');
		expect(names3).toContain('UnitTest.md');
	});

	it('should be case insensitive', async () => {
		const files = [
			{ name: 'TEST.md', path: 'TEST.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'test.md', path: 'test.md', stat: { size: 200, mtime: Date.now() } },
			{ name: 'Test.md', path: 'Test.md', stat: { size: 300, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		const result = await tool.execute({ pattern: 'test' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(3);
	});

	it('should limit results', async () => {
		const files = Array(100)
			.fill(null)
			.map((_, i) => ({
				name: `test${i}.md`,
				path: `test${i}.md`,
				stat: { size: 100, mtime: Date.now() },
			})) as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		const result = await tool.execute({ pattern: 'test', limit: 10 }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(10);
		expect(result.data?.truncated).toBe(true);
	});

	it('should find non-markdown files', async () => {
		const files = [
			{ name: 'photo.png', path: 'images/photo.png', stat: { size: 5000, mtime: Date.now() } },
			{ name: 'note.md', path: 'note.md', stat: { size: 200, mtime: Date.now() } },
			{ name: 'recording.mp3', path: 'audio/recording.mp3', stat: { size: 10000, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		const result = await tool.execute({ pattern: '*' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(3);
		const names = result.data?.matches.map((f: any) => f.name);
		expect(names).toContain('photo.png');
		expect(names).toContain('recording.mp3');
	});

	it('should exclude system folders from search results', async () => {
		const files = [
			{ name: 'config.json', path: '.obsidian/plugins/config.json', stat: { size: 100, mtime: Date.now() } },
			{ name: 'session.md', path: 'test-history-folder/session.md', stat: { size: 200, mtime: Date.now() } },
			{ name: 'note.md', path: 'notes/note.md', stat: { size: 300, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		const result = await tool.execute({ pattern: '*' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(1);
		expect(result.data?.matches[0].name).toBe('note.md');
	});

	// --- Gap coverage tests ---

	it('should support ? single-character wildcard', async () => {
		const files = [
			{ name: 'note1.md', path: 'note1.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'note2.md', path: 'note2.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'notes.md', path: 'notes.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'note10.md', path: 'note10.md', stat: { size: 100, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		// ? should match exactly one character, so note?.md should match note1.md, note2.md, notes.md
		// but NOT note10.md (which has two chars after 'note')
		const result = await tool.execute({ pattern: 'note?.md' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(3);
		const names = result.data?.matches.map((f: any) => f.name);
		expect(names).toContain('note1.md');
		expect(names).toContain('note2.md');
		expect(names).toContain('notes.md');
		expect(names).not.toContain('note10.md');
	});

	it('should escape special regex characters in pattern (e.g., dots)', async () => {
		const files = [
			{ name: 'test.md', path: 'test.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'testXmd', path: 'testXmd', stat: { size: 100, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		// Without escaping, 'test.md' would match 'testXmd' because . is a regex wildcard.
		// The tool should escape dots in non-wildcard patterns.
		const result = await tool.execute({ pattern: 'test.md' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(1);
		expect(result.data?.matches[0].name).toBe('test.md');
	});

	it('should match against file.path not just file.name', async () => {
		const files = [
			{ name: 'note.md', path: 'projects/alpha/note.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'note.md', path: 'personal/note.md', stat: { size: 100, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		// Search for a path-based pattern (substring matching against path)
		const result = await tool.execute({ pattern: 'alpha' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(1);
		expect(result.data?.matches[0].path).toBe('projects/alpha/note.md');
	});

	it('should scope results to project root when set', async () => {
		const files = [
			{ name: 'todo.md', path: 'projects/myproj/todo.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'todo.md', path: 'personal/todo.md', stat: { size: 100, mtime: Date.now() } },
		] as TFile[];

		mockVault.getFiles.mockReturnValue(files);

		const contextWithProject: ToolExecutionContext = {
			...mockContext,
			projectRootPath: 'projects/myproj',
		} as any;

		const result = await tool.execute({ pattern: 'todo' }, contextWithProject);

		expect(result.success).toBe(true);
		expect(result.data?.matches).toHaveLength(1);
		expect(result.data?.matches[0].path).toBe('projects/myproj/todo.md');
	});
});
