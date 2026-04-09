jest.mock('obsidian', () => {
	const MockTFile = class {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	};
	return {
		TFile: MockTFile,
		normalizePath: (path: string) => path,
	};
});

import { RagCache } from '../../src/services/rag-cache';
import { TFile } from 'obsidian';

function createMockTFile(path: string): TFile {
	return new (TFile as any)(path) as TFile;
}

function createMockPlugin(overrides: Partial<any> = {}) {
	return {
		app: {
			vault: {
				getAbstractFileByPath: jest.fn().mockReturnValue(null),
				read: jest.fn().mockResolvedValue('{}'),
				modify: jest.fn().mockResolvedValue(undefined),
				create: jest.fn().mockResolvedValue(undefined),
				adapter: {
					write: jest.fn().mockResolvedValue(undefined),
					exists: jest.fn().mockResolvedValue(false),
					read: jest.fn().mockResolvedValue('{}'),
				},
			},
		},
		settings: {
			historyFolder: 'gemini-scribe',
		},
		logger: {
			log: jest.fn(),
			debug: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		},
		...overrides,
	} as any;
}

describe('RagCache', () => {
	let cache: RagCache;
	let mockPlugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockPlugin = createMockPlugin();
		cache = new RagCache(mockPlugin);
	});

	describe('constructor', () => {
		it('should initialize with null cache', () => {
			expect(cache.cache).toBeNull();
		});

		it('should initialize with zero indexed count', () => {
			expect(cache.indexedCount).toBe(0);
		});
	});

	describe('cachePath', () => {
		it('should return normalized path based on settings', () => {
			expect(cache.cachePath).toBe('gemini-scribe/rag-index-cache.json');
		});
	});

	describe('loadCache', () => {
		it('should initialize empty cache when no file exists', async () => {
			await cache.loadCache();

			expect(cache.cache).toEqual({
				version: '1.0',
				storeName: '',
				lastSync: 0,
				files: {},
			});
		});

		it('should load valid cache from vault file', async () => {
			const cacheData = {
				version: '1.0',
				storeName: 'test-store',
				lastSync: 1234567890,
				files: {
					'test.md': { resourceName: 'res1', contentHash: 'hash1', lastIndexed: 1234567890 },
				},
			};

			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
			mockPlugin.app.vault.read.mockResolvedValue(JSON.stringify(cacheData));

			await cache.loadCache();

			expect(cache.cache).toEqual(cacheData);
			expect(cache.indexedCount).toBe(1);
		});

		it('should fall back to adapter.read when file exists on disk but not in metadata', async () => {
			const cacheData = {
				version: '1.0',
				storeName: 'test-store',
				lastSync: 0,
				files: {},
			};

			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
			mockPlugin.app.vault.adapter.exists.mockResolvedValue(true);
			mockPlugin.app.vault.adapter.read.mockResolvedValue(JSON.stringify(cacheData));

			await cache.loadCache();

			expect(cache.cache).toEqual(cacheData);
		});

		it('should reset cache on version mismatch', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
			mockPlugin.app.vault.read.mockResolvedValue(
				JSON.stringify({ version: '0.5', storeName: 'old', files: { x: {} } })
			);

			await cache.loadCache();

			expect(cache.cache!.version).toBe('1.0');
			expect(cache.cache!.storeName).toBe('old');
			expect(cache.cache!.files).toEqual({});
		});

		it('should handle corrupt JSON gracefully', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
			mockPlugin.app.vault.read.mockResolvedValue('not json');

			await cache.loadCache();

			expect(cache.cache).toEqual({
				version: '1.0',
				storeName: '',
				lastSync: 0,
				files: {},
			});
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});

		it('should reset indexedCount when reloading with empty/corrupt data', async () => {
			// First load with valid data
			const cacheData = {
				version: '1.0',
				storeName: 'test-store',
				lastSync: 1234567890,
				files: {
					'test.md': { resourceName: 'res1', contentHash: 'hash1', lastIndexed: 1234567890 },
				},
			};
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
			mockPlugin.app.vault.read.mockResolvedValue(JSON.stringify(cacheData));

			await cache.loadCache();
			expect(cache.indexedCount).toBe(1);

			// Second load with corrupt data
			mockPlugin.app.vault.read.mockResolvedValue('not json');

			await cache.loadCache();
			expect(cache.indexedCount).toBe(0);
		});
	});

	describe('saveCache', () => {
		it('should not save when cache is null', async () => {
			await cache.saveCache();
			expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
			expect(mockPlugin.app.vault.create).not.toHaveBeenCalled();
		});

		it('should modify existing file', async () => {
			cache.cache = { version: '1.0', storeName: 'test', lastSync: 0, files: {} };
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));

			await cache.saveCache();

			expect(mockPlugin.app.vault.modify).toHaveBeenCalled();
		});

		it('should create new file when it does not exist', async () => {
			cache.cache = { version: '1.0', storeName: 'test', lastSync: 0, files: {} };

			await cache.saveCache();

			expect(mockPlugin.app.vault.create).toHaveBeenCalled();
		});

		it('should fallback to adapter.write on race condition', async () => {
			cache.cache = { version: '1.0', storeName: 'test', lastSync: 0, files: {} };
			mockPlugin.app.vault.create.mockRejectedValue(new Error('File already exists'));

			await cache.saveCache();

			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
		});
	});

	describe('incrementAndMaybeSaveCache', () => {
		it('should increment counter below threshold', async () => {
			cache.cache = { version: '1.0', storeName: 'test', lastSync: 0, files: {} };

			const result = await cache.incrementAndMaybeSaveCache(5);

			expect(result).toBe(6);
			expect(mockPlugin.app.vault.create).not.toHaveBeenCalled();
		});

		it('should save and reset at threshold', async () => {
			cache.cache = { version: '1.0', storeName: 'test', lastSync: 0, files: {} };

			const result = await cache.incrementAndMaybeSaveCache(9); // 9+1 = 10 = CACHE_SAVE_INTERVAL

			expect(result).toBe(0);
		});
	});

	describe('refreshIndexedCount', () => {
		it('should update count from cache files', () => {
			cache.cache = {
				version: '1.0',
				storeName: 'test',
				lastSync: 0,
				files: {
					'a.md': { resourceName: 'r1', contentHash: 'h1', lastIndexed: 0 },
					'b.md': { resourceName: 'r2', contentHash: 'h2', lastIndexed: 0 },
				},
			};

			cache.refreshIndexedCount();

			expect(cache.indexedCount).toBe(2);
		});

		it('should return 0 when cache is null', () => {
			cache.refreshIndexedCount();
			expect(cache.indexedCount).toBe(0);
		});
	});

	describe('destroy', () => {
		it('should clear cache and count', () => {
			cache.cache = { version: '1.0', storeName: 'test', lastSync: 0, files: {} };
			cache.indexedCount = 5;

			cache.destroy();

			expect(cache.cache).toBeNull();
			expect(cache.indexedCount).toBe(0);
		});
	});
});
