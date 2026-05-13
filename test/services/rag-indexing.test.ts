// Mock obsidian module with TFile class defined inside
vi.mock('obsidian', () => {
	// Define MockTFile inside the factory to avoid hoisting issues
	const MockTFile = class {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	};
	return {
		TFile: MockTFile,
		normalizePath: (path: string) => path,
		Notice: vi.fn(),
		setIcon: vi.fn(),
		setTooltip: vi.fn(),
	};
});

import { RagIndexingService, RagIndexCache } from '../../src/services/rag-indexing';
import { TFile } from 'obsidian';

// Mock GoogleGenAI
vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(function () {
		return {
			fileSearchStores: {
				get: vi.fn().mockResolvedValue({ name: 'test-store' }),
				create: vi.fn().mockResolvedValue({ name: 'new-store' }),
				delete: vi.fn().mockResolvedValue(undefined),
			},
		};
	}),
}));

// Mock FileUploader
vi.mock('@allenhutchison/gemini-utils', () => ({
	FileUploader: vi.fn().mockImplementation(function () {
		return {
			uploadWithAdapter: vi.fn().mockResolvedValue(undefined),
			uploadContent: vi.fn().mockResolvedValue(undefined),
		};
	}),
}));

// Mock ObsidianVaultAdapter
vi.mock('../../src/services/obsidian-file-adapter', () => ({
	ObsidianVaultAdapter: vi.fn().mockImplementation(function () {
		return {
			shouldIndex: vi.fn().mockReturnValue(true),
			listFiles: vi.fn().mockResolvedValue([]),
			readFileForUpload: vi.fn().mockResolvedValue({ content: 'test', hash: 'abc123' }),
			computeHash: vi.fn().mockResolvedValue('hash123'),
		};
	}),
}));

// Create mock TFile - use the mocked TFile class so instanceof checks work
function createMockTFile(path: string): TFile {
	return new (TFile as any)(path) as TFile;
}

// Create mock plugin
function createMockPlugin(overrides: Partial<any> = {}) {
	const mockVault = {
		getAbstractFileByPath: vi.fn().mockReturnValue(null),
		read: vi.fn().mockResolvedValue('{}'),
		modify: vi.fn().mockResolvedValue(undefined),
		create: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		getMarkdownFiles: vi.fn().mockReturnValue([]),
		getFiles: vi.fn().mockReturnValue([]),
		getName: vi.fn().mockReturnValue('test-vault'),
		adapter: {
			write: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(false),
		},
	};

	return {
		app: {
			vault: mockVault,
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
			},
		},
		apiKey: 'test-api-key',
		settings: {
			historyFolder: 'gemini-scribe',
			ragIndexing: {
				enabled: true,
				fileSearchStoreName: 'test-store',
				excludeFolders: [],
				autoSync: true,
				includeAttachments: false,
			},
			...overrides.settings,
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		saveData: vi.fn().mockResolvedValue(undefined),
		addStatusBarItem: vi.fn().mockReturnValue({
			addClass: vi.fn(),
			createSpan: vi.fn().mockReturnValue({
				setText: vi.fn(),
			}),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			style: {},
			querySelector: vi.fn().mockReturnValue(null),
			removeClass: vi.fn(),
		}),
		...overrides,
	} as any;
}

// Helper to access internal sync queue from the service
function getSyncQueue(service: any) {
	return service.syncQueue;
}

// Helper to access internal cache module from the service
function getRagCache(service: any) {
	return service.ragCache;
}

// Helper to access internal rate limiter from the service
function getRateLimiter(service: any) {
	return service.rateLimiter;
}

// Helper to access internal vault scanner from the service
function getVaultScanner(service: any) {
	return service.vaultScanner;
}

