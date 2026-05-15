import { TFile } from 'obsidian';

// Mock the GeminiPrompts and debug modules
vi.mock('../../src/prompts', () => {
	const MockGeminiPrompts = vi.fn().mockImplementation(function () {
		this.contextPrompt = vi.fn(({ file_name, file_contents }: any) => `[Context: ${file_name}]\n${file_contents}`);
	});
	return { GeminiPrompts: MockGeminiPrompts };
});

vi.mock('../../src/api/utils/debug', () => ({
	logDebugInfo: vi.fn(),
}));

// Import after mocks
import { ScribeFile } from '../../src/files/index';

// --- Helpers ---

function createMockFile(path: string, extension = 'md'): TFile {
	const file = new TFile(path);
	(file as any).extension = extension;
	return file;
}

function createMockPlugin(overrides?: Record<string, any>) {
	return {
		app: {
			vault: {
				read: vi.fn().mockResolvedValue('file content'),
				modify: vi.fn().mockResolvedValue(undefined),
				getAbstractFileByPath: vi.fn(),
			},
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(null),
			},
			metadataCache: {
				fileToLinktext: vi.fn((_file: TFile, _linkPath: string) => 'test-link'),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				getFileCache: vi.fn().mockReturnValue(null),
				resolvedLinks: {} as Record<string, Record<string, number>>,
			},
			fileManager: {
				processFrontMatter: vi.fn(),
			},
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		...overrides,
	} as any;
}

