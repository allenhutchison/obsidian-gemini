// Mock obsidian module with TFile class defined inside
jest.mock('obsidian', () => {
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
		Notice: jest.fn(),
		setIcon: jest.fn(),
		setTooltip: jest.fn(),
	};
});

import { RagIndexingService, RagIndexCache } from '../../src/services/rag-indexing';
import { TFile } from 'obsidian';

// Mock GoogleGenAI
jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn().mockImplementation(() => ({
		fileSearchStores: {
			get: jest.fn().mockResolvedValue({ name: 'test-store' }),
			create: jest.fn().mockResolvedValue({ name: 'new-store' }),
			delete: jest.fn().mockResolvedValue(undefined),
		},
	})),
}));

// Mock FileUploader
jest.mock('@allenhutchison/gemini-utils', () => ({
	FileUploader: jest.fn().mockImplementation(() => ({
		uploadWithAdapter: jest.fn().mockResolvedValue(undefined),
		uploadContent: jest.fn().mockResolvedValue(undefined),
	})),
}));

// Mock ObsidianVaultAdapter
jest.mock('../../src/services/obsidian-file-adapter', () => ({
	ObsidianVaultAdapter: jest.fn().mockImplementation(() => ({
		shouldIndex: jest.fn().mockReturnValue(true),
		listFiles: jest.fn().mockResolvedValue([]),
		readFileForUpload: jest.fn().mockResolvedValue({ content: 'test', hash: 'abc123' }),
		computeHash: jest.fn().mockResolvedValue('hash123'),
	})),
}));

// Create mock TFile - use the mocked TFile class so instanceof checks work
function createMockTFile(path: string): TFile {
	return new (TFile as any)(path) as TFile;
}

// Create mock plugin
function createMockPlugin(overrides: Partial<any> = {}) {
	const mockVault = {
		getAbstractFileByPath: jest.fn().mockReturnValue(null),
		read: jest.fn().mockResolvedValue('{}'),
		modify: jest.fn().mockResolvedValue(undefined),
		create: jest.fn().mockResolvedValue(undefined),
		delete: jest.fn().mockResolvedValue(undefined),
		getMarkdownFiles: jest.fn().mockReturnValue([]),
		getFiles: jest.fn().mockReturnValue([]),
		getName: jest.fn().mockReturnValue('test-vault'),
		adapter: {
			write: jest.fn().mockResolvedValue(undefined),
			exists: jest.fn().mockResolvedValue(false),
		},
	};

	return {
		app: {
			vault: mockVault,
			metadataCache: {
				getFileCache: jest.fn().mockReturnValue(null),
			},
		},
		settings: {
			apiKey: 'test-api-key',
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
			log: jest.fn(),
			debug: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		},
		saveData: jest.fn().mockResolvedValue(undefined),
		addStatusBarItem: jest.fn().mockReturnValue({
			addClass: jest.fn(),
			createSpan: jest.fn().mockReturnValue({
				setText: jest.fn(),
			}),
			addEventListener: jest.fn(),
			remove: jest.fn(),
			style: {},
			querySelector: jest.fn().mockReturnValue(null),
			removeClass: jest.fn(),
		}),
		...overrides,
	} as any;
}

