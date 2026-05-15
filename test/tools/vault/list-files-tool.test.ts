import { ListFilesTool } from '../../../src/tools/vault';
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

describe('ListFilesTool', () => {
	let tool: ListFilesTool;

	beforeEach(() => {
		vi.clearAllMocks();
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

	it('should strip a trailing slash before folder lookup', async () => {
		// Obsidian stores folder paths without trailing slashes, so
		// getAbstractFileByPath('Areas/People/') would return null.
		// The tool must normalize the path before lookup.
		mockVault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'Areas/People' ? mockFolder : null));

		const result = await tool.execute({ path: 'Areas/People/' }, mockContext);

		expect(result.success).toBe(true);
		expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('Areas/People');
		expect(result.data?.path).toBe('Areas/People');
	});

	it('should treat "/" as the vault root', async () => {
		const rootFolder = new TFolder();
		rootFolder.children = [mockFile];
		mockVault.getRoot.mockReturnValue(rootFolder);

		const result = await tool.execute({ path: '/' }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.path).toBe('');
		expect(result.data?.count).toBe(1);
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

	// --- Gap coverage tests ---

	it('should return error when path is not a folder (TFile at path)', async () => {
		// getAbstractFileByPath returns a TFile (not a TFolder)
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

		const result = await tool.execute({ path: 'test.md' }, mockContext);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Path is not a folder');
	});

	it('should fallback to projectRootPath when path is empty', async () => {
		const projectFolder = new TFolder();
		projectFolder.path = 'projects/my-project';
		projectFolder.name = 'my-project';
		projectFolder.children = [mockFile];

		mockVault.getAbstractFileByPath.mockImplementation((p: string) =>
			p === 'projects/my-project' ? projectFolder : null
		);

		const contextWithProject: ToolExecutionContext = {
			...mockContext,
			projectRootPath: 'projects/my-project',
		} as any;

		const result = await tool.execute({ path: '' }, contextWithProject);

		expect(result.success).toBe(true);
		expect(result.data?.path).toBe('projects/my-project');
		expect(result.data?.count).toBe(1);
	});

	it('should apply boundary-aware folder filter for recursive listing under a subfolder', async () => {
		// Files inside the target folder and a sibling folder with a similar prefix
		const insideFile = new TFile();
		(insideFile as any).path = 'notes/daily/2024-01-01.md';
		(insideFile as any).name = '2024-01-01.md';
		(insideFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };

		const siblingFile = new TFile();
		(siblingFile as any).path = 'notes-archive/old.md';
		(siblingFile as any).name = 'old.md';
		(siblingFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };

		const otherInsideFile = new TFile();
		(otherInsideFile as any).path = 'notes/meetings/standup.md';
		(otherInsideFile as any).name = 'standup.md';
		(otherInsideFile as any).stat = { size: 100, mtime: Date.now(), ctime: Date.now() };

		const notesFolder = new TFolder();
		notesFolder.path = 'notes';
		notesFolder.name = 'notes';
		notesFolder.children = [];

		mockVault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'notes' ? notesFolder : null));
		mockVault.getFiles.mockReturnValue([insideFile, siblingFile, otherInsideFile]);

		const result = await tool.execute({ path: 'notes', recursive: true }, mockContext);

		expect(result.success).toBe(true);
		// Should include files under 'notes/' but NOT 'notes-archive/'
		expect(result.data?.count).toBe(2);
		const paths = result.data?.files.map((f: any) => f.path);
		expect(paths).toContain('notes/daily/2024-01-01.md');
		expect(paths).toContain('notes/meetings/standup.md');
		expect(paths).not.toContain('notes-archive/old.md');
	});
});
