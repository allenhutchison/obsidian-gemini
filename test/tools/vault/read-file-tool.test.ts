import { ReadFileTool } from '../../../src/tools/vault';
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

describe('ReadFileTool', () => {
	let tool: ReadFileTool;

	beforeEach(() => {
		vi.clearAllMocks();
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

	// --- Gap coverage tests ---

	it('should not hard-block agent session paths (isAgentSessionPath allowlisting)', async () => {
		// The allowlist bypasses the initial "Cannot read from system folder" guard.
		// The path is still in the history folder, so resolvePathToFileOrFolder filters
		// it via shouldExcludePath — the result is a soft "does not exist" rather than
		// the hard "Cannot read from system folder" error.
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([]);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

		const result = await tool.execute({ path: 'test-history-folder/Agent-Sessions/session-1.md' }, mockContext);

		// Should NOT return "Cannot read from system folder" error
		expect(result.success).toBe(true);
		expect(result.data?.exists).toBe(false);
		// Contrast with non-agent-session history paths which are hard-blocked
	});

	it('should hard-block non-agent-session history folder paths', async () => {
		const result = await tool.execute({ path: 'test-history-folder/History/some-file.md' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot read from system folder');
	});

	it('should block reading .obsidian files even if they exist', async () => {
		const obsidianFile = new TFile();
		(obsidianFile as any).path = '.obsidian/app.json';
		(obsidianFile as any).name = 'app.json';
		(obsidianFile as any).extension = 'json';
		(obsidianFile as any).stat = { size: 50, mtime: Date.now(), ctime: Date.now() };

		mockVault.getAbstractFileByPath.mockReturnValue(obsidianFile);

		const result = await tool.execute({ path: '.obsidian/app.json' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Cannot read from system folder');
	});

	it('should include outgoing links and backlinks when present', async () => {
		const linkedFile = new TFile();
		(linkedFile as any).path = 'linked-note.md';
		(linkedFile as any).name = 'linked-note.md';
		(linkedFile as any).extension = 'md';

		const backlinkFile = new TFile();
		(backlinkFile as any).path = 'referring-note.md';
		(backlinkFile as any).name = 'referring-note.md';
		(backlinkFile as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.read.mockResolvedValue('file with links');

		// Override gfile mocks to return non-empty sets
		mockPlugin.gfile.getUniqueLinks.mockReturnValue(new Set([linkedFile]));
		mockPlugin.gfile.getBacklinks.mockReturnValue(new Set([backlinkFile]));

		const result = await tool.execute({ path: 'test.md' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data.outgoingLinks).toHaveLength(1);
		expect(result.data.outgoingLinks[0]).toBe('[[linked-note.md]]');
		expect(result.data.backlinks).toHaveLength(1);
		expect(result.data.backlinks[0]).toBe('[[referring-note.md]]');
	});

	it('should return error when vault.read() throws', async () => {
		const readableFile = new TFile();
		(readableFile as any).path = 'broken.md';
		(readableFile as any).name = 'broken.md';
		(readableFile as any).extension = 'md';
		(readableFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };

		mockVault.getAbstractFileByPath.mockReturnValue(readableFile);
		mockVault.read.mockRejectedValue(new Error('Disk read failure'));

		const result = await tool.execute({ path: 'broken.md' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Error reading file or folder');
		expect(result.error).toContain('Disk read failure');
	});

	it('should return progress description with path', () => {
		expect(tool.getProgressDescription({ path: 'notes/test.md' })).toBe('Reading notes/test.md');
	});

	it('should return generic progress description without path', () => {
		expect(tool.getProgressDescription({ path: '' })).toBe('Reading file');
	});
});
