import { DeleteFileTool } from '../../../src/tools/vault';
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

// Mock Obsidian objects
const mockFile = new TFile();
(mockFile as any).path = 'test.md';
(mockFile as any).name = 'test.md';
(mockFile as any).extension = 'md';
(mockFile as any).stat = {
	size: 100,
	mtime: Date.now(),
	ctime: Date.now(),
};

const mockFolder = new TFolder();
mockFolder.path = 'folder';
mockFolder.name = 'folder';
mockFolder.children = [mockFile];

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

describe('DeleteFileTool', () => {
	let tool: DeleteFileTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new DeleteFileTool();
	});

	it('should delete a file successfully', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.delete.mockResolvedValue(undefined);

		const result = await tool.execute({ path: 'test.md' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'test.md',
			type: 'file',
			action: 'deleted',
		});
		expect(mockVault.delete).toHaveBeenCalledWith(mockFile);
	});

	it('should delete a folder successfully', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);
		mockVault.delete.mockResolvedValue(undefined);

		const result = await tool.execute({ path: 'folder' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'folder',
			type: 'folder',
			action: 'deleted',
		});
		expect(mockVault.delete).toHaveBeenCalledWith(mockFolder);
	});

	it('should return error for non-existent file or folder', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([]);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

		const result = await tool.execute({ path: 'nonexistent' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
	});

	it('should have confirmation message', () => {
		const message = tool.confirmationMessage!({ path: 'test.md' });
		expect(message).toContain('Delete file or folder: test.md');
		expect(message).toContain('cannot be undone');
	});

	// --- Gap coverage tests ---

	it('should block deleting from .obsidian system folder', async () => {
		const result = await tool.execute({ path: '.obsidian/plugins/config.json' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot delete system folder');
		expect(mockVault.delete).not.toHaveBeenCalled();
	});

	it('should block deleting from history folder', async () => {
		const result = await tool.execute({ path: 'test-history-folder/session.md' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot delete system folder');
		expect(mockVault.delete).not.toHaveBeenCalled();
	});

	it('should return error when vault.delete() throws', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.delete.mockRejectedValue(new Error('File is locked'));

		const result = await tool.execute({ path: 'test.md' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Error deleting file or folder');
		expect(result.error).toContain('File is locked');
	});

	it('should return progress description with path', () => {
		expect(tool.getProgressDescription({ path: 'notes/test.md' })).toBe('Deleting notes/test.md');
	});

	it('should return generic progress description without path', () => {
		expect(tool.getProgressDescription({ path: '' })).toBe('Deleting file');
	});
});
