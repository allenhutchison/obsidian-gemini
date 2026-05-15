// Mock obsidian module
vi.mock('obsidian', () => {
	const MockTFile = class {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	};
	return {
		TFile: MockTFile,
		Notice: vi.fn(),
		normalizePath: (path: string) => path,
	};
});

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
		};
	}),
}));

// Mock error-utils
vi.mock('../../src/utils/error-utils', () => ({
	getErrorMessage: vi.fn((err: any) => (err instanceof Error ? err.message : String(err))),
	isQuotaExhausted: vi.fn().mockReturnValue(false),
}));

// Mock rag-resume-modal (dynamic import in handleInterruptedIndexing)
vi.mock('../../src/ui/rag-resume-modal', () => ({
	RagResumeModal: vi.fn(),
}));

// Mock rag-progress-modal (dynamic import in startResumeIndexing)
vi.mock('../../src/ui/rag-progress-modal', () => ({
	RagProgressModal: vi.fn(),
}));

import { TFile } from 'obsidian';
import { RagVaultScanner, VaultScannerCallbacks } from '../../src/services/rag-vault-scanner';
import { CACHE_VERSION } from '../../src/services/rag-types';
import { isQuotaExhausted } from '../../src/utils/error-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockLogger(): any {
	return {
		log: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function createMockRagCache(overrides: Record<string, any> = {}): any {
	return {
		cache: {
			version: CACHE_VERSION,
			storeName: 'test-store',
			lastSync: 0,
			files: {},
			...overrides.cacheData,
		},
		cachePath: 'gemini-scribe/.rag-cache.json',
		indexedCount: 0,
		saveCache: vi.fn().mockResolvedValue(undefined),
		refreshIndexedCount: vi.fn(),
		incrementAndMaybeSaveCache: vi.fn().mockResolvedValue(0),
		...overrides,
	};
}

function createMockRateLimiter(): any {
	return {
		isRateLimitError: vi.fn().mockReturnValue(false),
		handleRateLimit: vi.fn().mockResolvedValue(undefined),
		resetTracking: vi.fn(),
		consecutiveCount: 0,
		maxRetries: 5,
	};
}

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				delete: vi.fn().mockResolvedValue(undefined),
				getName: vi.fn().mockReturnValue('test-vault'),
			},
		},
		settings: {
			historyFolder: 'gemini-scribe',
			ragIndexing: {
				enabled: true,
				fileSearchStoreName: 'test-store',
				excludeFolders: [],
				autoSync: true,
			},
			...overrides.settings,
		},
		logger: createMockLogger(),
		saveData: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createMockCallbacks(overrides: Partial<VaultScannerCallbacks> = {}): VaultScannerCallbacks {
	let status: string = 'idle';
	return {
		getStatus: vi.fn(() => status) as any,
		setStatus: vi.fn((s: string) => {
			status = s;
		}) as any,
		isReady: vi.fn().mockReturnValue(true),
		getAi: vi.fn().mockReturnValue({
			fileSearchStores: {
				get: vi.fn().mockResolvedValue({ name: 'test-store' }),
				create: vi.fn().mockResolvedValue({ name: 'new-store' }),
				delete: vi.fn().mockResolvedValue(undefined),
			},
		}),
		getVaultAdapter: vi.fn().mockReturnValue({
			computeHash: vi.fn().mockResolvedValue('hash123'),
		}),
		getFileUploader: vi.fn().mockReturnValue({
			uploadWithAdapter: vi.fn().mockResolvedValue(undefined),
		}),
		getStoreName: vi.fn().mockReturnValue('test-store'),
		onUpdateStatusBar: vi.fn(),
		onNotifyListeners: vi.fn(),
		...overrides,
	};
}