describe('ScribeFile', () => {
	let plugin: ReturnType<typeof createMockPlugin>;
	let scribeFile: ScribeFile;

	beforeEach(() => {
		vi.clearAllMocks();
		plugin = createMockPlugin();
		scribeFile = new ScribeFile(plugin);
	});

	describe('isFile', () => {
		it('should return true for TFile instances', () => {
			const file = createMockFile('test.md');
			expect(scribeFile.isFile(file)).toBe(true);
		});

		it('should return false for null', () => {
			expect(scribeFile.isFile(null)).toBe(false);
		});
	});

	describe('isMarkdownFile', () => {
		it('should return true for markdown files', () => {
			const file = createMockFile('test.md');
			expect(scribeFile.isMarkdownFile(file)).toBe(true);
		});

		it('should return false for non-markdown files', () => {
			const file = createMockFile('image.png', 'png');
			expect(scribeFile.isMarkdownFile(file)).toBe(false);
		});

		it('should return false for null', () => {
			expect(scribeFile.isMarkdownFile(null)).toBe(false);
		});
	});

	describe('getActiveFile', () => {
		it('should return the active file when one exists', () => {
			const file = createMockFile('active.md');
			plugin.app.workspace.getActiveFile.mockReturnValue(file);

			const result = scribeFile.getActiveFile();
			expect(result).toBe(file);
		});

		it('should return null when no active file', () => {
			plugin.app.workspace.getActiveFile.mockReturnValue(null);

			const result = scribeFile.getActiveFile();
			expect(result).toBeNull();
		});
	});

	describe('getCurrentFileContent', () => {
		it('should return content of the active file', async () => {
			const file = createMockFile('note.md');
			plugin.app.workspace.getActiveFile.mockReturnValue(file);
			plugin.app.vault.read.mockResolvedValue('Hello world');

			const content = await scribeFile.getCurrentFileContent();
			expect(content).toBe('Hello world');
			expect(plugin.app.vault.read).toHaveBeenCalledWith(file);
		});

		it('should return null when no active file', async () => {
			plugin.app.workspace.getActiveFile.mockReturnValue(null);

			const content = await scribeFile.getCurrentFileContent();
			expect(content).toBeNull();
		});
	});

	describe('buildFileContext', () => {
		it('should return null for empty files array', async () => {
			const result = await scribeFile.buildFileContext([]);
			expect(result).toBeNull();
		});

		it('should build context from multiple files', async () => {
			const file1 = createMockFile('file1.md');
			const file2 = createMockFile('file2.md');
			plugin.app.vault.read.mockResolvedValueOnce('Content 1').mockResolvedValueOnce('Content 2');

			const result = await scribeFile.buildFileContext([file1, file2]);

			expect(result).not.toBeNull();
			expect(result).toContain('The following files have been provided as context');
			expect(plugin.app.vault.read).toHaveBeenCalledTimes(2);
		});

		it('should handle read errors gracefully', async () => {
			const file1 = createMockFile('file1.md');
			const file2 = createMockFile('file2.md');
			plugin.app.vault.read.mockRejectedValueOnce(new Error('Read error')).mockResolvedValueOnce('Content 2');

			const result = await scribeFile.buildFileContext([file1, file2]);

			expect(result).not.toBeNull();
			expect(plugin.logger.error).toHaveBeenCalled();
		});

		it('should return null when all files fail to read', async () => {
			const file1 = createMockFile('file1.md');
			plugin.app.vault.read.mockRejectedValue(new Error('Read error'));

			const result = await scribeFile.buildFileContext([file1]);

			expect(result).toBeNull();
		});
	});

	describe('getLinkText', () => {
		it('should return wikilink format', () => {
			const file = createMockFile('note.md');
			plugin.app.metadataCache.fileToLinktext.mockReturnValue('note');

			const link = scribeFile.getLinkText(file, 'note.md');
			expect(link).toBe('[[note]]');
		});
	});

	describe('normalizePath', () => {
		it('should return TFile for valid markdown link', () => {
			const file = createMockFile('source.md');
			const targetFile = createMockFile('target.md');
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(targetFile);

			const result = scribeFile.normalizePath('target', file);
			expect(result).toBe(targetFile);
		});

		it('should return null for non-markdown files', () => {
			const file = createMockFile('source.md');
			const targetFile = createMockFile('image.png', 'png');
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(targetFile);

			const result = scribeFile.normalizePath('image', file);
			expect(result).toBeNull();
		});

		it('should return null when link path does not resolve', () => {
			const file = createMockFile('source.md');
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const result = scribeFile.normalizePath('nonexistent', file);
			expect(result).toBeNull();
		});
	});

	describe('normalizeLinkPathsFromMetadata', () => {
		it('should extract normalized links from cache', () => {
			const sourceFile = createMockFile('source.md');
			const linkedFile = createMockFile('linked.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				links: [{ link: 'linked' }],
				embeds: [],
				frontmatterLinks: [],
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(linkedFile);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.links).toEqual([linkedFile]);
			expect(result.embeds).toEqual([]);
			expect(result.frontmatterLinks).toEqual([]);
		});

		it('should extract embeds from cache', () => {
			const sourceFile = createMockFile('source.md');
			const embedFile = createMockFile('embed.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				links: [],
				embeds: [{ link: 'embed' }],
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(embedFile);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.embeds).toEqual([embedFile]);
		});

		it('should extract frontmatterLinks from cache', () => {
			const sourceFile = createMockFile('source.md');
			const fmFile = createMockFile('fm-linked.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				links: [],
				embeds: [],
				frontmatterLinks: [{ link: 'fm-linked' }],
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(fmFile);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.frontmatterLinks).toEqual([fmFile]);
		});

		it('should handle frontmatter.links as array', () => {
			const sourceFile = createMockFile('source.md');
			const linkedFile = createMockFile('linked.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					links: ['linked'],
				},
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(linkedFile);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.frontmatterLinks).toContain(linkedFile);
		});

		it('should handle frontmatter.links as string', () => {
			const sourceFile = createMockFile('source.md');
			const linkedFile = createMockFile('linked.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					links: 'linked',
				},
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(linkedFile);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.frontmatterLinks).toContain(linkedFile);
		});

		it('should return empty arrays when no cache', () => {
			const sourceFile = createMockFile('source.md');
			plugin.app.metadataCache.getFileCache.mockReturnValue(null);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.links).toEqual([]);
			expect(result.embeds).toEqual([]);
			expect(result.frontmatterLinks).toEqual([]);
		});

		it('should skip links that cannot be normalized', () => {
			const sourceFile = createMockFile('source.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				links: [{ link: 'nonexistent' }, { link: 'also-missing' }],
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const result = scribeFile.normalizeLinkPathsFromMetadata(sourceFile);

			expect(result.links).toEqual([]);
		});
	});

	describe('getUniqueLinks', () => {
		it('should deduplicate links across all sources', () => {
			const sourceFile = createMockFile('source.md');
			const sharedFile = createMockFile('shared.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				links: [{ link: 'shared' }],
				embeds: [{ link: 'shared' }],
				frontmatterLinks: [{ link: 'shared' }],
			});
			plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(sharedFile);

			const result = scribeFile.getUniqueLinks(sourceFile);

			// Set should deduplicate the same file reference
			expect(result.size).toBe(1);
			expect(result.has(sharedFile)).toBe(true);
		});

		it('should combine links from all sources', () => {
			const sourceFile = createMockFile('source.md');
			const linkFile = createMockFile('link.md');
			const embedFile = createMockFile('embed.md');

			plugin.app.metadataCache.getFileCache.mockReturnValue({
				links: [{ link: 'link' }],
				embeds: [{ link: 'embed' }],
			});

			let callCount = 0;
			plugin.app.metadataCache.getFirstLinkpathDest.mockImplementation(() => {
				return callCount++ === 0 ? linkFile : embedFile;
			});

			const result = scribeFile.getUniqueLinks(sourceFile);

			expect(result.size).toBe(2);
		});
	});

	describe('getBacklinks', () => {
		it('should find files that link to the target', () => {
			const targetFile = createMockFile('target.md');
			const source1 = createMockFile('source1.md');
			const source2 = createMockFile('source2.md');

			plugin.app.metadataCache.resolvedLinks = {
				'source1.md': { 'target.md': 1 },
				'source2.md': { 'target.md': 2 },
				'source3.md': { 'other.md': 1 },
			};

			plugin.app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'source1.md') return source1;
				if (path === 'source2.md') return source2;
				return null;
			});

			const result = scribeFile.getBacklinks(targetFile);

			expect(result.size).toBe(2);
			expect(result.has(source1)).toBe(true);
			expect(result.has(source2)).toBe(true);
		});

		it('should return empty set when no backlinks exist', () => {
			const targetFile = createMockFile('isolated.md');

			plugin.app.metadataCache.resolvedLinks = {
				'source.md': { 'other.md': 1 },
			};

			const result = scribeFile.getBacklinks(targetFile);

			expect(result.size).toBe(0);
		});

		it('should skip non-TFile entries from getAbstractFileByPath', () => {
			const targetFile = createMockFile('target.md');

			plugin.app.metadataCache.resolvedLinks = {
				'folder/': { 'target.md': 1 },
			};

			plugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: 'folder/' }); // Not a TFile

			const result = scribeFile.getBacklinks(targetFile);

			expect(result.size).toBe(0);
		});
	});

	describe('addToFrontMatter', () => {
		it('should call processFrontMatter on the active file', async () => {
			const file = createMockFile('note.md');
			plugin.app.workspace.getActiveFile.mockReturnValue(file);

			await scribeFile.addToFrontMatter('summary', 'A summary');

			expect(plugin.app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
		});

		it('should not call processFrontMatter when no active file', async () => {
			plugin.app.workspace.getActiveFile.mockReturnValue(null);

			await scribeFile.addToFrontMatter('summary', 'A summary');

			expect(plugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});
	});

	describe('replaceTextInActiveFile', () => {
		it('should modify the active file content', async () => {
			const file = createMockFile('note.md');
			plugin.app.workspace.getActiveFile.mockReturnValue(file);

			await scribeFile.replaceTextInActiveFile('new content');

			expect(plugin.app.vault.modify).toHaveBeenCalledWith(file, 'new content');
		});

		it('should not modify when no active file', async () => {
			plugin.app.workspace.getActiveFile.mockReturnValue(null);

			await scribeFile.replaceTextInActiveFile('new content');

			expect(plugin.app.vault.modify).not.toHaveBeenCalled();
		});
	});
});
