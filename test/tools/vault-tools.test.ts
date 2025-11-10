import { ReadFileTool, WriteFileTool, ListFilesTool, SearchFilesTool, SearchFileContentsTool, MoveFileTool, DeleteFileTool, GetActiveFileTool, getVaultTools } from '../../src/tools/vault-tools';
import { ToolExecutionContext } from '../../src/tools/types';

// Mock ScribeFile and ScribeDataView
jest.mock('../../src/files', () => ({
	ScribeFile: jest.fn().mockImplementation(() => ({
		getUniqueLinks: jest.fn().mockReturnValue(new Set()),
		getLinkText: jest.fn((file: any) => `[[${file.name || file.path}]]`)
	}))
}));

jest.mock('../../src/files/dataview-utils', () => ({
	ScribeDataView: jest.fn().mockImplementation(() => ({
		getBacklinks: jest.fn().mockResolvedValue(new Set())
	}))
}));

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
	cachedRead: jest.fn(),
	create: jest.fn(),
	modify: jest.fn(),
	delete: jest.fn(),
	createFolder: jest.fn(),
	getMarkdownFiles: jest.fn(),
	getRoot: jest.fn(),
	rename: jest.fn(),
	adapter: {
		exists: jest.fn()
	}
};

const mockMetadataCache = {
	getFirstLinkpathDest: jest.fn()
};

