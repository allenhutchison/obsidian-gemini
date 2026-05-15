import { SearchFileContentsTool } from '../../../src/tools/vault';
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
import { TFile } from 'obsidian';

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

describe('SearchFileContentsTool', () => {
	let tool: SearchFileContentsTool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = new SearchFileContentsTool();
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

	// --- Gap coverage tests ---

	it('should cap contextLines at 5 even when a higher value is passed', async () => {
		// Build a file with enough lines to detect whether 10 or 5 context lines were used
		const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
		lines[10] = 'MATCH_HERE'; // line 11 (0-indexed 10)

		const files = [{ name: 'big.md', path: 'big.md', stat: { size: 500, mtime: Date.now() } }] as TFile[];
		mockVault.getMarkdownFiles.mockReturnValue(files);
		mockVault.cachedRead.mockResolvedValue(lines.join('\n'));

		const result = await tool.execute({ query: 'MATCH_HERE', contextLines: 10 }, mockContext);

		expect(result.success).toBe(true);
		const match = result.data?.results[0].matches[0];
		// contextBefore should be capped at 5, not 10
		expect(match.contextBefore).toHaveLength(5);
		// contextAfter should also be capped at 5
		expect(match.contextAfter).toHaveLength(5);
	});

	it('should cap matches per file at 10', async () => {
		// Build a file with 15 matching lines
		const lines = Array.from({ length: 15 }, (_, i) => `keyword on line ${i + 1}`);

		const files = [{ name: 'many.md', path: 'many.md', stat: { size: 500, mtime: Date.now() } }] as TFile[];
		mockVault.getMarkdownFiles.mockReturnValue(files);
		mockVault.cachedRead.mockResolvedValue(lines.join('\n'));

		const result = await tool.execute({ query: 'keyword', contextLines: 0 }, mockContext);

		expect(result.success).toBe(true);
		expect(result.data?.results).toHaveLength(1);
		// Should be capped at 10 matches per file
		expect(result.data?.results[0].matches).toHaveLength(10);
		expect(result.data?.totalMatches).toBe(10);
	});

	it('should scope results to project root when set', async () => {
		const files = [
			{ name: 'todo.md', path: 'projects/myproj/todo.md', stat: { size: 100, mtime: Date.now() } },
			{ name: 'todo.md', path: 'personal/todo.md', stat: { size: 100, mtime: Date.now() } },
		] as TFile[];

		mockVault.getMarkdownFiles.mockReturnValue(files);
		mockVault.cachedRead.mockResolvedValue('important task here');

		const contextWithProject: ToolExecutionContext = {
			...mockContext,
			projectRootPath: 'projects/myproj',
		} as any;

		const result = await tool.execute({ query: 'important' }, contextWithProject);

		expect(result.success).toBe(true);
		expect(result.data?.results).toHaveLength(1);
		expect(result.data?.results[0].path).toBe('projects/myproj/todo.md');
	});

	it('should handle context at file boundaries (first and last line)', async () => {
		const files = [{ name: 'edge.md', path: 'edge.md', stat: { size: 100, mtime: Date.now() } }] as TFile[];

		mockVault.getMarkdownFiles.mockReturnValue(files);
		// Match on the very first line
		mockVault.cachedRead.mockResolvedValue('match first\nLine 2\nLine 3\nLine 4\nLine 5');

		const result1 = await tool.execute({ query: 'match first', contextLines: 3 }, mockContext);

		expect(result1.success).toBe(true);
		const match1 = result1.data?.results[0].matches[0];
		// No lines before the first line
		expect(match1.contextBefore).toHaveLength(0);
		expect(match1.contextAfter).toHaveLength(3);

		vi.clearAllMocks();
		mockVault.getMarkdownFiles.mockReturnValue(files);
		// Match on the very last line
		mockVault.cachedRead.mockResolvedValue('Line 1\nLine 2\nLine 3\nLine 4\nmatch last');

		const result2 = await tool.execute({ query: 'match last', contextLines: 3 }, mockContext);

		expect(result2.success).toBe(true);
		const match2 = result2.data?.results[0].matches[0];
		expect(match2.contextBefore).toHaveLength(3);
		// No lines after the last line
		expect(match2.contextAfter).toHaveLength(0);
	});
});