describe('RagIndexingService', () => {
	let service: RagIndexingService;
	let mockPlugin: ReturnType<typeof createMockPlugin>;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();
		mockPlugin = createMockPlugin();
		service = new RagIndexingService(mockPlugin);
	});

	afterEach(() => {
		jest.useRealTimers();
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
			(service as any).debounceTimer = setTimeout(() => {}, 1000);
			service.pause();
			expect((service as any).debounceTimer).toBeNull();
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
			(service as any).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);
			const flushSpy = jest.spyOn(service as any, 'flushPendingChanges').mockResolvedValue(undefined);

			service.resume();

			expect(flushSpy).toHaveBeenCalled();
		});
	});

	describe('getPendingCount', () => {
		it('should return 0 when no pending changes', () => {
			expect(service.getPendingCount()).toBe(0);
		});

		it('should return count of pending changes', () => {
			(service as any).pendingChanges = new Map([
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
				shouldIndex: jest.fn().mockReturnValue(true),
			};
			mockPlugin.settings.ragIndexing.autoSync = true;
		});

		it('should queue a single change', () => {
			(service as any).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect((service as any).pendingChanges.size).toBe(1);
			expect((service as any).pendingChanges.get('test.md').type).toBe('create');
		});

		it('should collapse create + delete to no-op', () => {
			(service as any).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});
			(service as any).queueChange({
				type: 'delete',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect((service as any).pendingChanges.size).toBe(0);
		});

		it('should collapse create + modify to create', () => {
			(service as any).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});
			(service as any).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect((service as any).pendingChanges.size).toBe(1);
			expect((service as any).pendingChanges.get('test.md').type).toBe('create');
		});

		it('should use latest change for modify + delete', () => {
			(service as any).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: Date.now(),
			});
			(service as any).queueChange({
				type: 'delete',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect((service as any).pendingChanges.size).toBe(1);
			expect((service as any).pendingChanges.get('test.md').type).toBe('delete');
		});

		it('should use latest change for modify + modify', () => {
			const timestamp1 = Date.now();
			const timestamp2 = timestamp1 + 1000;

			(service as any).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: timestamp1,
			});
			(service as any).queueChange({
				type: 'modify',
				path: 'test.md',
				timestamp: timestamp2,
			});

			expect((service as any).pendingChanges.size).toBe(1);
			expect((service as any).pendingChanges.get('test.md').timestamp).toBe(timestamp2);
		});

		it('should not start debounce timer when paused', () => {
			(service as any).status = 'paused';
			(service as any).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect((service as any).debounceTimer).toBeNull();
			expect((service as any).pendingChanges.size).toBe(1);
		});

		it('should start debounce timer when not paused', () => {
			(service as any).queueChange({
				type: 'create',
				path: 'test.md',
				timestamp: Date.now(),
			});

			expect((service as any).debounceTimer).not.toBeNull();
		});
	});

	describe('file event handlers', () => {
		beforeEach(() => {
			// Setup service to be ready
			(service as any).status = 'idle';
			(service as any).ai = {};
			(service as any).vaultAdapter = {
				shouldIndex: jest.fn().mockReturnValue(true),
			};
			mockPlugin.settings.ragIndexing.autoSync = true;
		});

		describe('onFileCreate', () => {
			it('should queue create change for indexable file', () => {
				const file = createMockTFile('notes/test.md');
				service.onFileCreate(file);

				expect((service as any).pendingChanges.size).toBe(1);
				expect((service as any).pendingChanges.get('notes/test.md').type).toBe('create');
			});

			it('should not queue when service is not ready', () => {
				(service as any).status = 'disabled';
				const file = createMockTFile('notes/test.md');
				service.onFileCreate(file);

				expect((service as any).pendingChanges.size).toBe(0);
			});

			it('should not queue when autoSync is disabled', () => {
				mockPlugin.settings.ragIndexing.autoSync = false;
				const file = createMockTFile('notes/test.md');
				service.onFileCreate(file);

				expect((service as any).pendingChanges.size).toBe(0);
			});

			it('should not queue when file should not be indexed', () => {
				(service as any).vaultAdapter.shouldIndex.mockReturnValue(false);
				const file = createMockTFile('.obsidian/config.json');
				service.onFileCreate(file);

				expect((service as any).pendingChanges.size).toBe(0);
			});
		});

		describe('onFileModify', () => {
			it('should queue modify change for indexable file', () => {
				const file = createMockTFile('notes/test.md');
				service.onFileModify(file);

				expect((service as any).pendingChanges.size).toBe(1);
				expect((service as any).pendingChanges.get('notes/test.md').type).toBe('modify');
			});

			it('should not queue when service is not ready', () => {
				(service as any).status = 'disabled';
				const file = createMockTFile('notes/test.md');
				service.onFileModify(file);

				expect((service as any).pendingChanges.size).toBe(0);
			});
		});

		describe('onFileDelete', () => {
			it('should queue delete change', () => {
				const file = createMockTFile('notes/test.md');
				service.onFileDelete(file);

				expect((service as any).pendingChanges.size).toBe(1);
				expect((service as any).pendingChanges.get('notes/test.md').type).toBe('delete');
			});

			it('should not queue when service is not ready', () => {
				(service as any).status = 'disabled';
				const file = createMockTFile('notes/test.md');
				service.onFileDelete(file);

				expect((service as any).pendingChanges.size).toBe(0);
			});
		});

		describe('onFileRename', () => {
			it('should queue delete for old path and create for new path', () => {
				const file = createMockTFile('notes/new-name.md');
				service.onFileRename(file, 'notes/old-name.md');

				expect((service as any).pendingChanges.size).toBe(2);
				expect((service as any).pendingChanges.get('notes/old-name.md').type).toBe('delete');
				expect((service as any).pendingChanges.get('notes/new-name.md').type).toBe('create');
			});

			it('should only queue delete if new file should not be indexed', () => {
				(service as any).vaultAdapter.shouldIndex.mockReturnValue(false);
				const file = createMockTFile('notes/new-name.txt');
				service.onFileRename(file, 'notes/old-name.md');

				expect((service as any).pendingChanges.size).toBe(1);
				expect((service as any).pendingChanges.get('notes/old-name.md').type).toBe('delete');
			});
		});
	});

	describe('getDetailedStatus', () => {
		it('should return comprehensive status info', () => {
			(service as any).status = 'idle';
			(service as any).indexedCount = 10;
			(service as any).failedFiles = [
				{ path: 'failed.md', error: 'Test error', timestamp: Date.now() },
			];
			(service as any).pendingChanges = new Map([
				['pending.md', { type: 'create', path: 'pending.md', timestamp: Date.now() }],
			]);
			(service as any).cache = {
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
			(service as any).indexedCount = 5;
			mockPlugin.settings.ragIndexing.fileSearchStoreName = 'my-store';
			(service as any).cache = { lastSync: 1234567890 };

			const info = service.getStatusInfo();

			expect(info.status).toBe('idle');
			expect(info.indexedCount).toBe(5);
			expect(info.storeName).toBe('my-store');
			expect(info.lastSync).toBe(1234567890);
		});

		it('should include progress when indexing', () => {
			(service as any).status = 'indexing';
			(service as any).indexingProgress = { current: 5, total: 10 };

			const info = service.getStatusInfo();

			expect(info.progress).toEqual({ current: 5, total: 10 });
		});
	});

	describe('progress listeners', () => {
		it('should add and remove progress listeners', () => {
			const listener = jest.fn();

			service.addProgressListener(listener);
			expect((service as any).progressListeners.size).toBe(1);

			service.removeProgressListener(listener);
			expect((service as any).progressListeners.size).toBe(0);
		});

		it('should notify all progress listeners', () => {
			const listener1 = jest.fn();
			const listener2 = jest.fn();

			service.addProgressListener(listener1);
			service.addProgressListener(listener2);

			(service as any).notifyProgressListeners();

			expect(listener1).toHaveBeenCalled();
			expect(listener2).toHaveBeenCalled();
		});

		it('should handle listener errors gracefully', () => {
			const errorListener = jest.fn().mockImplementation(() => {
				throw new Error('Listener error');
			});
			const goodListener = jest.fn();

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
			expect((service as any).cancelRequested).toBe(true);
		});

		it('should not set cancel flag when not indexing', () => {
			(service as any).status = 'idle';
			service.cancelIndexing();
			expect((service as any).cancelRequested).toBe(false);
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
			(service as any).isProcessing = false;
		});

		it('should return false when no pending changes', async () => {
			const result = await service.syncPendingChanges();
			expect(result).toBe(false);
		});

		it('should return false when already processing', async () => {
			(service as any).isProcessing = true;
			(service as any).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);

			const result = await service.syncPendingChanges();
			expect(result).toBe(false);
		});

		it('should return false when indexing', async () => {
			(service as any).status = 'indexing';
			(service as any).pendingChanges = new Map([
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
				expect((service as any).isRateLimitError(error)).toBe(true);
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
				expect((service as any).isRateLimitError(error)).toBe(false);
			}
		});

		it('should return remaining seconds for rate limit', () => {
			(service as any).rateLimitResumeTime = Date.now() + 30000;
			const remaining = service.getRateLimitRemainingSeconds();
			expect(remaining).toBeGreaterThanOrEqual(29);
			expect(remaining).toBeLessThanOrEqual(30);
		});

		it('should return 0 when no rate limit active', () => {
			(service as any).rateLimitResumeTime = undefined;
			expect(service.getRateLimitRemainingSeconds()).toBe(0);
		});
	});

	describe('cache management', () => {
		describe('loadCache', () => {
			it('should initialize empty cache when file does not exist', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

				await (service as any).loadCache();

				expect((service as any).cache).toEqual({
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

				await (service as any).loadCache();

				expect((service as any).cache).toEqual(cacheData);
				expect((service as any).indexedCount).toBe(1);
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

				await (service as any).loadCache();

				expect((service as any).cache.version).toBe('1.0');
				expect((service as any).cache.storeName).toBe('old-store');
				expect((service as any).cache.files).toEqual({});
			});

			it('should handle corrupt JSON gracefully', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));
				mockPlugin.app.vault.read.mockResolvedValue('not valid json');

				await (service as any).loadCache();

				expect((service as any).cache).toEqual({
					version: '1.0',
					storeName: '',
					lastSync: 0,
					files: {},
				});
			});
		});

		describe('saveCache', () => {
			beforeEach(() => {
				(service as any).cache = {
					version: '1.0',
					storeName: 'test-store',
					lastSync: Date.now(),
					files: {},
				};
			});

			it('should not save when cache is null', async () => {
				(service as any).cache = null;
				await (service as any).saveCache();
				expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
				expect(mockPlugin.app.vault.create).not.toHaveBeenCalled();
			});

			it('should modify existing file', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(createMockTFile('cache.json'));

				await (service as any).saveCache();

				expect(mockPlugin.app.vault.modify).toHaveBeenCalled();
			});

			it('should create new file when it does not exist', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

				await (service as any).saveCache();

				expect(mockPlugin.app.vault.create).toHaveBeenCalled();
			});

			it('should fallback to adapter.write on "File already exists" error', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
				mockPlugin.app.vault.create.mockRejectedValue(new Error('File already exists'));

				await (service as any).saveCache();

				expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
			});

			it('should log error on save failure', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
				mockPlugin.app.vault.create.mockRejectedValue(new Error('Disk full'));

				await (service as any).saveCache();

				expect(mockPlugin.logger.error).toHaveBeenCalled();
			});
		});
	});

	describe('concurrency guard (indexVault)', () => {
		it('should return existing promise if indexing is in progress', async () => {
			(service as any).status = 'idle';
			(service as any).ai = {};

			const existingPromise = Promise.resolve({ indexed: 5, skipped: 0, failed: 0, duration: 100 });
			(service as any)._indexingPromise = existingPromise;

			const result = await service.indexVault();

			expect(result).toEqual({ indexed: 5, skipped: 0, failed: 0, duration: 100 });
		});

		it('should throw when service is not ready', async () => {
			(service as any).status = 'disabled';

			await expect(service.indexVault()).rejects.toThrow('RAG Indexing service is not ready');
		});
	});

	describe('destroy', () => {
		it('should clear all state on destroy', async () => {
			(service as any).debounceTimer = setTimeout(() => {}, 1000);
			(service as any).pendingChanges = new Map([['test.md', {}]]);
			(service as any).rateLimitTimer = setInterval(() => {}, 1000);
			(service as any).statusBarItem = { remove: jest.fn() };
			(service as any).ai = {};
			(service as any).cache = {};
			(service as any).failedFiles = [{}];

			await service.destroy();

			expect((service as any).debounceTimer).toBeNull();
			expect((service as any).pendingChanges.size).toBe(0);
			expect((service as any).ai).toBeNull();
			expect((service as any).cache).toBeNull();
			expect((service as any).failedFiles).toEqual([]);
			expect((service as any).status).toBe('disabled');
		});
	});
});