const mockPlugin = {
	app: {
		vault: mockVault,
		metadataCache: mockMetadataCache
	},
	settings: {
		historyFolder: 'test-history-folder'
	},
	gfile: {
		getUniqueLinks: jest.fn().mockReturnValue(new Set()),
		getLinkText: jest.fn((file: any) => `[[${file.name || file.path}]]`)
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
				type: 'file',
				wikilink: '[[test.md]]',
				content: 'file content',
				size: 100,
				modified: mockFile.stat.mtime,
				outgoingLinks: [],
				backlinks: []
			});
		});

		it('should return error for non-existent file', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.getMarkdownFiles.mockReturnValue([]);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const result = await tool.execute({ path: 'nonexistent.md' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('File or folder not found: nonexistent.md');
		});

		it('should list contents when given a folder path', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);

			const result = await tool.execute({ path: 'folder' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.type).toBe('folder');
			expect(result.data?.path).toBe('folder');
			expect(result.data?.name).toBe('folder');
			expect(result.data?.contents).toBeDefined();
			expect(result.data?.contents).toHaveLength(1);
			expect(result.data?.contents[0]).toEqual({
				name: 'test.md',
				path: 'test.md',
				type: 'file',
				size: 100,
				modified: mockFile.stat.mtime
			});
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

		it('should search files by substring pattern', async () => {
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

		it('should support wildcard patterns', async () => {
			const files = [
				{ name: 'Test.md', path: 'Test.md', stat: { size: 100, mtime: Date.now() } },
				{ name: 'TestCase.md', path: 'TestCase.md', stat: { size: 200, mtime: Date.now() } },
				{ name: 'UnitTest.md', path: 'UnitTest.md', stat: { size: 150, mtime: Date.now() } },
				{ name: 'README.md', path: 'README.md', stat: { size: 300, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);

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
				{ name: 'Test.md', path: 'Test.md', stat: { size: 300, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);

			const result = await tool.execute({ pattern: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.matches).toHaveLength(3);
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

	describe('DeleteFileTool', () => {
		let tool: DeleteFileTool;

		beforeEach(() => {
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
				action: 'deleted'
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
				action: 'deleted'
			});
			expect(mockVault.delete).toHaveBeenCalledWith(mockFolder);
		});

		it('should return error for non-existent file or folder', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.getMarkdownFiles.mockReturnValue([]);
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
	});

	describe('MoveFileTool', () => {
		let tool: MoveFileTool;

		beforeEach(() => {
			tool = new MoveFileTool();
		});

		it('should move file successfully', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.adapter.exists.mockResolvedValue(false);
			mockVault.createFolder.mockResolvedValue(undefined);
			mockVault.rename.mockResolvedValue(undefined);

			const result = await tool.execute({
				sourcePath: 'test.md',
				targetPath: 'folder/renamed.md'
			}, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				sourcePath: 'test.md',
				targetPath: 'folder/renamed.md',
				type: 'file',
				action: 'moved'
			});
			expect(mockVault.rename).toHaveBeenCalledWith(mockFile, 'folder/renamed.md');
		});

		it('should return error for non-existent source file', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.getMarkdownFiles.mockReturnValue([]);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const result = await tool.execute({
				sourcePath: 'nonexistent.md',
				targetPath: 'new.md'
			}, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Source file or folder not found: nonexistent.md');
		});

		it('should move folder successfully', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFolder);
			mockVault.adapter.exists.mockResolvedValue(false);
			mockVault.createFolder.mockResolvedValue(undefined);
			mockVault.rename.mockResolvedValue(undefined);

			const result = await tool.execute({
				sourcePath: 'folder',
				targetPath: 'new-folder'
			}, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				sourcePath: 'folder',
				targetPath: 'new-folder',
				type: 'folder',
				action: 'moved'
			});
			expect(mockVault.rename).toHaveBeenCalledWith(mockFolder, 'new-folder');
		});

		it('should return error if target already exists', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.adapter.exists.mockResolvedValue(true);

			const result = await tool.execute({ 
				sourcePath: 'test.md', 
				targetPath: 'existing.md' 
			}, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Target path already exists: existing.md');
		});

		it('should create target directory if needed', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.adapter.exists
				.mockResolvedValueOnce(false) // target file doesn't exist
				.mockResolvedValueOnce(false); // target dir doesn't exist
			mockVault.createFolder.mockResolvedValue(undefined);
			mockVault.rename.mockResolvedValue(undefined);

			const result = await tool.execute({ 
				sourcePath: 'test.md', 
				targetPath: 'new-folder/moved.md' 
			}, mockContext);

			expect(result.success).toBe(true);
			expect(mockVault.createFolder).toHaveBeenCalledWith('new-folder');
			expect(mockVault.rename).toHaveBeenCalledWith(mockFile, 'new-folder/moved.md');
		});

		it('should have confirmation message', () => {
			const message = tool.confirmationMessage!({
				sourcePath: 'old.md',
				targetPath: 'new.md'
			});
			expect(message).toContain('Move file or folder from: old.md');
			expect(message).toContain('To: new.md');
		});
	});

	describe('SearchFileContentsTool', () => {
		let tool: SearchFileContentsTool;

		beforeEach(() => {
			tool = new SearchFileContentsTool();
			// Add logger to mockPlugin for the tool
			mockPlugin.logger = {
				debug: jest.fn(),
				log: jest.fn(),
				error: jest.fn(),
				warn: jest.fn()
			};
		});

		it('should search for text in file contents', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } },
				{ name: 'file2.md', path: 'file2.md', stat: { size: 200, mtime: Date.now() } },
				{ name: 'file3.md', path: 'file3.md', stat: { size: 300, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead
				.mockResolvedValueOnce('This is a test file\nWith some content\nAnd more lines')
				.mockResolvedValueOnce('Another file\nWithout the keyword\nJust text')
				.mockResolvedValueOnce('A third file\nWith test in it\nAnd more data');

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(2);
			expect(result.data?.totalMatches).toBe(2);
			expect(result.data?.results).toHaveLength(2);
			expect(result.data?.results[0].file).toBe('file1.md');
			expect(result.data?.results[1].file).toBe('file3.md');
		});

		it('should be case-insensitive by default', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('This has TEST in uppercase');

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.totalMatches).toBe(1);
		});

		it('should support case-sensitive search', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('This has TEST in uppercase\nAnd test in lowercase');

			const result = await tool.execute({ query: 'test', caseSensitive: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.totalMatches).toBe(1);
		});

		it('should support regex patterns', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('Test 123\nAnother line\nTest 456');

			const result = await tool.execute({ query: 'Test \\d+', useRegex: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.totalMatches).toBe(2);
		});

		it('should include context lines', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('Line 1\nLine 2\nThis is a match\nLine 4\nLine 5');

			const result = await tool.execute({ query: 'match', contextLines: 2 }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.results[0].matches[0].contextBefore).toHaveLength(2);
			expect(result.data?.results[0].matches[0].contextBefore).toEqual(['Line 1', 'Line 2']);
			expect(result.data?.results[0].matches[0].contextAfter).toHaveLength(2);
			expect(result.data?.results[0].matches[0].contextAfter).toEqual(['Line 4', 'Line 5']);
		});

		it('should respect limit parameter', async () => {
			const files = Array.from({ length: 100 }, (_, i) => ({
				name: `file${i}.md`,
				path: `file${i}.md`,
				stat: { size: 100, mtime: Date.now() }
			})) as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('This contains the search term');

			const result = await tool.execute({ query: 'search', limit: 5 }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.results.length).toBe(5);
			expect(result.data?.truncated).toBe(true);
		});

		it('should return error for empty query', async () => {
			const result = await tool.execute({ query: '' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Query cannot be empty');
		});

		it('should return error for invalid regex', async () => {
			const result = await tool.execute({ query: '[invalid(regex', useRegex: true }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Invalid regex pattern');
		});

		it('should skip files that cannot be read', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } },
				{ name: 'file2.md', path: 'file2.md', stat: { size: 200, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead
				.mockRejectedValueOnce(new Error('Cannot read file'))
				.mockResolvedValueOnce('This contains test');

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.results[0].file).toBe('file2.md');
		});

		it('should return line numbers correctly', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }
			] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('Line 1\nLine 2\nMatch here\nLine 4\nAnother match\nLine 6');

			const result = await tool.execute({ query: 'match', contextLines: 0 }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.results[0].matches[0].lineNumber).toBe(3);
			expect(result.data?.results[0].matches[1].lineNumber).toBe(5);
		});
	});

	describe('GetActiveFileTool', () => {
		let tool: GetActiveFileTool;

		beforeEach(() => {
			tool = new GetActiveFileTool();
		});

		it('should get active file and return full content', async () => {
			const mockActiveFile = new TFile();
			(mockActiveFile as any).path = 'active.md';
			(mockActiveFile as any).name = 'active.md';
			(mockActiveFile as any).extension = 'md';
			(mockActiveFile as any).stat = {
				size: 200,
				mtime: Date.now(),
				ctime: Date.now()
			};

			const mockWorkspace = {
				getActiveFile: jest.fn().mockReturnValue(mockActiveFile)
			};

			const contextWithWorkspace = {
				...mockContext,
				plugin: {
					...mockPlugin,
					app: {
						...mockPlugin.app,
						workspace: mockWorkspace
					}
				}
			};

			mockVault.getAbstractFileByPath.mockReturnValue(mockActiveFile);
			mockVault.read.mockResolvedValue('active file content');

			const result = await tool.execute({}, contextWithWorkspace);

			expect(result.success).toBe(true);
			expect(result.data.path).toBe('active.md');
			expect(result.data.content).toBe('active file content');
			expect(mockWorkspace.getActiveFile).toHaveBeenCalled();
		});

		it('should return error when no file is active', async () => {
			const mockWorkspace = {
				getActiveFile: jest.fn().mockReturnValue(null)
			};

			const contextWithWorkspace = {
				...mockContext,
				plugin: {
					...mockPlugin,
					app: {
						...mockPlugin.app,
						workspace: mockWorkspace
					}
				}
			};

			const result = await tool.execute({}, contextWithWorkspace);

			expect(result.success).toBe(false);
			expect(result.error).toBe('No file is currently active in the editor');
		});

		it('should return error when active file is not markdown', async () => {
			const mockActiveFile = new TFile();
			(mockActiveFile as any).path = 'image.png';
			(mockActiveFile as any).extension = 'png';

			const mockWorkspace = {
				getActiveFile: jest.fn().mockReturnValue(mockActiveFile)
			};

			const contextWithWorkspace = {
				...mockContext,
				plugin: {
					...mockPlugin,
					app: {
						...mockPlugin.app,
						workspace: mockWorkspace
					}
				}
			};

			const result = await tool.execute({}, contextWithWorkspace);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not a markdown file');
		});
	});

	describe('getVaultTools', () => {
		it('should return all vault tools', () => {
			const tools = getVaultTools();

			expect(tools).toHaveLength(9);
			expect(tools.map(t => t.name)).toContain('read_file');
			expect(tools.map(t => t.name)).toContain('write_file');
			expect(tools.map(t => t.name)).toContain('list_files');
			expect(tools.map(t => t.name)).toContain('create_folder');
			expect(tools.map(t => t.name)).toContain('delete_file');
			expect(tools.map(t => t.name)).toContain('move_file');
			expect(tools.map(t => t.name)).toContain('search_files');
			expect(tools.map(t => t.name)).toContain('search_file_contents');
			expect(tools.map(t => t.name)).toContain('get_active_file');
		});
	});
});