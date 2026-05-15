import { TFile } from 'obsidian';

// Mock gemini-utils
vi.mock('@allenhutchison/gemini-utils', () => ({
	getMimeTypeWithFallback: vi.fn((filePath: string) => {
		if (filePath.endsWith('.md')) return { mimeType: 'text/markdown' };
		if (filePath.endsWith('.pdf')) return { mimeType: 'application/pdf' };
		if (filePath.endsWith('.ts')) return { mimeType: 'application/typescript' };
		if (filePath.endsWith('.json')) return { mimeType: 'application/json' };
		if (filePath.endsWith('.png')) return { mimeType: 'image/png' };
		if (filePath.endsWith('.unsupported')) return null;
		return { mimeType: 'application/octet-stream' };
	}),
	isExtensionSupportedWithFallback: vi.fn((ext: string) => {
		const supported = new Set(['.md', '.pdf', '.ts', '.json', '.png', '.txt']);
		return supported.has(ext);
	}),
}));

// Import after mocks
import { ObsidianVaultAdapter } from '../../src/services/obsidian-file-adapter';
import { isExtensionSupportedWithFallback } from '@allenhutchison/gemini-utils';

// --- Helpers ---

function makeTFile(path: string): TFile {
	const filename = path.substring(path.lastIndexOf('/') + 1);
	const dotIdx = filename.lastIndexOf('.');
	return Object.assign(new TFile(), {
		path,
		extension: dotIdx > 0 ? filename.substring(dotIdx + 1) : '',
	});
}

function createMockFile(path: string, opts?: { size?: number; mtime?: number }): TFile {
	const file = makeTFile(path);
	(file as any).stat = {
		size: opts?.size ?? 1024,
		mtime: opts?.mtime ?? Date.now(),
		ctime: Date.now(),
	};
	(file as any).parent = {
		path: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '',
	};
	return file;
}

function createMockVault(files: TFile[] = []) {
	return {
		getMarkdownFiles: vi.fn(() => files.filter((f) => f.path.endsWith('.md'))),
		getFiles: vi.fn(() => files),
		getAbstractFileByPath: vi.fn((path: string) => files.find((f) => f.path === path) ?? null),
		read: vi.fn().mockResolvedValue('file content'),
		readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
	};
}

function createMockMetadataCache(cacheByPath: Record<string, any> = {}) {
	return {
		getFileCache: vi.fn((file: TFile) => cacheByPath[file.path] ?? null),
	};
}

function createAdapter(overrides?: Record<string, any>) {
	const files = overrides?.files ?? [];
	const vault = overrides?.vault ?? createMockVault(files);
	const metadataCache = overrides?.metadataCache ?? createMockMetadataCache();

	return {
		adapter: new ObsidianVaultAdapter({
			vault,
			metadataCache,
			excludeFolders: overrides?.excludeFolders ?? [],
			historyFolder: overrides?.historyFolder ?? 'gemini-scribe',
			includeAttachments: overrides?.includeAttachments ?? false,
			logError: overrides?.logError ?? vi.fn(),
		}),
		vault,
		metadataCache,
	};
}

