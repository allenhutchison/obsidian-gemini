import { MoveFileTool } from '../../../src/tools/vault';
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

const mockFileManager = {
	renameFile: vi.fn().mockResolvedValue(undefined),
};

const mockPlugin = {
	app: {
		vault: mockVault,
		metadataCache: mockMetadataCache,
		fileManager: mockFileManager,
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

describe('MoveFileTool', () => {
	let tool: MoveFileTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new MoveFileTool();
	});

	it('should move file successfully', async () => {
		// ensureFolderExists needs getAbstractFileByPath to return TFolder after createFolder
		const createdFolders: Record<string, any> = {};
		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'test.md') return mockFile;
			return createdFolders[path] || null;
		});
		mockVault.adapter.exists.mockResolvedValue(false);
		mockVault.createFolder.mockImplementation(async (path: string) => {
			const folder = new TFolder();
			folder.path = path;
			folder.name = path.split('/').pop() || '';
			createdFolders[path] = folder;
		});
		mockFileManager.renameFile.mockResolvedValue(undefined);

		const result = await tool.execute(
			{
				sourcePath: 'test.md',
				targetPath: 'folder/renamed.md',
			},
			mockContext
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			sourcePath: 'test.md',
			targetPath: 'folder/renamed.md',
			type: 'file',
			action: 'moved',
		});
		expect(mockFileManager.renameFile).toHaveBeenCalledWith(mockFile, 'folder/renamed.md');
	});

	it('should return error for non-existent source file', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([]);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

		const result = await tool.execute(
			{
				sourcePath: 'nonexistent.md',
				targetPath: 'new.md',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Source file or folder not found: nonexistent.md');
	});

	it('should move folder successfully', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);
		mockVault.adapter.exists.mockResolvedValue(false);
		mockVault.createFolder.mockResolvedValue(undefined);
		mockFileManager.renameFile.mockResolvedValue(undefined);

		const result = await tool.execute(
			{
				sourcePath: 'folder',
				targetPath: 'new-folder',
			},
			mockContext
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			sourcePath: 'folder',
			targetPath: 'new-folder',
			type: 'folder',
			action: 'moved',
		});
		expect(mockFileManager.renameFile).toHaveBeenCalledWith(mockFolder, 'new-folder');
	});

	it('should return error if target already exists', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.adapter.exists.mockResolvedValue(true);

		const result = await tool.execute(
			{
				sourcePath: 'test.md',
				targetPath: 'existing.md',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe('Target path already exists: existing.md');
	});

	it('should create target directory if needed', async () => {
		// ensureFolderExists needs getAbstractFileByPath to return TFolder after createFolder
		const createdFolders: Record<string, any> = {};
		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'test.md') return mockFile;
			return createdFolders[path] || null;
		});
		mockVault.adapter.exists
			.mockResolvedValueOnce(false) // target file doesn't exist
			.mockResolvedValueOnce(false); // target dir doesn't exist
		mockVault.createFolder.mockImplementation(async (path: string) => {
			const folder = new TFolder();
			folder.path = path;
			folder.name = path.split('/').pop() || '';
			createdFolders[path] = folder;
		});
		mockFileManager.renameFile.mockResolvedValue(undefined);

		const result = await tool.execute(
			{
				sourcePath: 'test.md',
				targetPath: 'new-folder/moved.md',
			},
			mockContext
		);

		expect(result.success).toBe(true);
		expect(mockVault.createFolder).toHaveBeenCalledWith('new-folder');
		expect(mockFileManager.renameFile).toHaveBeenCalledWith(mockFile, 'new-folder/moved.md');
	});

	it('should have confirmation message', () => {
		const message = tool.confirmationMessage!({
			sourcePath: 'old.md',
			targetPath: 'new.md',
		});
		expect(message).toContain('Move file or folder from: old.md');
		expect(message).toContain('To: new.md');
	});

	it('should reject moving a folder into its own descendant', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);
		mockVault.adapter.exists.mockResolvedValue(false);
		mockVault.createFolder.mockClear();
		mockFileManager.renameFile.mockClear();

		const result = await tool.execute(
			{
				sourcePath: 'folder',
				targetPath: 'folder/subfolder',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot move a folder into its own descendant');
		expect(mockVault.createFolder).not.toHaveBeenCalled();
		expect(mockFileManager.renameFile).not.toHaveBeenCalled();
	});

	// --- Gap coverage tests ---

	it('should block moving from .obsidian system folder', async () => {
		const result = await tool.execute(
			{
				sourcePath: '.obsidian/plugins/config.json',
				targetPath: 'backup/config.json',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot move from system folder');
		expect(mockFileManager.renameFile).not.toHaveBeenCalled();
	});

	it('should block moving from history folder', async () => {
		const result = await tool.execute(
			{
				sourcePath: 'test-history-folder/session.md',
				targetPath: 'notes/session.md',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot move from system folder');
		expect(mockFileManager.renameFile).not.toHaveBeenCalled();
	});

	it('should block moving to .obsidian system folder', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

		const result = await tool.execute(
			{
				sourcePath: 'test.md',
				targetPath: '.obsidian/test.md',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot move to system folder');
		expect(mockFileManager.renameFile).not.toHaveBeenCalled();
	});

	it('should block moving to history folder', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

		const result = await tool.execute(
			{
				sourcePath: 'test.md',
				targetPath: 'test-history-folder/test.md',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot move to system folder');
		expect(mockFileManager.renameFile).not.toHaveBeenCalled();
	});

	it('should return error when renameFile throws', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.adapter.exists.mockResolvedValue(false);
		mockFileManager.renameFile.mockRejectedValue(new Error('Rename failed'));

		const result = await tool.execute(
			{
				sourcePath: 'test.md',
				targetPath: 'renamed.md',
			},
			mockContext
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Error moving file or folder');
		expect(result.error).toContain('Rename failed');
	});

	it('should return progress description with paths', () => {
		expect(tool.getProgressDescription({ sourcePath: 'folder/old.md', targetPath: 'other/new.md' })).toBe(
			'Moving old.md to new.md'
		);
	});

	it('should return generic progress description without paths', () => {
		expect(tool.getProgressDescription({ sourcePath: '', targetPath: '' })).toBe('Moving file');
	});
});
