import {
	ReadFileTool,
	WriteFileTool,
	ListFilesTool,
	SearchFilesTool,
	SearchFileContentsTool,
	MoveFileTool,
	DeleteFileTool,
	GetWorkspaceStateTool,
	getVaultTools,
} from '../../src/tools/vault-tools';
import { ToolExecutionContext } from '../../src/tools/types';

// Mock gemini-utils (needed by file-classification, imported by vault-tools)
jest.mock('@allenhutchison/gemini-utils', () => ({
	EXTENSION_TO_MIME: {
		'.md': 'text/markdown',
		'.txt': 'text/plain',
		'.html': 'text/html',
		'.py': 'text/x-python',
	},
	TEXT_FALLBACK_EXTENSIONS: new Set(['.ts', '.js', '.json', '.css', '.yaml']),
}));

// Mock ScribeFile
jest.mock('../../src/files', () => ({
	ScribeFile: jest.fn().mockImplementation(() => ({
		getUniqueLinks: jest.fn().mockReturnValue(new Set()),
		getLinkText: jest.fn((file: any) => `[[${file.name || file.path}]]`),
		getBacklinks: jest.fn().mockReturnValue(new Set()),
	})),
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
	getAbstractFileByPath: jest.fn(),
	read: jest.fn(),
	readBinary: jest.fn(),
	cachedRead: jest.fn(),
	create: jest.fn(),
	modify: jest.fn(),
	delete: jest.fn(),
	createFolder: jest.fn(),
	getMarkdownFiles: jest.fn(),
	getFiles: jest.fn(),
	getRoot: jest.fn(),
	rename: jest.fn(),
	adapter: {
		exists: jest.fn(),
	},
};

const mockMetadataCache = {
	getFirstLinkpathDest: jest.fn(),
};

const mockPlugin = {
	app: {
		vault: mockVault,
		metadataCache: mockMetadataCache,
		workspace: {
			getLeavesOfType: jest.fn().mockReturnValue([]),
		},
	},
	settings: {
		historyFolder: 'test-history-folder',
	},
	gfile: {
		getUniqueLinks: jest.fn().mockReturnValue(new Set()),
		getLinkText: jest.fn((file: any) => `[[${file.name || file.path}]]`),
		getBacklinks: jest.fn().mockReturnValue(new Set()),
	},
	logger: {
		log: jest.fn(),
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
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
				backlinks: [],
			});
		});

		it('should return success with exists:false for non-existent file', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.getFiles.mockReturnValue([]);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const result = await tool.execute({ path: 'nonexistent.md' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.exists).toBe(false);
			expect(result.data.path).toBe('nonexistent.md');
			expect(result.data.message).toContain('does not exist');
		});

		it('should not resolve to system folder files via case-insensitive fallback', async () => {
			// Strategies 1-4 all miss
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			// Strategy 5 getFiles() returns only system folder files
			const obsidianFile = new TFile();
			(obsidianFile as any).path = '.obsidian/workspace.json';
			(obsidianFile as any).name = 'workspace.json';
			(obsidianFile as any).extension = 'json';

			const historyFile = new TFile();
			(historyFile as any).path = 'test-history-folder/session.md';
			(historyFile as any).name = 'session.md';
			(historyFile as any).extension = 'md';

			mockVault.getFiles.mockReturnValue([obsidianFile, historyFile]);

			// Try to resolve a path that would case-insensitively match the system files
			const result = await tool.execute({ path: 'workspace.json' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.exists).toBe(false);
		});

		it('should not suggest system folder files', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const obsidianFile = new TFile();
			(obsidianFile as any).path = '.obsidian/workspace.json';
			(obsidianFile as any).name = 'workspace.json';
			(obsidianFile as any).extension = 'json';

			const userFile = new TFile();
			(userFile as any).path = 'notes/workspace-notes.md';
			(userFile as any).name = 'workspace-notes.md';
			(userFile as any).extension = 'md';

			mockVault.getFiles.mockReturnValue([obsidianFile, userFile]);

			// "workspace" substring matches both filenames, but .obsidian should be excluded
			const result = await tool.execute({ path: 'workspace' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.exists).toBe(false);
			// Suggestions should include the user file but not the .obsidian file
			expect(result.data.suggestions.join(' ')).toContain('workspace-notes.md');
			expect(result.data.suggestions.join(' ')).not.toContain('.obsidian');
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
				modified: mockFile.stat.mtime,
			});
		});

		it('should read binary PNG file and return inlineData', async () => {
			const pngFile = new TFile();
			(pngFile as any).path = 'images/photo.png';
			(pngFile as any).name = 'photo.png';
			(pngFile as any).extension = 'png';
			(pngFile as any).stat = { size: 1024, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(pngFile);
			const fakeBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
			mockVault.readBinary.mockResolvedValue(fakeBuffer);

			const result = await tool.execute({ path: 'images/photo.png' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.type).toBe('binary_file');
			expect(result.data?.mimeType).toBe('image/png');
			expect(result.data?.size).toBe(4);
			expect(result.inlineData).toHaveLength(1);
			expect(result.inlineData![0].mimeType).toBe('image/png');
			expect(result.inlineData![0].base64).toBe(Buffer.from(new Uint8Array(fakeBuffer)).toString('base64'));
		});

		it('should reject oversized binary files', async () => {
			const bigFile = new TFile();
			(bigFile as any).path = 'big.mp4';
			(bigFile as any).name = 'big.mp4';
			(bigFile as any).extension = 'mp4';
			(bigFile as any).stat = { size: 30 * 1024 * 1024, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(bigFile);
			const bigBuffer = new ArrayBuffer(21 * 1024 * 1024);
			mockVault.readBinary.mockResolvedValue(bigBuffer);

			const result = await tool.execute({ path: 'big.mp4' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('too large');
		});

		it('should detect webm as audio when no video codec present', async () => {
			const webmFile = new TFile();
			(webmFile as any).path = 'audio.webm';
			(webmFile as any).name = 'audio.webm';
			(webmFile as any).extension = 'webm';
			(webmFile as any).stat = { size: 500, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(webmFile);
			// Buffer without video codec signatures → audio/webm
			const audioBuffer = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]).buffer;
			mockVault.readBinary.mockResolvedValue(audioBuffer);

			const result = await tool.execute({ path: 'audio.webm' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.mimeType).toBe('audio/webm');
			expect(result.inlineData![0].mimeType).toBe('audio/webm');
		});

		it('should detect webm as video when VP8 codec present', async () => {
			const webmFile = new TFile();
			(webmFile as any).path = 'video.webm';
			(webmFile as any).name = 'video.webm';
			(webmFile as any).extension = 'webm';
			(webmFile as any).stat = { size: 500, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(webmFile);
			// Buffer with V_VP8 video codec signature → video/webm
			const videoBuffer = new Uint8Array([0x1a, 0x45, 0x56, 0x5f, 0x56, 0x50, 0x38, 0x00]).buffer;
			mockVault.readBinary.mockResolvedValue(videoBuffer);

			const result = await tool.execute({ path: 'video.webm' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.mimeType).toBe('video/webm');
			expect(result.inlineData![0].mimeType).toBe('video/webm');
		});

		it('should return error for unsupported file types', async () => {
			const zipFile = new TFile();
			(zipFile as any).path = 'archive.zip';
			(zipFile as any).name = 'archive.zip';
			(zipFile as any).extension = 'zip';
			(zipFile as any).stat = { size: 500, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(zipFile);

			const result = await tool.execute({ path: 'archive.zip' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Unsupported file type');
		});

		it('should read .base files as text', async () => {
			const baseFile = new TFile();
			(baseFile as any).path = 'views/tasks.base';
			(baseFile as any).name = 'tasks.base';
			(baseFile as any).extension = 'base';
			(baseFile as any).stat = { size: 200, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(baseFile);
			mockVault.read.mockResolvedValue('filters:\n  and:\n    - file.hasTag("task")');

			const result = await tool.execute({ path: 'views/tasks.base' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.type).toBe('file');
			expect(result.data?.content).toContain('filters:');
			expect(result.inlineData).toBeUndefined();
		});

		it('should read .canvas files as text', async () => {
			const canvasFile = new TFile();
			(canvasFile as any).path = 'canvas/ideas.canvas';
			(canvasFile as any).name = 'ideas.canvas';
			(canvasFile as any).extension = 'canvas';
			(canvasFile as any).stat = { size: 300, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(canvasFile);
			mockVault.read.mockResolvedValue('{"nodes":[],"edges":[]}');

			const result = await tool.execute({ path: 'canvas/ideas.canvas' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.type).toBe('file');
			expect(result.data?.content).toContain('"nodes"');
			expect(result.inlineData).toBeUndefined();
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
				files: [
					{
						name: 'test.md',
						path: 'test.md',
						type: 'file',
						size: 100,
						modified: mockFile.stat.mtime,
					},
				],
				count: 1,
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

		it('should exclude system folders from recursive listing', async () => {
			const obsidianFile = new TFile();
			(obsidianFile as any).path = '.obsidian/plugins/config.json';
			(obsidianFile as any).name = 'config.json';
			(obsidianFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };

			const historyFile = new TFile();
			(historyFile as any).path = 'test-history-folder/session.md';
			(historyFile as any).name = 'session.md';
			(historyFile as any).stat = { size: 200, mtime: Date.now(), ctime: Date.now() };

			const userFile = new TFile();
			(userFile as any).path = 'notes/note.md';
			(userFile as any).name = 'note.md';
			(userFile as any).stat = { size: 300, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.getFiles.mockReturnValue([obsidianFile, historyFile, userFile]);

			const result = await tool.execute({ path: '', recursive: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.count).toBe(1);
			expect(result.data?.files[0].name).toBe('note.md');
		});

		it('should include non-markdown files in recursive listing', async () => {
			const pngFile = new TFile();
			(pngFile as any).path = 'images/photo.png';
			(pngFile as any).name = 'photo.png';
			(pngFile as any).extension = 'png';
			(pngFile as any).stat = { size: 5000, mtime: Date.now(), ctime: Date.now() };

			const mdFile = new TFile();
			(mdFile as any).path = 'notes/note.md';
			(mdFile as any).name = 'note.md';
			(mdFile as any).extension = 'md';
			(mdFile as any).stat = { size: 200, mtime: Date.now(), ctime: Date.now() };

			mockVault.getAbstractFileByPath.mockReturnValue(null); // no specific folder
			mockVault.getFiles.mockReturnValue([pngFile, mdFile]);

			const result = await tool.execute({ path: '', recursive: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.count).toBe(2);
			const names = result.data?.files.map((f: any) => f.name);
			expect(names).toContain('photo.png');
			expect(names).toContain('note.md');
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
	});

	describe('MoveFileTool', () => {
		let tool: MoveFileTool;

		beforeEach(() => {
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
			mockVault.rename.mockResolvedValue(undefined);

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
			expect(mockVault.rename).toHaveBeenCalledWith(mockFile, 'folder/renamed.md');
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
			mockVault.rename.mockResolvedValue(undefined);

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
			expect(mockVault.rename).toHaveBeenCalledWith(mockFolder, 'new-folder');
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
			mockVault.rename.mockResolvedValue(undefined);

			const result = await tool.execute(
				{
					sourcePath: 'test.md',
					targetPath: 'new-folder/moved.md',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(mockVault.createFolder).toHaveBeenCalledWith('new-folder');
			expect(mockVault.rename).toHaveBeenCalledWith(mockFile, 'new-folder/moved.md');
		});

		it('should have confirmation message', () => {
			const message = tool.confirmationMessage!({
				sourcePath: 'old.md',
				targetPath: 'new.md',
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
				warn: jest.fn(),
			};
		});

		it('should search for text in file contents', async () => {
			const files = [
				{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } },
				{ name: 'file2.md', path: 'file2.md', stat: { size: 200, mtime: Date.now() } },
				{ name: 'file3.md', path: 'file3.md', stat: { size: 300, mtime: Date.now() } },
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
			const files = [{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('This has TEST in uppercase');

			const result = await tool.execute({ query: 'test' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.totalMatches).toBe(1);
		});

		it('should support case-sensitive search', async () => {
			const files = [{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('This has TEST in uppercase\nAnd test in lowercase');

			const result = await tool.execute({ query: 'test', caseSensitive: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.totalMatches).toBe(1);
		});

		it('should support regex patterns', async () => {
			const files = [{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('Test 123\nAnother line\nTest 456');

			const result = await tool.execute({ query: 'Test \\d+', useRegex: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.filesWithMatches).toBe(1);
			expect(result.data?.totalMatches).toBe(2);
		});

		it('should include context lines', async () => {
			const files = [{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }] as TFile[];

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
				stat: { size: 100, mtime: Date.now() },
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
				{ name: 'file2.md', path: 'file2.md', stat: { size: 200, mtime: Date.now() } },
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
			const files = [{ name: 'file1.md', path: 'file1.md', stat: { size: 100, mtime: Date.now() } }] as TFile[];

			mockVault.getMarkdownFiles.mockReturnValue(files);
			mockVault.cachedRead.mockResolvedValue('Line 1\nLine 2\nMatch here\nLine 4\nAnother match\nLine 6');

			const result = await tool.execute({ query: 'match', contextLines: 0 }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data?.results[0].matches[0].lineNumber).toBe(3);
			expect(result.data?.results[0].matches[1].lineNumber).toBe(5);
		});
	});

	describe('GetWorkspaceStateTool', () => {
		let tool: GetWorkspaceStateTool;

		beforeEach(() => {
			tool = new GetWorkspaceStateTool();
		});

		it('should return open files with metadata', async () => {
			// Note: iterateAllLeaves won't produce results in unit tests because
			// mock views don't pass the `instanceof MarkdownView` check.
			// Full behavior is verified via integration testing in Obsidian.
			const mockWorkspace = {
				getActiveFile: jest.fn().mockReturnValue(null),
				getActiveViewOfType: jest.fn().mockReturnValue(null),
				iterateAllLeaves: jest.fn(),
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
				getActiveFile: jest.fn().mockReturnValue(null),
				getActiveViewOfType: jest.fn().mockReturnValue(null),
				iterateAllLeaves: jest.fn(),
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
	});

	describe('getVaultTools', () => {
		it('should return all vault tools', () => {
			const tools = getVaultTools();

			expect(tools).toHaveLength(9);
			expect(tools.map((t) => t.name)).toContain('read_file');
			expect(tools.map((t) => t.name)).toContain('write_file');
			expect(tools.map((t) => t.name)).toContain('list_files');
			expect(tools.map((t) => t.name)).toContain('create_folder');
			expect(tools.map((t) => t.name)).toContain('delete_file');
			expect(tools.map((t) => t.name)).toContain('move_file');
			expect(tools.map((t) => t.name)).toContain('search_files');
			expect(tools.map((t) => t.name)).toContain('search_file_contents');
			expect(tools.map((t) => t.name)).toContain('get_workspace_state');
		});
	});
});