describe('ObsidianVaultAdapter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('shouldIndex', () => {
		describe('markdown-only mode (includeAttachments=false)', () => {
			it('should include .md files', () => {
				const { adapter } = createAdapter();
				expect(adapter.shouldIndex('notes/test.md')).toBe(true);
			});

			it('should exclude non-md files', () => {
				const { adapter } = createAdapter();
				expect(adapter.shouldIndex('files/image.png')).toBe(false);
			});

			it('should exclude .obsidian folder', () => {
				const { adapter } = createAdapter();
				expect(adapter.shouldIndex('.obsidian/config.md')).toBe(false);
			});

			it('should exclude history folder', () => {
				const { adapter } = createAdapter({ historyFolder: 'gemini-scribe' });
				expect(adapter.shouldIndex('gemini-scribe/session.md')).toBe(false);
			});

			it('should exclude user-configured folders', () => {
				const { adapter } = createAdapter({ excludeFolders: ['archive', 'templates'] });
				expect(adapter.shouldIndex('archive/old-note.md')).toBe(false);
				expect(adapter.shouldIndex('templates/daily.md')).toBe(false);
			});

			it('should include files not in excluded folders', () => {
				const { adapter } = createAdapter({ excludeFolders: ['archive'] });
				expect(adapter.shouldIndex('notes/test.md')).toBe(true);
			});

			it('should match exact folder path (not prefix)', () => {
				const { adapter } = createAdapter({ excludeFolders: ['arch'] });
				// 'archive/test.md' should NOT be excluded by 'arch' folder
				expect(adapter.shouldIndex('archive/test.md')).toBe(true);
			});
		});

		describe('attachments mode (includeAttachments=true)', () => {
			it('should include supported file types', () => {
				const { adapter } = createAdapter({ includeAttachments: true });
				expect(adapter.shouldIndex('notes/test.md')).toBe(true);
				expect(adapter.shouldIndex('files/doc.pdf')).toBe(true);
				expect(adapter.shouldIndex('files/data.json')).toBe(true);
			});

			it('should exclude unsupported file types', () => {
				const { adapter } = createAdapter({ includeAttachments: true });
				(isExtensionSupportedWithFallback as ReturnType<typeof vi.fn>).mockReturnValue(false);
				expect(adapter.shouldIndex('files/app.exe')).toBe(false);
			});

			it('should exclude files without extensions', () => {
				const { adapter } = createAdapter({ includeAttachments: true });
				expect(adapter.shouldIndex('Makefile')).toBe(false);
			});

			it('should exclude dotfiles (no real extension)', () => {
				const { adapter } = createAdapter({ includeAttachments: true });
				expect(adapter.shouldIndex('.gitignore')).toBe(false);
			});

			it('should still exclude system folders', () => {
				const { adapter } = createAdapter({ includeAttachments: true });
				expect(adapter.shouldIndex('.obsidian/config.json')).toBe(false);
			});
		});
	});

	describe('listFiles', () => {
		it('should list only markdown files when attachments disabled', async () => {
			const mdFile = createMockFile('notes/test.md');
			const pngFile = createMockFile('images/photo.png');
			const vault = createMockVault([mdFile, pngFile]);
			const { adapter } = createAdapter({ vault, files: [mdFile, pngFile] });

			const files = await adapter.listFiles('/');

			expect(files).toContain('notes/test.md');
			expect(files).not.toContain('images/photo.png');
		});

		it('should list all supported files when attachments enabled', async () => {
			const mdFile = createMockFile('notes/test.md');
			const pdfFile = createMockFile('docs/file.pdf');
			const vault = createMockVault([mdFile, pdfFile]);

			// Re-establish the mock implementation (previous test may have overridden it with mockReturnValue)
			(isExtensionSupportedWithFallback as ReturnType<typeof vi.fn>).mockImplementation((ext: string) => {
				const supported = new Set(['.md', '.pdf', '.ts', '.json', '.png', '.txt']);
				return supported.has(ext);
			});

			const { adapter } = createAdapter({ vault, files: [mdFile, pdfFile], includeAttachments: true });

			const files = await adapter.listFiles('/');

			expect(files).toContain('notes/test.md');
			expect(files).toContain('docs/file.pdf');
		});

		it('should exclude files in system folders', async () => {
			const sysFile = createMockFile('.obsidian/config.md');
			const normalFile = createMockFile('notes/test.md');
			const vault = createMockVault([sysFile, normalFile]);
			const { adapter } = createAdapter({ vault, files: [sysFile, normalFile] });

			const files = await adapter.listFiles('/');

			expect(files).not.toContain('.obsidian/config.md');
			expect(files).toContain('notes/test.md');
		});
	});

	describe('getFileInfo', () => {
		it('should return file info for existing files', async () => {
			const file = createMockFile('notes/test.md', { size: 2048, mtime: 1700000000000 });
			const vault = createMockVault([file]);
			const { adapter } = createAdapter({ vault });

			const info = await adapter.getFileInfo('notes/test.md');

			expect(info).not.toBeNull();
			expect(info!.path).toBe('notes/test.md');
			expect(info!.size).toBe(2048);
			expect(info!.mimeType).toBe('text/markdown');
		});

		it('should return null for non-existent files', async () => {
			const vault = createMockVault([]);
			const { adapter } = createAdapter({ vault });

			const info = await adapter.getFileInfo('nonexistent.md');
			expect(info).toBeNull();
		});

		it('should return null for non-file entries', async () => {
			const vault = createMockVault([]);
			vault.getAbstractFileByPath.mockReturnValue({ path: 'folder/', children: [] } as any); // TFolder-like
			const { adapter } = createAdapter({ vault });

			const info = await adapter.getFileInfo('folder/');
			expect(info).toBeNull();
		});
	});

	describe('readFileForUpload', () => {
		it('should read text files with vault.read', async () => {
			const file = createMockFile('notes/test.md', { size: 100, mtime: 1700000000000 });
			const vault = createMockVault([file]);
			vault.read.mockResolvedValue('Hello world');
			// Mock computeHash dependency
			vault.readBinary.mockResolvedValue(new ArrayBuffer(8));

			// Mock crypto.subtle
			const mockDigest = vi.fn().mockResolvedValue(new ArrayBuffer(32));
			Object.defineProperty(window, 'crypto', {
				value: { subtle: { digest: mockDigest } },
				writable: true,
				configurable: true,
			});

			const { adapter } = createAdapter({ vault });

			const result = await adapter.readFileForUpload('notes/test.md', 'notes/test.md');

			expect(result).not.toBeNull();
			expect(result!.mimeType).toBe('text/markdown');
			expect(result!.displayName).toBe('notes/test.md');
			expect(vault.read).toHaveBeenCalledWith(file);
		});

		it('should read binary files with vault.readBinary', async () => {
			const file = createMockFile('docs/file.pdf', { size: 5000 });
			const vault = createMockVault([file]);
			vault.readBinary.mockResolvedValue(new ArrayBuffer(5000));

			const mockDigest = vi.fn().mockResolvedValue(new ArrayBuffer(32));
			Object.defineProperty(window, 'crypto', {
				value: { subtle: { digest: mockDigest } },
				writable: true,
				configurable: true,
			});

			const { adapter } = createAdapter({ vault });

			const result = await adapter.readFileForUpload('docs/file.pdf', 'docs/file.pdf');

			expect(result).not.toBeNull();
			expect(result!.mimeType).toBe('application/pdf');
		});

		it('should return null for non-existent files', async () => {
			const vault = createMockVault([]);
			const { adapter } = createAdapter({ vault });

			const result = await adapter.readFileForUpload('nonexistent.md', 'nonexistent.md');
			expect(result).toBeNull();
		});

		it('should return null when getMimeType returns null (unsupported)', async () => {
			const file = createMockFile('files/data.unsupported');
			const vault = createMockVault([file]);

			const mockDigest = vi.fn().mockResolvedValue(new ArrayBuffer(32));
			Object.defineProperty(window, 'crypto', {
				value: { subtle: { digest: mockDigest } },
				writable: true,
				configurable: true,
			});

			const logError = vi.fn();
			const { adapter } = createAdapter({ vault, logError });

			const result = await adapter.readFileForUpload('files/data.unsupported', 'files/data.unsupported');

			expect(result).toBeNull();
			expect(logError).toHaveBeenCalled();
		});

		it('should return null for empty text files', async () => {
			const file = createMockFile('notes/empty.md');
			const vault = createMockVault([file]);
			vault.read.mockResolvedValue('');
			vault.readBinary.mockResolvedValue(new ArrayBuffer(0));

			const mockDigest = vi.fn().mockResolvedValue(new ArrayBuffer(32));
			Object.defineProperty(window, 'crypto', {
				value: { subtle: { digest: mockDigest } },
				writable: true,
				configurable: true,
			});

			const { adapter } = createAdapter({ vault });

			const result = await adapter.readFileForUpload('notes/empty.md', 'notes/empty.md');

			expect(result).toBeNull();
		});

		it('should handle read errors gracefully', async () => {
			const file = createMockFile('notes/broken.md');
			const vault = createMockVault([file]);
			vault.readBinary.mockRejectedValue(new Error('IO Error'));
			vault.read.mockRejectedValue(new Error('IO Error'));

			const logError = vi.fn();
			const { adapter } = createAdapter({ vault, logError });

			const result = await adapter.readFileForUpload('notes/broken.md', 'notes/broken.md');

			expect(result).toBeNull();
			expect(logError).toHaveBeenCalled();
		});
	});

	describe('computeHash', () => {
		it('should compute SHA-256 hash', async () => {
			const file = createMockFile('notes/test.md');
			const vault = createMockVault([file]);
			const binaryContent = new ArrayBuffer(4);
			vault.readBinary.mockResolvedValue(binaryContent);

			const hashBuffer = new Uint8Array([0xab, 0xcd, 0xef, 0x01]).buffer;
			const mockDigest = vi.fn().mockResolvedValue(hashBuffer);
			Object.defineProperty(window, 'crypto', {
				value: { subtle: { digest: mockDigest } },
				writable: true,
				configurable: true,
			});

			const { adapter } = createAdapter({ vault });

			const hash = await adapter.computeHash('notes/test.md');

			expect(mockDigest).toHaveBeenCalledWith('SHA-256', binaryContent);
			expect(hash).toBe('abcdef01');
		});

		it('should return empty string for non-existent files', async () => {
			const vault = createMockVault([]);
			const { adapter } = createAdapter({ vault });

			const hash = await adapter.computeHash('nonexistent.md');
			expect(hash).toBe('');
		});

		it('should fall back to metadata hash on read error', async () => {
			const file = createMockFile('notes/test.md', { mtime: 12345, size: 100 });
			const vault = createMockVault([file]);
			vault.readBinary.mockRejectedValue(new Error('Read error'));

			const logError = vi.fn();
			const { adapter } = createAdapter({ vault, logError });

			const hash = await adapter.computeHash('notes/test.md');

			expect(hash).toContain('mtime:');
			expect(hash).toContain('size:');
			expect(logError).toHaveBeenCalled();
		});
	});

	describe('extractMetadata', () => {
		it('should include folder path', () => {
			const file = createMockFile('notes/sub/test.md');
			const metadataCache = createMockMetadataCache({ 'notes/sub/test.md': null });
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const folderEntry = metadata.find((m) => m.key === 'folder');
			expect(folderEntry).toBeDefined();
			expect(folderEntry!.stringValue).toBe('notes/sub');
		});

		it('should extract frontmatter tags', () => {
			const file = createMockFile('notes/test.md');
			const metadataCache = createMockMetadataCache({
				'notes/test.md': {
					frontmatter: { tags: ['tag1', 'tag2'] },
				},
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const tagsEntry = metadata.find((m) => m.key === 'tags');
			expect(tagsEntry).toBeDefined();
			expect(tagsEntry!.stringValue).toContain('tag1');
			expect(tagsEntry!.stringValue).toContain('tag2');
		});

		it('should extract inline tags from cache.tags', () => {
			const file = createMockFile('notes/test.md');
			const metadataCache = createMockMetadataCache({
				'notes/test.md': {
					tags: [{ tag: '#inline-tag' }],
				},
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const tagsEntry = metadata.find((m) => m.key === 'tags');
			expect(tagsEntry).toBeDefined();
			// Should strip the # prefix
			expect(tagsEntry!.stringValue).toContain('inline-tag');
			expect(tagsEntry!.stringValue).not.toContain('#');
		});

		it('should combine frontmatter and inline tags', () => {
			const file = createMockFile('notes/test.md');
			const metadataCache = createMockMetadataCache({
				'notes/test.md': {
					frontmatter: { tags: ['fm-tag'] },
					tags: [{ tag: '#inline-tag' }],
				},
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const tagsEntry = metadata.find((m) => m.key === 'tags');
			expect(tagsEntry).toBeDefined();
			expect(tagsEntry!.stringValue).toContain('fm-tag');
			expect(tagsEntry!.stringValue).toContain('inline-tag');
		});

		it('should truncate tags exceeding 256 chars', () => {
			const file = createMockFile('notes/test.md');
			const longTags = Array.from({ length: 50 }, (_, i) => `long-tag-name-${i}`);
			const metadataCache = createMockMetadataCache({
				'notes/test.md': {
					frontmatter: { tags: longTags },
				},
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const tagsEntry = metadata.find((m) => m.key === 'tags');
			expect(tagsEntry).toBeDefined();
			expect(tagsEntry!.stringValue.length).toBeLessThanOrEqual(256);
			expect(tagsEntry!.stringValue).toContain('...');
		});

		it('should extract aliases from frontmatter', () => {
			const file = createMockFile('notes/test.md');
			const metadataCache = createMockMetadataCache({
				'notes/test.md': {
					frontmatter: { aliases: ['alias1', 'alias2'] },
				},
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const aliasEntry = metadata.find((m) => m.key === 'aliases');
			expect(aliasEntry).toBeDefined();
			expect(aliasEntry!.stringValue).toContain('alias1');
			expect(aliasEntry!.stringValue).toContain('alias2');
		});

		it('should truncate aliases exceeding 256 chars', () => {
			const file = createMockFile('notes/test.md');
			const longAliases = Array.from({ length: 50 }, (_, i) => `long-alias-name-${i}`);
			const metadataCache = createMockMetadataCache({
				'notes/test.md': {
					frontmatter: { aliases: longAliases },
				},
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const aliasEntry = metadata.find((m) => m.key === 'aliases');
			expect(aliasEntry).toBeDefined();
			expect(aliasEntry!.stringValue.length).toBeLessThanOrEqual(256);
			expect(aliasEntry!.stringValue).toContain('...');
		});

		it('should not include tags key when no tags exist', () => {
			const file = createMockFile('notes/test.md');
			const metadataCache = createMockMetadataCache({
				'notes/test.md': { frontmatter: {} },
			});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			const tagsEntry = metadata.find((m) => m.key === 'tags');
			expect(tagsEntry).toBeUndefined();
		});

		it('should handle files with no cache entry', () => {
			const file = createMockFile('notes/test.md');
			const metadataCache = createMockMetadataCache({});
			const { adapter } = createAdapter({ metadataCache });

			const metadata = adapter.extractMetadata(file);

			// Should still have folder
			expect(metadata.length).toBeGreaterThanOrEqual(1);
			const folderEntry = metadata.find((m) => m.key === 'folder');
			expect(folderEntry).toBeDefined();
		});
	});
});
