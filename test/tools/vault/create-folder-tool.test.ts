import { CreateFolderTool } from '../../../src/tools/vault';
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
import { TFile, TFolder } from 'obsidian';

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

describe('CreateFolderTool', () => {
	let tool: CreateFolderTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new CreateFolderTool();
	});

	it('should create a new folder successfully', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.adapter.exists.mockResolvedValue(false);
		mockVault.createFolder.mockResolvedValue(undefined);

		const result = await tool.execute({ path: 'new-folder' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'new-folder',
			action: 'created',
		});
	});

	it('should return already_exists for existing folder (idempotent)', async () => {
		const existingFolder = new TFolder();
		existingFolder.path = 'existing-folder';
		existingFolder.name = 'existing-folder';

		mockVault.getAbstractFileByPath.mockReturnValue(existingFolder);

		const result = await tool.execute({ path: 'existing-folder' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'existing-folder',
			action: 'already_exists',
		});
		// Should not attempt to create the folder again
		expect(mockVault.createFolder).not.toHaveBeenCalled();
	});

	it('should return error when a file exists at the same path', async () => {
		const existingFile = new TFile();
		(existingFile as any).path = 'conflicting-path';
		(existingFile as any).name = 'conflicting-path';
		(existingFile as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(existingFile);

		const result = await tool.execute({ path: 'conflicting-path' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('A file already exists at path');
		expect(mockVault.createFolder).not.toHaveBeenCalled();
	});

	it('should block creating folders in .obsidian system directory', async () => {
		const result = await tool.execute({ path: '.obsidian/my-folder' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot create folder in system directory');
		expect(mockVault.createFolder).not.toHaveBeenCalled();
	});

	it('should block creating folders in history folder', async () => {
		const result = await tool.execute({ path: 'test-history-folder/subfolder' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot create folder in system directory');
		expect(mockVault.createFolder).not.toHaveBeenCalled();
	});

	it('should return error when folder creation throws', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.adapter.exists.mockResolvedValue(false);
		mockVault.createFolder.mockRejectedValue(new Error('Permission denied'));

		const result = await tool.execute({ path: 'no-permission-folder' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Error creating folder');
		expect(result.error).toContain('Permission denied');
	});

	it('should have confirmation message', () => {
		const message = tool.confirmationMessage!({ path: 'my-new-folder' });
		expect(message).toContain('Create folder: my-new-folder');
	});

	it('should return progress description with path', () => {
		expect(tool.getProgressDescription({ path: 'projects/new' })).toBe('Creating folder projects/new');
	});

	it('should return generic progress description without path', () => {
		expect(tool.getProgressDescription({ path: '' })).toBe('Creating folder');
	});

	it('should create nested folder paths', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.adapter.exists.mockResolvedValue(false);
		mockVault.createFolder.mockResolvedValue(undefined);

		const result = await tool.execute({ path: 'deeply/nested/folder/path' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'deeply/nested/folder/path',
			action: 'created',
		});
	});
});