describe('RagIndexingService', () => {
	let service: RagIndexingService;
	let mockPlugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockPlugin = createMockPlugin();
		service = new RagIndexingService(mockPlugin);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('constructor', () => {
		it('should create service with disabled status', () => {
			expect(service.getStatus()).toBe('disabled');
		});

		it('should have zero indexed files initially', () => {
			expect(service.getIndexedFileCount()).toBe(0);
		});
	});

	describe('getStatus', () => {
		it('should return current status', () => {
			expect(service.getStatus()).toBe('disabled');
		});
	});

	describe('isReady', () => {
		it('should return false when disabled', () => {
			expect(service.isReady()).toBe(false);
		});

		it('should return false when in error state', () => {
			(service as any).status = 'error';
			expect(service.isReady()).toBe(false);
		});

		it('should return false when ai client is null', () => {
			(service as any).status = 'idle';
			(service as any).ai = null;
			expect(service.isReady()).toBe(false);
		});

		it('should return true when idle with ai client', () => {
			(service as any).status = 'idle';
			(service as any).ai = {};
			expect(service.isReady()).toBe(true);
		});
	});

	describe('isPaused', () => {
		it('should return false when not paused', () => {
			(service as any).status = 'idle';
			expect(service.isPaused()).toBe(false);
		});

		it('should return true when paused', () => {
			(service as any).status = 'paused';
			expect(service.isPaused()).toBe(true);
		});
	});

	describe('pause', () => {
		it('should pause from idle state', () => {
			(service as any).status = 'idle';
			service.pause();
			expect(service.getStatus()).toBe('paused');
		});

		it('should not pause from non-idle state', () => {
			(service as any).status = 'indexing';
			service.pause();
			expect(service.getStatus()).toBe('indexing');
		});

		it('should clear debounce timer when pausing', () => {
			(service as any).status = 'idle';
			getSyncQueue(service).debounceTimer = window.setTimeout(() => {}, 1000);
			service.pause();
			expect(getSyncQueue(service).debounceTimer).toBeNull();
		});
	});

	describe('resume', () => {
		it('should resume from paused state', () => {
			(service as any).status = 'paused';
			service.resume();
			expect(service.getStatus()).toBe('idle');
		});

		it('should not resume from non-paused state', () => {
			(service as any).status = 'idle';
			service.resume();
			expect(service.getStatus()).toBe('idle');
		});

		it('should process pending changes on resume', () => {
			(service as any).status = 'paused';
			getSyncQueue(service).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);
			const flushSpy = vi.spyOn(getSyncQueue(service), 'flushPendingChanges').mockResolvedValue(undefined);

			service.resume();

			expect(flushSpy).toHaveBeenCalled();
		});
	});

	describe('getPendingCount', () => {
		it('should return 0 when no pending changes', () => {
			expect(service.getPendingCount()).toBe(0);
		});

		it('should return count of pending changes', () => {
			getSyncQueue(service).pendingChanges = new Map([
				['file1.md', { type: 'create', path: 'file1.md', timestamp: Date.now() }],
				['file2.md', { type: 'modify', path: 'file2.md', timestamp: Date.now() }],
			]);
			expect(service.getPendingCount()).toBe(2);
		});
	});

	describe('change collapsing (queueChange)', () => {
		beforeEach(() => {
			// Setup service to be ready
			(service as any).status = 'idle';
			(service as any).ai = {};
			(service as any).vaultAdapter = {
				shouldIndex: vi.fn().mockReturnValue(true),
			};
			mockPlugin.settings.ragIndexing.autoSync = true;
		});

		it('should queue a single change', () => {
			getSyncQueue(service).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).pendingChanges.size).toBe(1);
			expect(getSyncQueue(service).pendingChanges.get('test.md').type).toBe('create');
		});

		it('should collapse create + delete to no-op', () => {
			getSyncQueue(service).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});
			getSyncQueue(service).queueChange({
				type: 'delete',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).pendingChanges.size).toBe(0);
		});

		it('should collapse create + modify to create', () => {
			getSyncQueue(service).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});
			getSyncQueue(service).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).pendingChanges.size).toBe(1);
			expect(getSyncQueue(service).pendingChanges.get('test.md').type).toBe('create');
		});

		it('should use latest change for modify + delete', () => {
			getSyncQueue(service).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: Date.now(),
			});
			getSyncQueue(service).queueChange({
				type: 'delete',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).pendingChanges.size).toBe(1);
			expect(getSyncQueue(service).pendingChanges.get('test.md').type).toBe('delete');
		});

		it('should use latest change for modify + modify', () => {
			const timestamp1 = Date.now();
			const timestamp2 = timestamp1 + 1000;

			getSyncQueue(service).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: timestamp1,
			});
			getSyncQueue(service).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: timestamp2,
			});

			expect(getSyncQueue(service).pendingChanges.size).toBe(1);
			expect(getSyncQueue(service).pendingChanges.get('test.md').timestamp).toBe(timestamp2);
		});

		it('should not start debounce timer when paused', () => {
			(service as any).status = 'paused';
			getSyncQueue(service).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).debounceTimer).toBeNull();
			expect(getSyncQueue(service).pendingChanges.size).toBe(1);
		});

		it('should start debounce timer when not paused', () => {
			getSyncQueue(service).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).debounceTimer).not.toBeNull();
		});

		it('should call flushPendingChanges after debounce timer fires', async () => {
			const flushSpy = vi.spyOn(getSyncQueue(service), 'flushPendingChanges').mockResolvedValue(undefined);

			getSyncQueue(service).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect(getSyncQueue(service).debounceTimer).not.toBeNull();

			// Advance timer past debounce period (2000ms)
			vi.advanceTimersByTime(2500);

			expect(flushSpy).toHaveBeenCalled();
		});
	});

	describe('file event handlers', () => {
		beforeEach(() => {
			// Setup service to be ready
			(service as any).status = 'idle';
			(service as any).ai = {};
			(service as any).vaultAdapter = {
				shouldIndex: vi.fn().mockReturnValue(true),
			};
			mockPlugin.settings.ragIndexing.autoSync = true;
		});

		describe('onFileCreate', () => {
			it('should queue create change for indexable file', () => {
				const file = createMockTFile('notes/test.md');
				service.onFileCreate(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(1);
				expect(getSyncQueue(service).pendingChanges.get('notes/test.md').type).toBe('create');
			});

			it('should not queue when service is not ready', () => {
				(service as any).status = 'disabled';
				const file = createMockTFile('notes/test.md');
				service.onFileCreate(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(0);
			});

			it('should not queue when autoSync is disabled', () => {
				mockPlugin.settings.ragIndexing.autoSync = false;
				const file = createMockTFile('notes/test.md');
				service.onFileCreate(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(0);
			});

			it('should not queue when file should not be indexed', () => {
				(service as any).vaultAdapter.shouldIndex.mockReturnValue(false);
				const file = createMockTFile('.obsidian/config.json');
				service.onFileCreate(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(0);
			});
		});

		describe('onFileModify', () => {
			it('should queue modify change for indexable file', () => {
				const file = createMockTFile('notes/test.md');
				service.onFileModify(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(1);
				expect(getSyncQueue(service).pendingChanges.get('notes/test.md').type).toBe('modify');
			});

			it('should not queue when service is not ready', () => {
				(service as any).status = 'disabled';
				const file = createMockTFile('notes/test.md');
				service.onFileModify(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(0);
			});
		});

		describe('onFileDelete', () => {
			it('should queue delete change', () => {
				const file = createMockTFile('notes/test.md');
				service.onFileDelete(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(1);
				expect(getSyncQueue(service).pendingChanges.get('notes/test.md').type).toBe('delete');
			});

			it('should not queue when service is not ready', () => {
				(service as any).status = 'disabled';
				const file = createMockTFile('notes/test.md');
				service.onFileDelete(file);

				expect(getSyncQueue(service).pendingChanges.size).toBe(0);
			});
		});

		describe('onFileRename', () => {
			it('should queue delete for old path and create for new path', () => {
				const file = createMockTFile('notes/new-name.md');
				service.onFileRename(file, 'notes/old-name.md');

				expect(getSyncQueue(service).pendingChanges.size).toBe(2);
				expect(getSyncQueue(service).pendingChanges.get('notes/old-name.md').type).toBe('delete');
				expect(getSyncQueue(service).pendingChanges.get('notes/new-name.md').type).toBe('create');
			});

			it('should only queue delete if new file should not be indexed', () => {
				(service as any).vaultAdapter.shouldIndex.mockReturnValue(false);
				const file = createMockTFile('notes/new-name.txt');
				service.onFileRename(file, 'notes/old-name.md');

				expect(getSyncQueue(service).pendingChanges.size).toBe(1);
				expect(getSyncQueue(service).pendingChanges.get('notes/old-name.md').type).toBe('delete');
			});
		});
	});

	describe('getDetailedStatus', () => {
		it('should return comprehensive status info', () => {
			(service as any).status = 'idle';
			getRagCache(service).indexedCount = 10;
			getVaultScanner(service).failedFiles = [{ path: 'failed.md', error: 'Test error', timestamp: Date.now() }];
			getSyncQueue(service).pendingChanges = new Map([
				['pending.md', { type: 'create', path: 'pending.md', timestamp: Date.now() }],
			]);
			getRagCache(service).cache = {
				version: '1.0',
				storeName: 'test-store',
				lastSync: 1234567890,
				files: {
					'file1.md': { resourceName: 'res1', contentHash: 'hash1', lastIndexed: 1234567890 },
				},
			};

			const status = service.getDetailedStatus();

			expect(status.status).toBe('idle');
			expect(status.indexedCount).toBe(10);
			expect(status.failedCount).toBe(1);
			expect(status.pendingCount).toBe(1);
			expect(status.indexedFiles).toHaveLength(1);
			expect(status.failedFiles).toHaveLength(1);
		});
	});

	describe('getStatusInfo', () => {
		it('should return basic status info', () => {
			(service as any).status = 'idle';
			getRagCache(service).indexedCount = 5;
			mockPlugin.settings.ragIndexing.fileSearchStoreName = 'my-store';
			getRagCache(service).cache = { lastSync: 1234567890 };

			const info = service.getStatusInfo();

			expect(info.status).toBe('idle');
			expect(info.indexedCount).toBe(5);
			expect(info.storeName).toBe('my-store');
			expect(info.lastSync).toBe(1234567890);
		});

		it('should include progress when indexing', () => {
			(service as any).status = 'indexing';
			getVaultScanner(service).indexingProgress = { current: 5, total: 10 };

			const info = service.getStatusInfo();

			expect(info.progress).toEqual({ current: 5, total: 10 });
		});
	});

	describe('progress listeners', () => {
		it('should add and remove progress listeners', () => {
			const listener = vi.fn();

			service.addProgressListener(listener);
			expect((service as any).progressListeners.size).toBe(1);

			service.removeProgressListener(listener);
			expect((service as any).progressListeners.size).toBe(0);
		});

		it('should notify all progress listeners', () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			service.addProgressListener(listener1);
			service.addProgressListener(listener2);

			(service as any).notifyProgressListeners();

			expect(listener1).toHaveBeenCalled();
			expect(listener2).toHaveBeenCalled();
		});

		it('should handle listener errors gracefully', () => {
			const errorListener = vi.fn().mockImplementation(() => {
				throw new Error('Listener error');
			});
			const goodListener = vi.fn();

			service.addProgressListener(errorListener);
			service.addProgressListener(goodListener);

			// Should not throw
			expect(() => (service as any).notifyProgressListeners()).not.toThrow();
			expect(goodListener).toHaveBeenCalled();
		});
	});

	describe('cancelIndexing', () => {
		it('should set cancel flag when indexing', () => {
			(service as any).status = 'indexing';
			service.cancelIndexing();
			expect(getVaultScanner(service).cancelRequested).toBe(true);
		});

		it('should not set cancel flag when not indexing', () => {
			(service as any).status = 'idle';
			service.cancelIndexing();
			expect(getVaultScanner(service).cancelRequested).toBe(false);
		});
	});

	describe('isIndexing', () => {
		it('should return true when indexing', () => {
			(service as any).status = 'indexing';
			expect(service.isIndexing()).toBe(true);
		});

		it('should return false when not indexing', () => {
			(service as any).status = 'idle';
			expect(service.isIndexing()).toBe(false);
		});
	});

	describe('getStoreName', () => {
		it('should return store name from settings', () => {
			mockPlugin.settings.ragIndexing.fileSearchStoreName = 'my-custom-store';
			expect(service.getStoreName()).toBe('my-custom-store');
		});

		it('should return null when no store configured', () => {
			mockPlugin.settings.ragIndexing.fileSearchStoreName = null;
			expect(service.getStoreName()).toBeNull();
		});
	});

	describe('syncPendingChanges', () => {
		beforeEach(() => {
			(service as any).status = 'idle';
			getSyncQueue(service).isProcessing = false;
		});

		it('should return false when no pending changes', async () => {
			const result = await service.syncPendingChanges();
			expect(result).toBe(false);
		});

		it('should return false when already processing', async () => {
			getSyncQueue(service).isProcessing = true;
			getSyncQueue(service).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);

			const result = await service.syncPendingChanges();
			expect(result).toBe(false);
		});

		it('should return false when indexing', async () => {
			(service as any).status = 'indexing';
			getSyncQueue(service).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);

			const result = await service.syncPendingChanges();
			expect(result).toBe(false);
		});
	});

	describe('rate limit handling', () => {
		it('should detect rate limit errors', () => {
			const errors = [
				new Error('429 Too Many Requests'),
				new Error('RESOURCE_EXHAUSTED'),
				new Error('rate limit exceeded'),
				new Error('quota exceeded'),
				new Error('too many requests'),
			];

			for (const error of errors) {
				expect(getRateLimiter(service).isRateLimitError(error)).toBe(true);
			}
		});

		it('should not detect non-rate-limit errors', () => {
			const errors = [
				new Error('Network error'),
				new Error('Authentication failed'),
				new Error('File not found'),
				null,
				undefined,
			];

			for (const error of errors) {
				expect(getRateLimiter(service).isRateLimitError(error)).toBe(false);
			}
		});

		it('should return remaining seconds for rate limit', () => {
			getRateLimiter(service).rateLimitResumeTime = Date.now() + 30000;
			const remaining = service.getRateLimitRemainingSeconds();
			expect(remaining).toBeGreaterThanOrEqual(29);
			expect(remaining).toBeLessThanOrEqual(30);
		});

		it('should return 0 when no rate limit active', () => {
			getRateLimiter(service).rateLimitResumeTime = undefined;
			expect(service.getRateLimitRemainingSeconds()).toBe(0);
		});

		it('should set and clear rate limit timer during handleRateLimit', async () => {
			getRateLimiter(service).consecutiveRateLimits = 0;
			(service as any).status = 'idle';

			const handlePromise = getRateLimiter(service).handleRateLimit();

			// Verify timer is set during cooldown
			expect(getRateLimiter(service).rateLimitTimer).not.toBeUndefined();
			expect((service as any).status).toBe('rate_limited');

			// Advance through the base delay (30000ms)
			vi.advanceTimersByTime(35000);
			await handlePromise;

			// Verify timer is cleared after cooldown
			expect(getRateLimiter(service).rateLimitTimer).toBeUndefined();
		});
	});

	describe('cache management', () => {
		describe('loadCache', () => {
			it('should initialize empty cache when file does not exist', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

				await getRagCache(service).loadCache();

				expect(getRagCache(service).cache).toEqual({
					version: '1.0',
					storeName: '',
					lastSync: 0,
					files: {},
				});
			});

			it('should parse valid cache from file', async () => {
				const cacheData: RagIndexCache = {
					version: '1.0',
					storeName: 'test-store',
					lastSync: 1234567890,
					files: {
						'test.md': { resourceName: 'res1', contentHash: 'hash1', lastIndexed: 1234567890 },
					},
				};

				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
				mockPlugin.app.vault.read.mockResolvedValue(JSON.stringify(cacheData));

				await getRagCache(service).loadCache();

				expect(getRagCache(service).cache).toEqual(cacheData);
				expect(getRagCache(service).indexedCount).toBe(1);
			});

			it('should reset cache on version mismatch', async () => {
				const oldCache = {
					version: '0.9',
					storeName: 'old-store',
					lastSync: 1234567890,
					files: { 'old.md': {} },
				};

				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
				mockPlugin.app.vault.read.mockResolvedValue(JSON.stringify(oldCache));

				await getRagCache(service).loadCache();

				expect(getRagCache(service).cache.version).toBe('1.0');
				expect(getRagCache(service).cache.storeName).toBe('old-store');
				expect(getRagCache(service).cache.files).toEqual({});
			});

			it('should handle corrupt JSON gracefully', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
				mockPlugin.app.vault.read.mockResolvedValue('not valid json');

				await getRagCache(service).loadCache();

				expect(getRagCache(service).cache).toEqual({
					version: '1.0',
					storeName: '',
					lastSync: 0,
					files: {},
				});
			});
		});

		describe('saveCache', () => {
			beforeEach(() => {
				getRagCache(service).cache = {
					version: '1.0',
					storeName: 'test-store',
					lastSync: Date.now(),
					files: {},
				};
			});

			it('should not save when cache is null', async () => {
				getRagCache(service).cache = null;
				await getRagCache(service).saveCache();
				expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
				expect(mockPlugin.app.vault.create).not.toHaveBeenCalled();
			});

			it('should modify existing file', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));

				await getRagCache(service).saveCache();

				expect(mockPlugin.app.vault.modify).toHaveBeenCalled();
			});

			it('should create new file when it does not exist', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

				await getRagCache(service).saveCache();

				expect(mockPlugin.app.vault.create).toHaveBeenCalled();
			});

			it('should fallback to adapter.write on "File already exists" error', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
				mockPlugin.app.vault.create.mockRejectedValue(new Error('File already exists'));

				await getRagCache(service).saveCache();

				expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
			});

			it('should log error on save failure', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
				mockPlugin.app.vault.create.mockRejectedValue(new Error('Disk full'));

				await getRagCache(service).saveCache();

				expect(mockPlugin.logger.error).toHaveBeenCalled();
			});
		});
	});

	describe('concurrency guard (indexVault)', () => {
		it('should return existing promise if indexing is in progress', async () => {
			(service as any).status = 'idle';
			(service as any).ai = {};

			const existingPromise = Promise.resolve({ indexed: 5, skipped: 0, failed: 0, duration: 100 });
			getVaultScanner(service)._indexingPromise = existingPromise;

			const result = await service.indexVault();

			expect(result).toEqual({ indexed: 5, skipped: 0, failed: 0, duration: 100 });
		});

		it('should throw when service is not ready', async () => {
			(service as any).status = 'disabled';

			await expect(service.indexVault()).rejects.toThrow('RAG Indexing service is not ready');
		});

		it('should only call _doIndexVault once for concurrent indexVault calls', async () => {
			(service as any).status = 'idle';
			(service as any).ai = {};

			// Create a slow-resolving promise to simulate indexing in progress
			let resolveIndexing: (result: any) => void;
			const slowPromise = new Promise<any>((resolve) => {
				resolveIndexing = resolve;
			});

			// Mock _doIndexVault on the vault scanner to return our controlled promise
			const doIndexSpy = vi.spyOn(getVaultScanner(service) as any, '_doIndexVault').mockReturnValue(slowPromise);

			// Start two concurrent index operations
			const promise1 = service.indexVault();
			const promise2 = service.indexVault();

			// _doIndexVault should only be called once
			expect(doIndexSpy).toHaveBeenCalledTimes(1);

			// Resolve and verify both get the same result
			resolveIndexing!({ indexed: 10, skipped: 5, failed: 0, duration: 500 });

			const [result1, result2] = await Promise.all([promise1, promise2]);
			expect(result1).toEqual(result2);
			expect(result1).toEqual({ indexed: 10, skipped: 5, failed: 0, duration: 500 });
		});
	});

	describe('destroy', () => {
		it('should clear all state on destroy', async () => {
			getSyncQueue(service).debounceTimer = window.setTimeout(() => {}, 1000);
			getSyncQueue(service).pendingChanges = new Map([['test.md', {}]]);
			getRateLimiter(service).rateLimitTimer = window.setInterval(() => {}, 1000);
			(service as any).statusBar.statusBarItem = { remove: vi.fn() };
			(service as any).ai = {};
			getRagCache(service).cache = {};
			getVaultScanner(service).failedFiles = [{}];

			await service.destroy();

			expect(getSyncQueue(service).debounceTimer).toBeNull();
			expect(getSyncQueue(service).pendingChanges.size).toBe(0);
			expect((service as any).ai).toBeNull();
			expect(getRagCache(service).cache).toBeNull();
			expect(getVaultScanner(service).failedFiles).toEqual([]);
			expect((service as any).status).toBe('disabled');
		});
	});
});