function createScanner(
	overrides: {
		plugin?: any;
		ragCache?: any;
		rateLimiter?: any;
		callbacks?: VaultScannerCallbacks;
	} = {}
) {
	const plugin = overrides.plugin ?? createMockPlugin();
	const ragCache = overrides.ragCache ?? createMockRagCache();
	const rateLimiter = overrides.rateLimiter ?? createMockRateLimiter();
	const callbacks = overrides.callbacks ?? createMockCallbacks();
	const scanner = new RagVaultScanner(plugin, ragCache, rateLimiter, callbacks);
	return { scanner, plugin, ragCache, rateLimiter, callbacks };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RagVaultScanner', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	// ── Progress Getters ─────────────────────────────────────────────────

	describe('progress getters (idle state)', () => {
		it('should return zero progress when idle', () => {
			const { scanner } = createScanner();
			expect(scanner.getIndexingProgress()).toEqual({ current: 0, total: 0 });
		});

		it('should return undefined for currentFile when idle', () => {
			const { scanner } = createScanner();
			expect(scanner.getCurrentFile()).toBeUndefined();
		});

		it('should return undefined for indexingStartTime when idle', () => {
			const { scanner } = createScanner();
			expect(scanner.getIndexingStartTime()).toBeUndefined();
		});

		it('should return zero for running counters when idle', () => {
			const { scanner } = createScanner();
			expect(scanner.getRunningIndexed()).toBe(0);
			expect(scanner.getRunningSkipped()).toBe(0);
			expect(scanner.getRunningFailed()).toBe(0);
		});

		it('should return empty array for failedFiles when idle', () => {
			const { scanner } = createScanner();
			expect(scanner.getFailedFiles()).toEqual([]);
		});
	});

	// ── isIndexing / hasActivePromise ─────────────────────────────────────

	describe('isIndexing', () => {
		it('should return true when status is indexing', () => {
			const callbacks = createMockCallbacks({ getStatus: vi.fn().mockReturnValue('indexing') as any });
			const { scanner } = createScanner({ callbacks });
			expect(scanner.isIndexing()).toBe(true);
		});

		it('should return false when status is idle', () => {
			const callbacks = createMockCallbacks({ getStatus: vi.fn().mockReturnValue('idle') as any });
			const { scanner } = createScanner({ callbacks });
			expect(scanner.isIndexing()).toBe(false);
		});
	});

	describe('hasActivePromise', () => {
		it('should return false when no indexing is in progress', () => {
			const { scanner } = createScanner();
			expect(scanner.hasActivePromise()).toBe(false);
		});
	});

	// ── cancelIndexing ───────────────────────────────────────────────────

	describe('cancelIndexing', () => {
		it('should set cancelRequested when status is indexing', () => {
			const callbacks = createMockCallbacks({ getStatus: vi.fn().mockReturnValue('indexing') as any });
			const { scanner } = createScanner({ callbacks });
			scanner.cancelIndexing();
			// Access private field via cast to validate
			expect((scanner as any).cancelRequested).toBe(true);
		});

		it('should not set cancelRequested when status is idle', () => {
			const callbacks = createMockCallbacks({ getStatus: vi.fn().mockReturnValue('idle') as any });
			const { scanner } = createScanner({ callbacks });
			scanner.cancelIndexing();
			expect((scanner as any).cancelRequested).toBe(false);
		});
	});

	// ── indexVault promise deduplication ──────────────────────────────────

	describe('indexVault promise deduplication', () => {
		it('should return the same promise when called concurrently', async () => {
			const { scanner, callbacks } = createScanner();
			// Make uploadWithAdapter resolve immediately
			const fileUploader = (callbacks.getFileUploader as any)();
			fileUploader.uploadWithAdapter.mockResolvedValue(undefined);

			const promise1 = scanner.indexVault();
			const promise2 = scanner.indexVault();

			// Both should be the exact same promise reference
			expect(scanner.hasActivePromise()).toBe(true);

			const [result1, result2] = await Promise.all([promise1, promise2]);
			expect(result1).toEqual(result2);
		});

		it('should clear indexing promise after completion', async () => {
			const { scanner, callbacks } = createScanner();
			const fileUploader = (callbacks.getFileUploader as any)();
			fileUploader.uploadWithAdapter.mockResolvedValue(undefined);

			await scanner.indexVault();

			expect(scanner.hasActivePromise()).toBe(false);
		});

		it('should throw when not ready', async () => {
			const callbacks = createMockCallbacks({ isReady: vi.fn().mockReturnValue(false) });
			const { scanner } = createScanner({ callbacks });

			await expect(scanner.indexVault()).rejects.toThrow('not ready');
		});

		it('should throw when fileUploader is null', async () => {
			const callbacks = createMockCallbacks({ getFileUploader: vi.fn().mockReturnValue(null) });
			const { scanner } = createScanner({ callbacks });

			await expect(scanner.indexVault()).rejects.toThrow('not properly initialized');
		});

		it('should throw when storeName is null', async () => {
			const callbacks = createMockCallbacks({ getStoreName: vi.fn().mockReturnValue(null) });
			const { scanner } = createScanner({ callbacks });

			await expect(scanner.indexVault()).rejects.toThrow('No File Search Store');
		});
	});

	// ── ensureFileSearchStore ─────────────────────────────────────────────

	describe('ensureFileSearchStore', () => {
		it('should return early when ai is null', async () => {
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(null) });
			const { scanner, plugin } = createScanner({ callbacks });

			await scanner.ensureFileSearchStore();

			expect(plugin.saveData).not.toHaveBeenCalled();
		});

		it('should verify existing store and return if found', async () => {
			const mockAi = {
				fileSearchStores: {
					get: vi.fn().mockResolvedValue({ name: 'existing-store' }),
					create: vi.fn(),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = 'existing-store';
			const { scanner } = createScanner({ plugin, callbacks });

			await scanner.ensureFileSearchStore();

			expect(mockAi.fileSearchStores.get).toHaveBeenCalledWith({ name: 'existing-store' });
			expect(mockAi.fileSearchStores.create).not.toHaveBeenCalled();
		});

		it('should create new store when existing store returns 404', async () => {
			const mockAi = {
				fileSearchStores: {
					get: vi.fn().mockRejectedValue(new Error('404 not found')),
					create: vi.fn().mockResolvedValue({ name: 'new-store-name' }),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = 'old-store';
			const { scanner } = createScanner({ plugin, callbacks });

			await scanner.ensureFileSearchStore();

			expect(mockAi.fileSearchStores.create).toHaveBeenCalled();
			expect(plugin.settings.ragIndexing.fileSearchStoreName).toBe('new-store-name');
			expect(plugin.saveData).toHaveBeenCalled();
		});

		it('should rethrow non-404 errors when verifying existing store', async () => {
			const mockAi = {
				fileSearchStores: {
					get: vi.fn().mockRejectedValue(new Error('Internal server error')),
					create: vi.fn(),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = 'some-store';
			const { scanner } = createScanner({ plugin, callbacks });

			await expect(scanner.ensureFileSearchStore()).rejects.toThrow('Internal server error');
			expect(mockAi.fileSearchStores.create).not.toHaveBeenCalled();
		});

		it('should create store when no existing store name in settings', async () => {
			const mockAi = {
				fileSearchStores: {
					get: vi.fn(),
					create: vi.fn().mockResolvedValue({ name: 'brand-new-store' }),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = null;
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ plugin, callbacks, ragCache });

			await scanner.ensureFileSearchStore();

			expect(mockAi.fileSearchStores.get).not.toHaveBeenCalled();
			expect(mockAi.fileSearchStores.create).toHaveBeenCalledWith({
				config: { displayName: expect.stringContaining('obsidian-') },
			});
			expect(plugin.settings.ragIndexing.fileSearchStoreName).toBe('brand-new-store');
			expect(ragCache.cache.storeName).toBe('brand-new-store');
		});
	});

	// ── deleteFileSearchStore ─────────────────────────────────────────────

	describe('deleteFileSearchStore', () => {
		it('should return early when ai is null', async () => {
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(null) });
			const { scanner, plugin } = createScanner({ callbacks });

			await scanner.deleteFileSearchStore();

			expect(plugin.saveData).not.toHaveBeenCalled();
		});

		it('should return early when no store name in settings', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = null;
			const { scanner } = createScanner({ plugin });

			await scanner.deleteFileSearchStore();

			expect(plugin.saveData).not.toHaveBeenCalled();
		});

		it('should delete store, clear settings and cache', async () => {
			const mockAi = {
				fileSearchStores: {
					delete: vi.fn().mockResolvedValue(undefined),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = 'doomed-store';
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ plugin, callbacks, ragCache });

			await scanner.deleteFileSearchStore();

			expect(mockAi.fileSearchStores.delete).toHaveBeenCalledWith({
				name: 'doomed-store',
				config: { force: true },
			});
			expect(plugin.settings.ragIndexing.fileSearchStoreName).toBeNull();
			expect(plugin.saveData).toHaveBeenCalled();
			expect(ragCache.cache).toBeNull();
			expect(ragCache.indexedCount).toBe(0);
		});

		it('should delete cache file if it exists as TFile', async () => {
			const mockCacheFile = new (TFile as any)('gemini-scribe/.rag-cache.json');
			const mockAi = {
				fileSearchStores: {
					delete: vi.fn().mockResolvedValue(undefined),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = 'store-to-delete';
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(mockCacheFile);
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ plugin, callbacks, ragCache });

			await scanner.deleteFileSearchStore();

			expect(plugin.app.vault.delete).toHaveBeenCalledWith(mockCacheFile);
		});
	});

	// ── Quota exhaustion detection ────────────────────────────────────────

	describe('quota exhaustion detection', () => {
		it('should stop indexing immediately on permanent quota exhaustion', async () => {
			const rateLimiter = createMockRateLimiter();
			rateLimiter.isRateLimitError.mockReturnValue(true);
			(isQuotaExhausted as any).mockReturnValue(true);

			const callbacks = createMockCallbacks();
			// Make uploadWithAdapter throw a quota error
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					// Simulate a start event then a file_error with quota exhaustion
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					const error = new Error('RESOURCE_EXHAUSTED: FreeTier limit: 0');
					await opts.onProgress({ type: 'file_error', currentFile: 'test.md', error });
					// This should cause the rate limiter check to trigger
					throw error;
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ callbacks, rateLimiter, ragCache });

			const result = await scanner.indexVault();

			expect(rateLimiter.resetTracking).toHaveBeenCalled();
			expect(callbacks.setStatus).toHaveBeenCalledWith('error');
			expect(result).toBeDefined();
		});
	});

	// ── Progress tracking callbacks ──────────────────────────────────────

	describe('progress tracking callbacks', () => {
		it('should call progressCallback with scanning phase on start event', async () => {
			const progressCallback = vi.fn();
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 10 });
					await opts.onProgress({ type: 'complete', totalFiles: 10 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			await scanner.indexVault(progressCallback);

			expect(progressCallback).toHaveBeenCalledWith(
				expect.objectContaining({
					current: 0,
					total: 10,
					phase: 'scanning',
				})
			);
		});

		it('should call progressCallback with complete phase on complete event', async () => {
			const progressCallback = vi.fn();
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 5 });
					await opts.onProgress({ type: 'complete', totalFiles: 5 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			await scanner.indexVault(progressCallback);

			expect(progressCallback).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'complete',
				})
			);
		});
	});

	// ── destroy cleanup ──────────────────────────────────────────────────

	describe('destroy', () => {
		it('should reset all state to defaults', () => {
			const { scanner } = createScanner();

			// Manually dirty some state via cast
			(scanner as any).cancelRequested = true;
			(scanner as any).failedFiles = [{ path: 'fail.md', error: 'err', timestamp: 1 }];
			(scanner as any).currentFile = 'test.md';
			(scanner as any).indexingStartTime = 12345;
			(scanner as any).runningIndexed = 5;
			(scanner as any).runningSkipped = 3;
			(scanner as any).runningFailed = 1;
			(scanner as any).indexingProgress = { current: 5, total: 10 };

			scanner.destroy();

			expect((scanner as any).cancelRequested).toBe(false);
			expect(scanner.getFailedFiles()).toEqual([]);
			expect(scanner.getCurrentFile()).toBeUndefined();
			expect(scanner.getIndexingStartTime()).toBeUndefined();
			expect(scanner.getRunningIndexed()).toBe(0);
			expect(scanner.getRunningSkipped()).toBe(0);
			expect(scanner.getRunningFailed()).toBe(0);
			expect(scanner.getIndexingProgress()).toEqual({ current: 0, total: 0 });
		});
	});

	// ── file_start event ─────────────────────────────────────────────────

	describe('file_start event', () => {
		it('should set currentFile and notify listeners', async () => {
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({ type: 'file_start', currentFile: 'notes/hello.md' });
					// Verify mid-stream state
					expect(scanner.getCurrentFile()).toBe('notes/hello.md');
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			await scanner.indexVault();

			// onNotifyListeners called for: start + file_start + complete + success cleanup
			expect(callbacks.onNotifyListeners).toHaveBeenCalled();
		});
	});

	// ── file_complete event ──────────────────────────────────────────────

	describe('file_complete event', () => {
		it('should increment indexed count, update cache with hash, update progress, and call progressCallback', async () => {
			const progressCallback = vi.fn();
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache();
			const vaultAdapter = { computeHash: vi.fn().mockResolvedValue('abc123') };
			(callbacks.getVaultAdapter as any).mockReturnValue(vaultAdapter);

			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 2 });
					await opts.onProgress({
						type: 'file_complete',
						currentFile: 'note.md',
						completedFiles: 1,
						skippedFiles: 0,
						totalFiles: 2,
					});
					// Capture lastIndexedFile mid-stream (success path clears it)
					capturedLastIndexedFile = ragCache.cache.lastIndexedFile;
					await opts.onProgress({ type: 'complete', totalFiles: 2 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache });
			let capturedLastIndexedFile: string | undefined;

			const result = await scanner.indexVault(progressCallback);

			expect(result.indexed).toBe(1);
			expect(scanner.getRunningIndexed()).toBe(1);
			// Cache should contain the file entry with computed hash
			expect(ragCache.cache.files['note.md']).toEqual(
				expect.objectContaining({
					resourceName: 'test-store',
					contentHash: 'abc123',
				})
			);
			expect(capturedLastIndexedFile).toBe('note.md');
			expect(ragCache.incrementAndMaybeSaveCache).toHaveBeenCalled();
			// Progress callback called with indexing phase
			expect(progressCallback).toHaveBeenCalledWith(
				expect.objectContaining({
					current: 1,
					total: 2,
					currentFile: 'note.md',
					phase: 'indexing',
				})
			);
			expect(callbacks.onUpdateStatusBar).toHaveBeenCalled();
		});
	});

	// ── file_skipped event ───────────────────────────────────────────────

	describe('file_skipped event', () => {
		it('should increment skipped count and add to cache if not already present', async () => {
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache();
			const vaultAdapter = { computeHash: vi.fn().mockResolvedValue('skip-hash') };
			(callbacks.getVaultAdapter as any).mockReturnValue(vaultAdapter);

			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_skipped',
						currentFile: 'cached.md',
						completedFiles: 0,
						skippedFiles: 1,
						totalFiles: 1,
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache });

			const result = await scanner.indexVault();

			expect(result.skipped).toBe(1);
			expect(scanner.getRunningSkipped()).toBe(1);
			expect(ragCache.cache.files['cached.md']).toEqual(
				expect.objectContaining({
					resourceName: 'test-store',
					contentHash: 'skip-hash',
				})
			);
			expect(ragCache.incrementAndMaybeSaveCache).toHaveBeenCalled();
			expect(callbacks.onNotifyListeners).toHaveBeenCalled();
			expect(callbacks.onUpdateStatusBar).toHaveBeenCalled();
		});

		it('should not overwrite existing cache entry for skipped file', async () => {
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache({
				cacheData: {
					files: {
						'already-cached.md': {
							resourceName: 'test-store',
							contentHash: 'original-hash',
							lastIndexed: 1000,
						},
					},
				},
			});
			const vaultAdapter = { computeHash: vi.fn().mockResolvedValue('new-hash') };
			(callbacks.getVaultAdapter as any).mockReturnValue(vaultAdapter);

			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_skipped',
						currentFile: 'already-cached.md',
						completedFiles: 0,
						skippedFiles: 1,
						totalFiles: 1,
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache });

			await scanner.indexVault();

			// Original entry should be preserved
			expect(ragCache.cache.files['already-cached.md'].contentHash).toBe('original-hash');
			expect(vaultAdapter.computeHash).not.toHaveBeenCalled();
		});
	});

	// ── file_error event ─────────────────────────────────────────────────

	describe('file_error event', () => {
		it('should increment failed count and track error details', async () => {
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_error',
						currentFile: 'broken.md',
						error: new Error('File read failed'),
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			const result = await scanner.indexVault();

			expect(result.failed).toBe(1);
			expect(scanner.getRunningFailed()).toBe(1);
			expect(scanner.getFailedFiles()).toEqual([
				expect.objectContaining({
					path: 'broken.md',
					error: 'File read failed',
				}),
			]);
			expect(callbacks.onNotifyListeners).toHaveBeenCalled();
		});

		it('should handle string error in file_error event', async () => {
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_error',
						currentFile: 'bad.md',
						error: 'string error message',
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			await scanner.indexVault();

			expect(scanner.getFailedFiles()[0].error).toBe('string error message');
		});

		it('should handle missing error in file_error event', async () => {
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_error',
						currentFile: 'bad.md',
						error: undefined,
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			await scanner.indexVault();

			expect(scanner.getFailedFiles()[0].error).toBe('Unknown error');
		});

		it('should re-throw rate limit errors from file_error to trigger cooldown', async () => {
			const rateLimiter = createMockRateLimiter();
			rateLimiter.isRateLimitError.mockReturnValue(true);
			rateLimiter.consecutiveCount = 99; // exceed maxRetries to avoid recursive retry
			const callbacks = createMockCallbacks();

			const rateLimitError = new Error('429 Too Many Requests');
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_error',
						currentFile: 'limited.md',
						error: rateLimitError,
					});
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ callbacks, rateLimiter, ragCache });

			const result = await scanner.indexVault();

			// Should have set error status because max retries exceeded
			expect(callbacks.setStatus).toHaveBeenCalledWith('error');
			expect(rateLimiter.resetTracking).toHaveBeenCalled();
			expect(result).toBeDefined();
		});
	});

	// ── Success path completion ──────────────────────────────────────────

	describe('success path completion', () => {
		it('should save cache, clear indexingInProgress, refresh count, set idle, reset rate limiter', async () => {
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache();
			const rateLimiter = createMockRateLimiter();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 0 });
					await opts.onProgress({ type: 'complete', totalFiles: 0 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache, rateLimiter });

			await scanner.indexVault();

			expect(ragCache.cache.indexingInProgress).toBe(false);
			expect(ragCache.cache.indexingStartedAt).toBeUndefined();
			expect(ragCache.cache.lastIndexedFile).toBeUndefined();
			expect(ragCache.saveCache).toHaveBeenCalled();
			expect(ragCache.refreshIndexedCount).toHaveBeenCalled();
			expect(callbacks.setStatus).toHaveBeenCalledWith('idle');
			expect(rateLimiter.resetTracking).toHaveBeenCalled();
			expect(scanner.getCurrentFile()).toBeUndefined();
			expect(scanner.getIndexingStartTime()).toBeUndefined();
		});
	});

	// ── Rate limit max retries exceeded ──────────────────────────────────

	describe('rate limit max retries exceeded', () => {
		it('should set error status and clear resume flags', async () => {
			const rateLimiter = createMockRateLimiter();
			rateLimiter.isRateLimitError.mockReturnValue(true);
			rateLimiter.consecutiveCount = 5;
			rateLimiter.maxRetries = 5;
			(isQuotaExhausted as any).mockReturnValue(false);

			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockRejectedValue(new Error('429 rate limit')),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ callbacks, rateLimiter, ragCache });

			const result = await scanner.indexVault();

			expect(callbacks.setStatus).toHaveBeenCalledWith('error');
			expect(rateLimiter.resetTracking).toHaveBeenCalled();
			expect(ragCache.cache.indexingInProgress).toBe(false);
			expect(ragCache.cache.indexingStartedAt).toBeUndefined();
			expect(ragCache.cache.lastIndexedFile).toBeUndefined();
			expect(ragCache.saveCache).toHaveBeenCalled();
			expect(callbacks.onUpdateStatusBar).toHaveBeenCalled();
			expect(callbacks.onNotifyListeners).toHaveBeenCalled();
			expect(result).toBeDefined();
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});
	});

	// ── Rate limit retry ─────────────────────────────────────────────────

	describe('rate limit retry', () => {
		it('should save progress, wait cooldown, and retry combining results', async () => {
			const rateLimiter = createMockRateLimiter();
			rateLimiter.isRateLimitError.mockReturnValue(true);
			rateLimiter.consecutiveCount = 0;
			rateLimiter.maxRetries = 5;
			(isQuotaExhausted as any).mockReturnValue(false);

			const callbacks = createMockCallbacks();
			let callCount = 0;
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					callCount++;
					if (callCount === 1) {
						throw new Error('429 rate limit');
					}
					// Second call succeeds
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({
						type: 'file_complete',
						currentFile: 'retried.md',
						completedFiles: 1,
						skippedFiles: 0,
						totalFiles: 1,
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ callbacks, rateLimiter, ragCache });

			const result = await scanner.indexVault();

			expect(rateLimiter.handleRateLimit).toHaveBeenCalled();
			expect(ragCache.saveCache).toHaveBeenCalled();
			// Results should be combined from retry
			expect(result.indexed).toBeGreaterThanOrEqual(1);
			expect(result.duration).toBeGreaterThanOrEqual(0);
			// Should have set status back to indexing before retry
			expect(callbacks.setStatus).toHaveBeenCalledWith('indexing');
		});
	});

	// ── Cancellation ─────────────────────────────────────────────────────

	describe('cancellation', () => {
		it('should set idle status and return partial results when cancelled', async () => {
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 2 });
					// Simulate user requesting cancellation
					(scanner as any).cancelRequested = true;
					// Next progress event should throw 'Indexing cancelled by user'
					await opts.onProgress({ type: 'file_start', currentFile: 'test.md' });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache });

			const result = await scanner.indexVault();

			// Should set idle (not error) on cancellation
			expect(callbacks.setStatus).toHaveBeenCalledWith('idle');
			expect(result).toBeDefined();
			expect(result.duration).toBeGreaterThanOrEqual(0);
			// Resume flags should be cleared
			expect(ragCache.cache.indexingInProgress).toBe(false);
		});
	});

	// ── Non-rate-limit error re-throw ────────────────────────────────────

	describe('non-rate-limit error', () => {
		it('should re-throw non-rate-limit errors', async () => {
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockRejectedValue(new Error('Network failure')),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache });

			await expect(scanner.indexVault()).rejects.toThrow('Network failure');
			expect(callbacks.setStatus).toHaveBeenCalledWith('error');
			expect(ragCache.cache.indexingInProgress).toBe(false);
		});
	});

	// ── handleInterruptedIndexing ────────────────────────────────────────

	describe('handleInterruptedIndexing', () => {
		it('should return early when cache is null', async () => {
			const ragCache = createMockRagCache();
			ragCache.cache = null;
			const { scanner } = createScanner({ ragCache });

			await scanner.handleInterruptedIndexing({});

			// Should not throw or do anything
		});

		it('should build resumeInfo and show modal with resume callback', async () => {
			const ragCache = createMockRagCache({
				cacheData: {
					files: { 'a.md': {}, 'b.md': {} },
					indexingStartedAt: 1000,
					lastIndexedFile: 'b.md',
				},
			});
			const { scanner } = createScanner({ ragCache });

			// Import the mocked modal to configure it
			const { RagResumeModal } = await import('../../src/ui/rag-resume-modal');
			(RagResumeModal as any).mockImplementation(function (_app: any, resumeInfo: any, callback: any) {
				// Verify resumeInfo was built correctly
				expect(resumeInfo.filesIndexed).toBe(2);
				expect(resumeInfo.interruptedAt).toBe(1000);
				expect(resumeInfo.lastFile).toBe('b.md');
				this.open = () => {
					// Simulate user choosing resume
					callback(true);
				};
			});

			// Mock startResumeIndexing to avoid side effects
			const spy = vi.spyOn(scanner, 'startResumeIndexing').mockImplementation(() => {});

			const progressProvider = { foo: 'bar' };
			await scanner.handleInterruptedIndexing(progressProvider);

			expect(spy).toHaveBeenCalledWith(progressProvider);
			spy.mockRestore();
		});

		it('should call startFresh when user declines resume', async () => {
			const ragCache = createMockRagCache({
				cacheData: {
					files: { 'a.md': {} },
					indexingStartedAt: 2000,
					lastSync: 500,
				},
			});
			const callbacks = createMockCallbacks();
			const mockAi = {
				fileSearchStores: {
					get: vi.fn().mockResolvedValue({ name: 'test-store' }),
					create: vi.fn().mockResolvedValue({ name: 'fresh-store' }),
					delete: vi.fn().mockResolvedValue(undefined),
				},
			};
			(callbacks.getAi as any).mockReturnValue(mockAi);
			const plugin = createMockPlugin();
			const { scanner } = createScanner({ plugin, ragCache, callbacks });

			const { RagResumeModal } = await import('../../src/ui/rag-resume-modal');
			(RagResumeModal as any).mockImplementation(function (_app: any, _resumeInfo: any, callback: any) {
				this.open = () => {
					// Simulate user choosing start fresh
					callback(false);
				};
			});

			// Mock startResumeIndexing to prevent actual indexing
			vi.spyOn(scanner, 'startResumeIndexing').mockImplementation(() => {});

			await scanner.handleInterruptedIndexing({});

			// startFresh should have cleared cache and deleted store
			expect(ragCache.saveCache).toHaveBeenCalled();
		});
	});

	// ── startResumeIndexing ──────────────────────────────────────────────

	describe('startResumeIndexing', () => {
		it('should open progress modal and start indexing in background', async () => {
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 0 });
					await opts.onProgress({ type: 'complete', totalFiles: 0 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			const { RagProgressModal } = await import('../../src/ui/rag-progress-modal');
			(RagProgressModal as any).mockImplementation(function () {
				this.open = vi.fn();
			});

			scanner.startResumeIndexing({});

			// Wait for the background indexing to complete
			await new Promise((resolve) => window.setTimeout(resolve, 50));

			expect(RagProgressModal).toHaveBeenCalled();
		});
	});

	// ── startFresh ───────────────────────────────────────────────────────

	describe('startFresh', () => {
		it('should clear cache, delete old store, recreate store, and start indexing', async () => {
			const callbacks = createMockCallbacks();
			const mockAi = {
				fileSearchStores: {
					get: vi.fn().mockResolvedValue({ name: 'test-store' }),
					create: vi.fn().mockResolvedValue({ name: 'fresh-store' }),
					delete: vi.fn().mockResolvedValue(undefined),
				},
			};
			(callbacks.getAi as any).mockReturnValue(mockAi);
			const plugin = createMockPlugin();
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ plugin, callbacks, ragCache });

			// Mock startResumeIndexing to prevent actual indexing
			vi.spyOn(scanner, 'startResumeIndexing').mockImplementation(() => {});

			// Call private method
			await (scanner as any).startFresh({});

			expect(ragCache.saveCache).toHaveBeenCalled();
			expect(ragCache.indexedCount).toBe(0);
			expect(mockAi.fileSearchStores.delete).toHaveBeenCalledWith({
				name: 'test-store',
				config: { force: true },
			});
			expect(plugin.settings.ragIndexing.fileSearchStoreName).toBe('fresh-store');
			expect(scanner.startResumeIndexing).toHaveBeenCalled();
		});

		it('should handle 404 delete error gracefully in startFresh', async () => {
			const callbacks = createMockCallbacks();
			const mockAi = {
				fileSearchStores: {
					get: vi.fn().mockResolvedValue({ name: 'test-store' }),
					create: vi.fn().mockResolvedValue({ name: 'fresh-store-2' }),
					delete: vi.fn().mockRejectedValue(new Error('404 not found')),
				},
			};
			(callbacks.getAi as any).mockReturnValue(mockAi);
			const plugin = createMockPlugin();
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ plugin, callbacks, ragCache });

			vi.spyOn(scanner, 'startResumeIndexing').mockImplementation(() => {});

			// Should not throw - 404 is handled gracefully
			await (scanner as any).startFresh({});

			expect(mockAi.fileSearchStores.create).toHaveBeenCalled();
			expect(scanner.startResumeIndexing).toHaveBeenCalled();
		});

		it('should re-throw non-404 delete errors in startFresh', async () => {
			const callbacks = createMockCallbacks();
			const mockAi = {
				fileSearchStores: {
					get: vi.fn(),
					create: vi.fn(),
					delete: vi.fn().mockRejectedValue(new Error('Permission denied')),
				},
			};
			(callbacks.getAi as any).mockReturnValue(mockAi);
			const plugin = createMockPlugin();
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ plugin, callbacks, ragCache });

			// startFresh catches and shows Notice instead of re-throwing
			await (scanner as any).startFresh({});

			expect(plugin.logger.error).toHaveBeenCalledWith('RAG Indexing: Failed to start fresh', expect.any(Error));
		});
	});

	// ── ensureFileSearchStore create failure ──────────────────────────────

	describe('ensureFileSearchStore create failure', () => {
		it('should throw when store creation fails', async () => {
			const mockAi = {
				fileSearchStores: {
					get: vi.fn(),
					create: vi.fn().mockRejectedValue(new Error('API key invalid')),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = null;
			const { scanner } = createScanner({ plugin, callbacks });

			await expect(scanner.ensureFileSearchStore()).rejects.toThrow('API key invalid');
		});
	});

	// ── deleteFileSearchStore failure ─────────────────────────────────────

	describe('deleteFileSearchStore failure', () => {
		it('should throw when store deletion fails', async () => {
			const mockAi = {
				fileSearchStores: {
					delete: vi.fn().mockRejectedValue(new Error('Deletion forbidden')),
				},
			};
			const callbacks = createMockCallbacks({ getAi: vi.fn().mockReturnValue(mockAi) });
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing.fileSearchStoreName = 'doomed-store';
			const { scanner } = createScanner({ plugin, callbacks });

			await expect(scanner.deleteFileSearchStore()).rejects.toThrow('Deletion forbidden');
		});
	});

	// ── indexVault initialisation state ───────────────────────────────────

	describe('indexVault initialisation', () => {
		it('should mark cache indexingInProgress and save before uploading', async () => {
			const callbacks = createMockCallbacks();
			const ragCache = createMockRagCache();
			let cacheSnapshotBeforeUpload: any = null;
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					// Capture cache state at the moment upload starts
					cacheSnapshotBeforeUpload = { ...ragCache.cache };
					await opts.onProgress({ type: 'start', totalFiles: 0 });
					await opts.onProgress({ type: 'complete', totalFiles: 0 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks, ragCache });

			await scanner.indexVault();

			expect(cacheSnapshotBeforeUpload.indexingInProgress).toBe(true);
			expect(cacheSnapshotBeforeUpload.indexingStartedAt).toBeDefined();
			expect(ragCache.saveCache).toHaveBeenCalled();
		});
	});

	// ── complete event clears currentFile ─────────────────────────────────

	describe('complete event', () => {
		it('should clear currentFile and invoke progressCallback with complete phase', async () => {
			const progressCallback = vi.fn();
			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockImplementation(async (_a: any, _b: any, _c: any, opts: any) => {
					await opts.onProgress({ type: 'start', totalFiles: 1 });
					await opts.onProgress({ type: 'file_start', currentFile: 'note.md' });
					await opts.onProgress({
						type: 'file_complete',
						currentFile: 'note.md',
						completedFiles: 1,
						skippedFiles: 0,
						totalFiles: 1,
					});
					await opts.onProgress({ type: 'complete', totalFiles: 1 });
				}),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const { scanner } = createScanner({ callbacks });

			await scanner.indexVault(progressCallback);

			expect(progressCallback).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: 'complete',
					message: expect.stringContaining('Indexed 1'),
				})
			);
		});
	});

	// ── Quota exhaustion with cache cleanup ───────────────────────────────

	describe('quota exhaustion with cache cleanup', () => {
		it('should clear resume flags in cache on quota exhaustion', async () => {
			const rateLimiter = createMockRateLimiter();
			rateLimiter.isRateLimitError.mockReturnValue(true);
			(isQuotaExhausted as any).mockReturnValue(true);

			const callbacks = createMockCallbacks();
			const fileUploader = {
				uploadWithAdapter: vi.fn().mockRejectedValue(new Error('RESOURCE_EXHAUSTED')),
			};
			(callbacks.getFileUploader as any).mockReturnValue(fileUploader);
			const ragCache = createMockRagCache();
			const { scanner } = createScanner({ callbacks, rateLimiter, ragCache });

			await scanner.indexVault();

			expect(ragCache.cache.indexingInProgress).toBe(false);
			expect(ragCache.cache.indexingStartedAt).toBeUndefined();
			expect(ragCache.cache.lastIndexedFile).toBeUndefined();
			expect(ragCache.saveCache).toHaveBeenCalled();
			// Reset isQuotaExhausted for other tests
			(isQuotaExhausted as any).mockReturnValue(false);
		});
	});
});
