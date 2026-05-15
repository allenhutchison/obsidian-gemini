import { resolvePathToFile, resolvePathToFileOrFolder } from '../../../src/tools/vault/utils';

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
	getFiles: vi.fn(),
};

const mockMetadataCache = {
	getFirstLinkpathDest: vi.fn(),
};

const mockPlugin = {
	app: {
		vault: mockVault,
		metadataCache: mockMetadataCache,
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

describe('resolvePathToFile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('Strategy 1: should resolve via direct path lookup', () => {
		const file = new TFile();
		(file as any).path = 'notes/meeting.md';
		(file as any).name = 'meeting.md';
		(file as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(file);

		const result = resolvePathToFile('notes/meeting.md', mockPlugin);

		expect(result.file).toBe(file);
		expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('notes/meeting.md');
	});

	it('Strategy 2: should auto-append .md when extension is missing', () => {
		const file = new TFile();
		(file as any).path = 'notes/meeting.md';
		(file as any).name = 'meeting.md';
		(file as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'notes/meeting.md' ? file : null));

		const result = resolvePathToFile('notes/meeting', mockPlugin);

		expect(result.file).toBe(file);
		// Should have tried the original path first, then with .md
		expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('notes/meeting');
		expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('notes/meeting.md');
	});

	it('Strategy 3: should strip .md fallback when original .md path not found', () => {
		const file = new TFile();
		(file as any).path = 'data/config';
		(file as any).name = 'config';
		(file as any).extension = '';

		mockVault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'data/config' ? file : null));

		const result = resolvePathToFile('data/config.md', mockPlugin);

		expect(result.file).toBe(file);
	});

	it('Strategy 4: should resolve wikilink [[Note]] by stripping brackets', () => {
		const file = new TFile();
		(file as any).path = 'docs/My Note.md';
		(file as any).name = 'My Note.md';
		(file as any).extension = 'md';

		// Strategies 1-3 all miss
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		// Strategy 4: link resolution succeeds
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(file);

		const result = resolvePathToFile('[[My Note]]', mockPlugin);

		expect(result.file).toBe(file);
		expect(mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('My Note', '');
	});

	it('Strategy 5: should do case-insensitive search', () => {
		const file = new TFile();
		(file as any).path = 'notes/README.md';
		(file as any).name = 'README.md';
		(file as any).extension = 'md';

		// Strategies 1-4 all miss
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		// Strategy 5: getFiles returns the file with different casing
		mockVault.getFiles.mockReturnValue([file]);

		const result = resolvePathToFile('notes/readme.md', mockPlugin);

		expect(result.file).toBe(file);
	});

	it('Strategy 5: should match with .md extension variations (path without .md)', () => {
		const file = new TFile();
		(file as any).path = 'notes/readme.md';
		(file as any).name = 'readme.md';
		(file as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([file]);

		// Search without .md should still find it via case-insensitive + .md append
		const result = resolvePathToFile('notes/README', mockPlugin);

		expect(result.file).toBe(file);
	});

	it('should exclude system folder files at every strategy', () => {
		const systemFile = new TFile();
		(systemFile as any).path = '.obsidian/workspace.json';
		(systemFile as any).name = 'workspace.json';
		(systemFile as any).extension = 'json';

		// Strategy 1: direct lookup returns a system file
		mockVault.getAbstractFileByPath.mockReturnValue(systemFile);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([systemFile]);

		const result = resolvePathToFile('.obsidian/workspace.json', mockPlugin);

		expect(result.file).toBeNull();
	});

	it('should exclude historyFolder files', () => {
		const historyFile = new TFile();
		(historyFile as any).path = 'test-history-folder/session.md';
		(historyFile as any).name = 'session.md';
		(historyFile as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(historyFile);

		const result = resolvePathToFile('test-history-folder/session.md', mockPlugin);

		expect(result.file).toBeNull();
	});

	it('should generate suggestions with exclusion filtering', () => {
		const userFile = new TFile();
		(userFile as any).path = 'notes/meeting-notes.md';
		(userFile as any).name = 'meeting-notes.md';
		(userFile as any).extension = 'md';

		const systemFile = new TFile();
		(systemFile as any).path = '.obsidian/meeting-config.json';
		(systemFile as any).name = 'meeting-config.json';
		(systemFile as any).extension = 'json';

		// All strategies miss
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([userFile, systemFile]);

		const result = resolvePathToFile('meeting', mockPlugin, true);

		expect(result.file).toBeNull();
		expect(result.suggestions).toBeDefined();
		expect(result.suggestions).toContain('notes/meeting-notes.md');
		// System file should be excluded from suggestions
		expect(result.suggestions).not.toContain('.obsidian/meeting-config.json');
	});

	it('should handle empty vault edge case', () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([]);

		const result = resolvePathToFile('anything.md', mockPlugin, true);

		expect(result.file).toBeNull();
		expect(result.suggestions).toEqual([]);
	});
});

describe('resolvePathToFileOrFolder', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should return TFolder directly when found', () => {
		const folder = new TFolder();
		folder.path = 'notes/daily';
		folder.name = 'daily';

		mockVault.getAbstractFileByPath.mockReturnValue(folder);

		const result = resolvePathToFileOrFolder('notes/daily', mockPlugin);

		expect(result.item).toBe(folder);
		expect(result.type).toBe('folder');
	});

	it('should return TFile directly when found', () => {
		const file = new TFile();
		(file as any).path = 'notes/readme.md';
		(file as any).name = 'readme.md';
		(file as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(file);

		const result = resolvePathToFileOrFolder('notes/readme.md', mockPlugin);

		expect(result.item).toBe(file);
		expect(result.type).toBe('file');
	});

	it('should delegate to resolvePathToFile when direct lookup fails', () => {
		const file = new TFile();
		(file as any).path = 'notes/readme.md';
		(file as any).name = 'readme.md';
		(file as any).extension = 'md';

		// Direct lookup returns null
		mockVault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'notes/readme.md' ? file : null));
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

		// Should fall through to resolvePathToFile and find via Strategy 2 (append .md)
		const result = resolvePathToFileOrFolder('notes/readme', mockPlugin);

		expect(result.item).toBe(file);
		expect(result.type).toBe('file');
	});

	it('should return null with suggestions when nothing is found', () => {
		const userFile = new TFile();
		(userFile as any).path = 'notes/todo.md';
		(userFile as any).name = 'todo.md';
		(userFile as any).extension = 'md';

		mockVault.getAbstractFileByPath.mockReturnValue(null);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([userFile]);

		const result = resolvePathToFileOrFolder('nonexistent', mockPlugin, true);

		expect(result.item).toBeNull();
		expect(result.type).toBeNull();
		expect(result.suggestions).toBeDefined();
	});

	it('should exclude system folders from direct folder lookup', () => {
		const systemFolder = new TFolder();
		systemFolder.path = '.obsidian';
		systemFolder.name = '.obsidian';

		mockVault.getAbstractFileByPath.mockReturnValue(systemFolder);
		mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);
		mockVault.getFiles.mockReturnValue([]);

		const result = resolvePathToFileOrFolder('.obsidian', mockPlugin);

		expect(result.item).toBeNull();
		expect(result.type).toBeNull();
	});
});
