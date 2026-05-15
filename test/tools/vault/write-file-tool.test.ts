import { WriteFileTool } from '../../../src/tools/vault';
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

describe('WriteFileTool', () => {
	let tool: WriteFileTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new WriteFileTool();
	});

	it('should modify existing file', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.modify.mockResolvedValue(undefined);

		const result = await tool.execute({ path: 'test.md', content: 'new content' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'test.md',
			action: 'modified',
			size: 11,
			userEdited: false,
		});
		expect(mockVault.modify).toHaveBeenCalledWith(mockFile, 'new content');
	});

	it('should create new file', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.create.mockResolvedValue(mockFile);

		const result = await tool.execute({ path: 'new.md', content: 'new content' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			path: 'new.md',
			action: 'created',
			size: 11,
			userEdited: false,
		});
		expect(mockVault.create).toHaveBeenCalledWith('new.md', 'new content');
	});

	it('should create parent directories when creating file in non-existent folder', async () => {
		// ensureFolderExists calls getAbstractFileByPath twice per folder:
		// once to check existence (null), once to verify after creation (TFolder)
		const createdFolders: Record<string, any> = {};
		mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
			if (path === 'folder/subfolder/new.md') return null; // file doesn't exist
			return createdFolders[path] || null;
		});
		mockVault.createFolder.mockImplementation(async (path: string) => {
			const folder = new TFolder();
			folder.path = path;
			folder.name = path.split('/').pop() || '';
			createdFolders[path] = folder;
		});
		mockVault.adapter.exists.mockResolvedValue(false); // Parent directory doesn't exist
		mockVault.create.mockResolvedValue(mockFile);

		const result = await tool.execute({ path: 'folder/subfolder/new.md', content: 'new content' }, mockContext);

		expect(result.success).toBe(true);
		expect(mockVault.adapter.exists).toHaveBeenCalledWith('folder/subfolder');
		expect(mockVault.createFolder).toHaveBeenCalledWith('folder/subfolder');
		expect(mockVault.create).toHaveBeenCalledWith('folder/subfolder/new.md', 'new content');
	});

	it('should create file when parent directory already exists', async () => {
		mockVault.getAbstractFileByPath.mockReturnValueOnce(null).mockReturnValueOnce(mockFile);
		mockVault.adapter.exists.mockResolvedValue(true); // Parent directory exists
		mockVault.create.mockResolvedValue(mockFile);

		const result = await tool.execute({ path: 'existing-folder/new.md', content: 'new content' }, mockContext);

		expect(result.success).toBe(true);
		expect(mockVault.adapter.exists).toHaveBeenCalledWith('existing-folder');
		expect(mockVault.createFolder).not.toHaveBeenCalled();
		expect(mockVault.create).toHaveBeenCalledWith('existing-folder/new.md', 'new content');
	});

	it('should create root-level file without checking for parent directory', async () => {
		mockVault.getAbstractFileByPath.mockReturnValueOnce(null).mockReturnValueOnce(mockFile);
		mockVault.create.mockResolvedValue(mockFile);

		const result = await tool.execute({ path: 'root-file.md', content: 'new content' }, mockContext);

		expect(result.success).toBe(true);
		expect(mockVault.adapter.exists).not.toHaveBeenCalled();
		expect(mockVault.createFolder).not.toHaveBeenCalled();
		expect(mockVault.create).toHaveBeenCalledWith('root-file.md', 'new content');
	});

	it('should have confirmation message', () => {
		const message = tool.confirmationMessage!({ path: 'test.md', content: 'content' });
		expect(message).toContain('Write content to file: test.md');
		expect(message).toContain('content');
	});

	it('should include userEdited: false in result when content is unmodified', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.modify.mockResolvedValue(undefined);

		const result = await tool.execute({ path: 'test.md', content: 'hello world' }, mockContext);
		expect(result.success).toBe(true);
		expect(result.data.userEdited).toBe(false);
	});

	it('should use summary in confirmation message when provided', () => {
		const msg = tool.confirmationMessage!({
			path: 'test.md',
			content: 'full content here',
			summary: 'Added a new section about testing',
		});
		expect(msg).toContain('Added a new section about testing');
		expect(msg).not.toContain('full content here');
	});

	it('should fall back to content preview when summary is not provided', () => {
		const msg = tool.confirmationMessage!({
			path: 'test.md',
			content: 'full content here',
		});
		expect(msg).toContain('full content here');
	});

	it('should include userEdited: true and userChangeSummary when _userEdited is true', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.modify.mockResolvedValue(undefined);

		const result = await tool.execute(
			{ path: 'test.md', content: 'user edited content', _userEdited: true },
			mockContext
		);

		expect(result.success).toBe(true);
		expect(result.data.userEdited).toBe(true);
		expect(result.data.userChangeSummary).toBe('User modified the proposed content before writing');
	});

	// --- Gap coverage tests ---

	it('should block writing to system folder paths', async () => {
		const result = await tool.execute({ path: '.obsidian/config.json', content: 'malicious content' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot write to system folder');
	});

	it('should block writing to history folder paths', async () => {
		const result = await tool.execute({ path: 'test-history-folder/some-file.md', content: 'content' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot write to system folder');
	});

	it('should return error when vault.modify() throws', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.modify.mockRejectedValue(new Error('Write permission denied'));

		const result = await tool.execute({ path: 'test.md', content: 'new content' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Error writing file');
		expect(result.error).toContain('Write permission denied');
	});

	it('should return error when vault.create() throws', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.adapter.exists.mockResolvedValue(true); // parent exists
		mockVault.create.mockRejectedValue(new Error('Disk full'));

		const result = await tool.execute({ path: 'new-file.md', content: 'content' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Error writing file');
		expect(result.error).toContain('Disk full');
	});

	it('should return progress description with path', () => {
		expect(tool.getProgressDescription({ path: 'notes/test.md' })).toBe('Writing to notes/test.md');
	});

	it('should return generic progress description without path', () => {
		expect(tool.getProgressDescription({ path: '' })).toBe('Writing file');
	});
});
