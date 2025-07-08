import { ReadFileTool, WriteFileTool, ListFilesTool, SearchFilesTool, getVaultTools } from './vault-tools';
import { ToolExecutionContext } from './types';

// Use the existing mock by extending it
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	normalizePath: jest.fn((path: string) => path),
	TFolder: class TFolder {
		path: string;
		name: string;
		children: any[];
		
		constructor() {
			this.path = '';
			this.name = '';
			this.children = [];
		}
	}
}));

// Import the mocked classes
import { TFile, TFolder } from 'obsidian';

// Mock Obsidian objects  
const mockFile = new TFile();
(mockFile as any).path = 'test.md';
(mockFile as any).name = 'test.md';
(mockFile as any).stat = {
	size: 100,
	mtime: Date.now(),
	ctime: Date.now()
};

const mockFolder = new TFolder();
mockFolder.path = 'folder';
mockFolder.name = 'folder';
mockFolder.children = [mockFile];

const mockVault = {
	getAbstractFileByPath: jest.fn(),
	read: jest.fn(),
	create: jest.fn(),
	modify: jest.fn(),
	delete: jest.fn(),
	createFolder: jest.fn(),
	getMarkdownFiles: jest.fn(),
	getRoot: jest.fn()
};

const mockPlugin = {
	app: {
		vault: mockVault
	}
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
			requireConfirmation: []
		}
	}
} as any;

describe('VaultTools', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('ReadFileTool', () => {
		let tool: ReadFileTool;

		beforeEach(() => {
			tool = new ReadFileTool();
		});

		it('should read file successfully', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.read.mockResolvedValue('file content');

			const result = await tool.execute({ path: 'test.md' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: 'test.md',
				content: 'file content',
				size: 100,
				modified: mockFile.stat.mtime
			});
		});

		it('should return error for non-existent file', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await tool.execute({ path: 'nonexistent.md' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('File not found: nonexistent.md');
		});

		it('should return error for folder path', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);

			const result = await tool.execute({ path: 'folder' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Path is not a file: folder');
		});
	});

	describe('WriteFileTool', () => {
		let tool: WriteFileTool;

		beforeEach(() => {
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
				size: 11
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
				size: 11
			});
			expect(mockVault.create).toHaveBeenCalledWith('new.md', 'new content');
		});

		it('should have confirmation message', () => {
			const message = tool.confirmationMessage!({ path: 'test.md', content: 'content' });
			expect(message).toContain('Write content to file: test.md');
			expect(message).toContain('content');
		});
	});

	describe('ListFilesTool', () => {
		let tool: ListFilesTool;

		beforeEach(() => {
			tool = new ListFilesTool();
		});

		it('should list files in folder', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);

			const result = await tool.execute({ path: 'folder' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: 'folder',
				files: [{
					name: 'test.md',
					path: 'test.md',
					type: 'file',
					size: 100,
					modified: mockFile.stat.mtime
				}],
				count: 1
			});
		});

		it('should list root files when path is empty', async () => {
			const rootFolder = new TFolder();
			rootFolder.children = [mockFile];
			mockVault.getRoot.mockReturnValue(rootFolder);

			const result = await tool.execute({ path: '' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.path).toBe('');
			expect(result.data?.count).toBe(1);
		});

		it('should return error for non-existent folder', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const result = await tool.execute({ path: 'nonexistent' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Folder not found: nonexistent');
		});
	});

	describe('SearchFilesTool', () => {
		let tool: SearchFilesTool;

		beforeEach(() => {
			tool = new SearchFilesTool();
		});

		it('should search files by pattern', async () => {
			const files = [
				{ name: 'test.md', path: 'test.md', stat: { size: 100, mtime: Date.now() } },
				{ name: 'another.md', path: 'another.md', stat: { size: 200, mtime: Date.now() } },
				{ name: 'document.md', path: 'folder/document.md', stat: { size: 300, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);

			const result = await tool.execute({ pattern: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.matches).toHaveLength(1);
			expect(result.data?.matches[0].name).toBe('test.md');
		});

		it('should limit results', async () => {
			const files = Array(100).fill(null).map((_, i) => ({
				name: `test${i}.md`,
				path: `test${i}.md`,
				stat: { size: 100, mtime: Date.now() }
			})) as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);

			const result = await tool.execute({ pattern: 'test', limit: 10 }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.matches).toHaveLength(10);
			expect(result.data?.truncated).toBe(true);
		});
	});

	describe('getVaultTools', () => {
		it('should return all vault tools', () => {
			const tools = getVaultTools();
			
			expect(tools).toHaveLength(6);
			expect(tools.map(t => t.name)).toContain('read_file');
			expect(tools.map(t => t.name)).toContain('write_file');
			expect(tools.map(t => t.name)).toContain('list_files');
			expect(tools.map(t => t.name)).toContain('create_folder');
			expect(tools.map(t => t.name)).toContain('delete_file');
			expect(tools.map(t => t.name)).toContain('search_files');
		});
	});
});