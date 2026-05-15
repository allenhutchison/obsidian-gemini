vi.mock('obsidian', () => {
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
	};
});

vi.mock('../../src/utils/error-utils', () => ({
	isRateLimitError: vi.fn().mockReturnValue(false),
	isQuotaExhausted: vi.fn().mockReturnValue(false),
	getErrorMessage: vi.fn((e: any) => (e instanceof Error ? e.message : String(e))),
}));

import { RagSyncQueue } from '../../src/services/rag-sync-queue';
// import { RagCache } from '../../src/services/rag-cache';
// import { RagRateLimiter } from '../../src/services/rag-rate-limiter';
import { TFile, Notice } from 'obsidian';
import { isQuotaExhausted } from '../../src/utils/error-utils';

function createMockTFile(path: string): TFile {
	return new (TFile as any)(path) as TFile;
}

function createMockPlugin() {
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
			},
		},
		settings: {
			historyFolder: 'gemini-scribe',
			ragIndexing: {
				enabled: true,
				fileSearchStoreName: 'test-store',
				excludeFolders: [],
				autoSync: true,
				includeAttachments: false,
			},
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	} as any;
}

describe('RagSyncQueue', () => {
	let queue: RagSyncQueue;
	let mockPlugin: ReturnType<typeof createMockPlugin>;
	let mockCallbacks: any;
	let mockCache: any;
	let mockRateLimiter: any;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		mockPlugin = createMockPlugin();

		mockCache = {
			cache: { version: '1.0', storeName: 'test', lastSync: 0, files: {} },
			indexedCount: 0,
			saveCache: vi.fn().mockResolvedValue(undefined),
			incrementAndMaybeSaveCache: vi.fn().mockResolvedValue(0),
			refreshIndexedCount: vi.fn(),
		};

		mockRateLimiter = {
			isRateLimitError: vi.fn().mockReturnValue(false),
			resetTracking: vi.fn(),
			handleRateLimit: vi.fn().mockResolvedValue(undefined),
		};

		mockCallbacks = {
			getStatus: vi.fn().mockReturnValue('idle'),
			setStatus: vi.fn(),
			isReady: vi.fn().mockReturnValue(true),
			getVaultAdapter: vi.fn().mockReturnValue({
				shouldIndex: vi.fn().mockReturnValue(true),
			}),
			getFileUploader: vi.fn().mockReturnValue({
				uploadContent: vi.fn().mockResolvedValue(undefined),
			}),
			getStoreName: vi.fn().mockReturnValue('test-store'),
			onUpdateStatusBar: vi.fn(),
		};

		queue = new RagSyncQueue(mockPlugin, mockCache as any, mockRateLimiter as any, mockCallbacks);
	});

	afterEach(async () => {
		// Destroy the queue to clean up debounce timers and pending changes
		// This prevents fire-and-forget re-entry in flushPendingChanges from keeping the worker alive
		queue.destroy();
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		// Allow any fire-and-forget promises to settle
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});

	describe('getPendingCount', () => {
		it('should return 0 initially', () => {
			expect(queue.getPendingCount()).toBe(0);
		});
	});

	describe('onFileCreate', () => {
		it('should queue create change', () => {
			const file = createMockTFile('notes/test.md');
			queue.onFileCreate(file);

			expect(queue.getPendingCount()).toBe(1);
			expect(queue.getPendingChanges().get('notes/test.md')!.type).toBe('create');
		});

		it('should not queue when not ready', () => {
			mockCallbacks.isReady.mockReturnValue(false);
			const file = createMockTFile('notes/test.md');
			queue.onFileCreate(file);

			expect(queue.getPendingCount()).toBe(0);
		});

		it('should not queue when autoSync disabled', () => {
			mockPlugin.settings.ragIndexing.autoSync = false;
			const file = createMockTFile('notes/test.md');
			queue.onFileCreate(file);

			expect(queue.getPendingCount()).toBe(0);
		});
	});

	describe('onFileModify', () => {
		it('should queue modify change', () => {
			const file = createMockTFile('notes/test.md');
			queue.onFileModify(file);

			expect(queue.getPendingCount()).toBe(1);
			expect(queue.getPendingChanges().get('notes/test.md')!.type).toBe('modify');
		});
	});

	describe('onFileDelete', () => {
		it('should queue delete change', () => {
			const file = createMockTFile('notes/test.md');
			queue.onFileDelete(file);

			expect(queue.getPendingCount()).toBe(1);
			expect(queue.getPendingChanges().get('notes/test.md')!.type).toBe('delete');
		});
	});

	describe('onFileRename', () => {
		it('should queue delete for old and create for new', () => {
			const file = createMockTFile('notes/new.md');
			queue.onFileRename(file, 'notes/old.md');

			expect(queue.getPendingCount()).toBe(2);
			expect(queue.getPendingChanges().get('notes/old.md')!.type).toBe('delete');
			expect(queue.getPendingChanges().get('notes/new.md')!.type).toBe('create');
		});
	});

	describe('change collapsing', () => {
		it('should collapse create + delete to no-op', () => {
			const file = createMockTFile('test.md');
			queue.onFileCreate(file);
			queue.onFileDelete(file);

			expect(queue.getPendingCount()).toBe(0);
		});

		it('should collapse create + modify to create', () => {
			const file = createMockTFile('test.md');
			queue.onFileCreate(file);
			queue.onFileModify(file);

			expect(queue.getPendingCount()).toBe(1);
			expect(queue.getPendingChanges().get('test.md')!.type).toBe('create');
		});
	});

	describe('debouncing', () => {
		it('should not start timer when paused', () => {
			mockCallbacks.getStatus.mockReturnValue('paused');
			const file = createMockTFile('test.md');
			queue.onFileCreate(file);

			expect((queue as any).debounceTimer).toBeNull();
		});

		it('should start debounce timer', () => {
			const file = createMockTFile('test.md');
			queue.onFileCreate(file);

			expect((queue as any).debounceTimer).not.toBeNull();
		});
	});

	describe('syncPendingChanges', () => {
		it('should return false when no pending changes', async () => {
			const result = await queue.syncPendingChanges();
			expect(result).toBe(false);
		});

		it('should return false when already processing', async () => {
			(queue as any).isProcessing = true;
			(queue as any).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);

			const result = await queue.syncPendingChanges();
			expect(result).toBe(false);
		});

		it('should return false when indexing', async () => {
			mockCallbacks.getStatus.mockReturnValue('indexing');
			(queue as any).pendingChanges = new Map([
				['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
			]);

			const result = await queue.syncPendingChanges();
			expect(result).toBe(false);
		});
	});

	describe('clearTimer', () => {
		it('should clear debounce timer', () => {
			(queue as any).debounceTimer = window.setTimeout(() => {}, 1000);
			queue.clearTimer();
			expect((queue as any).debounceTimer).toBeNull();
		});
	});

	describe('destroy', () => {
		it('should clear all state', () => {
			(queue as any).debounceTimer = window.setTimeout(() => {}, 1000);
			(queue as any).pendingChanges = new Map([['test.md', {}]]);

			queue.destroy();

			expect((queue as any).debounceTimer).toBeNull();
			expect(queue.getPendingCount()).toBe(0);
			expect(queue.getIsProcessing()).toBe(false);
		});
	});

	// ==================== flushPendingChanges ====================

	describe('flushPendingChanges', () => {
		describe('early returns', () => {
			it('should return early when isProcessing is true', async () => {
				(queue as any).isProcessing = true;
				(queue as any).pendingChanges = new Map([
					['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockCallbacks.setStatus).not.toHaveBeenCalled();
			});

			it('should return early when pendingChanges is empty', async () => {
				await (queue as any).flushPendingChanges();

				expect(mockCallbacks.setStatus).not.toHaveBeenCalled();
			});

			it('should return early when fileUploader is null', async () => {
				(queue as any).pendingChanges = new Map([
					['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
				]);
				mockCallbacks.getFileUploader.mockReturnValue(null);

				await (queue as any).flushPendingChanges();

				expect(mockCallbacks.setStatus).not.toHaveBeenCalled();
			});

			it('should return early when vaultAdapter is null', async () => {
				(queue as any).pendingChanges = new Map([
					['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
				]);
				mockCallbacks.getVaultAdapter.mockReturnValue(null);

				await (queue as any).flushPendingChanges();

				expect(mockCallbacks.setStatus).not.toHaveBeenCalled();
			});

			it('should return early when storeName is null', async () => {
				(queue as any).pendingChanges = new Map([
					['test.md', { type: 'create', path: 'test.md', timestamp: Date.now() }],
				]);
				mockCallbacks.getStoreName.mockReturnValue(null);

				await (queue as any).flushPendingChanges();

				expect(mockCallbacks.setStatus).not.toHaveBeenCalled();
			});
		});

		describe('create change happy path', () => {
			it('should upload file, update cache, and do incremental save', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn().mockResolvedValue(undefined) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'file content', hash: 'hash123' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).toHaveBeenCalledWith(
					{ content: 'file content', hash: 'hash123' },
					'test-store'
				);
				expect(mockCache.cache.files['notes/test.md']).toBeDefined();
				expect(mockCache.cache.files['notes/test.md'].contentHash).toBe('hash123');
				expect(mockCache.incrementAndMaybeSaveCache).toHaveBeenCalled();
				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('idle');
			});

			it('should skip when getAbstractFileByPath returns null', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

				const mockUploader = { uploadContent: vi.fn() };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).not.toHaveBeenCalled();
				// Still reaches success finalization
				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('idle');
			});

			it('should skip when shouldIndex returns false', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn() };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(false),
					readFileForUpload: vi.fn(),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).not.toHaveBeenCalled();
			});

			it('should skip upload when readFileForUpload returns null', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn() };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue(null),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).not.toHaveBeenCalled();
			});
		});

		describe('modify change', () => {
			it('should upload modified file and update cache', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn().mockResolvedValue(undefined) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'updated content', hash: 'hash456' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'modify', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).toHaveBeenCalledWith(
					{ content: 'updated content', hash: 'hash456' },
					'test-store'
				);
				expect(mockCache.cache.files['notes/test.md'].contentHash).toBe('hash456');
				expect(mockCache.incrementAndMaybeSaveCache).toHaveBeenCalled();
			});

			it('should skip when getAbstractFileByPath returns null for modify', async () => {
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

				const mockUploader = { uploadContent: vi.fn() };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'modify', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).not.toHaveBeenCalled();
			});

			it('should skip when shouldIndex returns false for modify', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn() };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(false),
					readFileForUpload: vi.fn(),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'modify', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).not.toHaveBeenCalled();
			});

			it('should skip upload when readFileForUpload returns null for modify', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn() };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue(null),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'modify', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockUploader.uploadContent).not.toHaveBeenCalled();
			});
		});

		describe('delete change', () => {
			it('should call deleteFile and reset changesSinceLastSave on success', async () => {
				mockCache.cache.files['notes/test.md'] = {
					resourceName: 'test-store',
					contentHash: 'hash123',
					lastIndexed: Date.now(),
				};

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'delete', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockCache.cache.files['notes/test.md']).toBeUndefined();
				expect(mockCache.saveCache).toHaveBeenCalled();
				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('idle');
			});
		});

		describe('success finalization', () => {
			it('should save cache with lastSync, refresh count, set idle, and reset rate limiter', async () => {
				// Queue a no-op change (file not found, so loop completes without upload)
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);
				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockCache.cache.lastSync).toBeGreaterThan(0);
				expect(mockCache.saveCache).toHaveBeenCalled();
				expect(mockCache.refreshIndexedCount).toHaveBeenCalled();
				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('idle');
				expect(mockRateLimiter.resetTracking).toHaveBeenCalled();
				expect(mockCallbacks.onUpdateStatusBar).toHaveBeenCalled();
			});
		});

		describe('error handling - rate limit + quota exhaustion', () => {
			it('should set error status and show Notice on permanent quota exhaustion', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const uploadError = new Error('quota exhausted');
				const mockUploader = { uploadContent: vi.fn().mockRejectedValue(uploadError) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'data', hash: 'h1' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				mockRateLimiter.isRateLimitError.mockReturnValue(true);
				(isQuotaExhausted as any).mockReturnValue(true);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('error');
				expect(mockRateLimiter.resetTracking).toHaveBeenCalled();
				expect(Notice).toHaveBeenCalled();
				expect(mockCallbacks.onUpdateStatusBar).toHaveBeenCalled();

				// Reset mock
				(isQuotaExhausted as any).mockReturnValue(false);
			});
		});

		describe('error handling - rate limit retryable', () => {
			it('should save progress, re-queue unprocessed, call handleRateLimit, and set idle', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const uploadError = new Error('rate limited');
				const mockUploader = { uploadContent: vi.fn().mockRejectedValue(uploadError) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'data', hash: 'h1' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				mockRateLimiter.isRateLimitError.mockReturnValue(true);
				(isQuotaExhausted as any).mockReturnValue(false);

				(queue as any).pendingChanges = new Map([
					['notes/a.md', { type: 'create', path: 'notes/a.md', timestamp: Date.now() }],
					['notes/b.md', { type: 'create', path: 'notes/b.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockCache.saveCache).toHaveBeenCalled();
				expect(mockRateLimiter.handleRateLimit).toHaveBeenCalledWith(uploadError);
				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('idle');
				expect(mockCallbacks.onUpdateStatusBar).toHaveBeenCalled();
			});
		});

		describe('error handling - non-rate-limit error', () => {
			it('should set error status', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const genericError = new Error('network failure');
				const mockUploader = { uploadContent: vi.fn().mockRejectedValue(genericError) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'data', hash: 'h1' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				mockRateLimiter.isRateLimitError.mockReturnValue(false);

				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				expect(mockPlugin.logger.error).toHaveBeenCalled();
				expect(mockCallbacks.setStatus).toHaveBeenCalledWith('error');
				expect(mockCallbacks.onUpdateStatusBar).toHaveBeenCalled();
			});
		});

		describe('finally block re-entry', () => {
			it('should re-enter if pendingChanges.size > 0 and not in error state', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const mockUploader = { uploadContent: vi.fn().mockResolvedValue(undefined) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'data', hash: 'h1' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				// Simulate a new change arriving while processing the first one
				let firstCall = true;
				const _originalUpload = mockUploader.uploadContent;
				mockUploader.uploadContent = vi.fn().mockImplementation(async () => {
					if (firstCall) {
						firstCall = false;
						// Enqueue a new change while processing
						(queue as any).pendingChanges.set('notes/new.md', {
							type: 'create',
							path: 'notes/new.md',
							timestamp: Date.now(),
						});
					}
				});

				// Start with one change
				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
				]);

				mockCallbacks.getStatus.mockReturnValue('idle');

				await (queue as any).flushPendingChanges();

				// Upload should be called twice: once for initial file, once for re-entry file
				expect(mockUploader.uploadContent).toHaveBeenCalledTimes(2);
			});

			it('should NOT re-enter when in error state', async () => {
				const mockFile = createMockTFile('notes/test.md');
				mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

				const genericError = new Error('failure');
				const mockUploader = { uploadContent: vi.fn().mockRejectedValue(genericError) };
				mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

				const mockAdapter = {
					shouldIndex: vi.fn().mockReturnValue(true),
					readFileForUpload: vi.fn().mockResolvedValue({ content: 'data', hash: 'h1' }),
				};
				mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

				mockRateLimiter.isRateLimitError.mockReturnValue(false);

				// Set status callback to return 'error' after setStatus('error') is called
				mockCallbacks.setStatus.mockImplementation((status: string) => {
					if (status === 'error') {
						mockCallbacks.getStatus.mockReturnValue('error');
					}
				});

				// Inject a pending change that will remain after error
				(queue as any).pendingChanges = new Map([
					['notes/test.md', { type: 'create', path: 'notes/test.md', timestamp: Date.now() }],
					['notes/other.md', { type: 'create', path: 'notes/other.md', timestamp: Date.now() }],
				]);

				await (queue as any).flushPendingChanges();

				// uploadContent called once (first file threw), then error state prevents re-entry
				expect(mockUploader.uploadContent).toHaveBeenCalledTimes(1);
				expect(mockCallbacks.getStatus()).toBe('error');
			});
		});
	});

	// ==================== deleteFile ====================

	describe('deleteFile (private)', () => {
		it('should return false when file is not in cache', async () => {
			const result = await (queue as any).deleteFile('nonexistent.md');
			expect(result).toBe(false);
		});

		it('should remove file from cache, update indexedCount, save, and return true', async () => {
			mockCache.cache.files['notes/test.md'] = {
				resourceName: 'test-store',
				contentHash: 'hash123',
				lastIndexed: Date.now(),
			};
			mockCache.cache.files['notes/other.md'] = {
				resourceName: 'test-store',
				contentHash: 'hash456',
				lastIndexed: Date.now(),
			};

			const result = await (queue as any).deleteFile('notes/test.md');

			expect(result).toBe(true);
			expect(mockCache.cache.files['notes/test.md']).toBeUndefined();
			expect(mockCache.indexedCount).toBe(1); // only 'other.md' remains
			expect(mockCache.saveCache).toHaveBeenCalled();
		});

		it('should log error and return false when saveCache throws', async () => {
			mockCache.cache.files['notes/test.md'] = {
				resourceName: 'test-store',
				contentHash: 'hash123',
				lastIndexed: Date.now(),
			};
			mockCache.saveCache.mockRejectedValueOnce(new Error('save failed'));

			const result = await (queue as any).deleteFile('notes/test.md');

			expect(result).toBe(false);
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});

		it('should return false when cache is null', async () => {
			mockCache.cache = null;
			const result = await (queue as any).deleteFile('notes/test.md');
			expect(result).toBe(false);
		});
	});

	// ==================== syncPendingChanges success path ====================

	describe('syncPendingChanges success path', () => {
		it('should clear timer, call flush, and return true when there are pending changes', async () => {
			const mockFile = createMockTFile('notes/test.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

			const mockUploader = { uploadContent: vi.fn().mockResolvedValue(undefined) };
			mockCallbacks.getFileUploader.mockReturnValue(mockUploader);

			const mockAdapter = {
				shouldIndex: vi.fn().mockReturnValue(true),
				readFileForUpload: vi.fn().mockResolvedValue({ content: 'data', hash: 'h1' }),
			};
			mockCallbacks.getVaultAdapter.mockReturnValue(mockAdapter);

			// Trigger a file create to set a debounce timer
			queue.onFileCreate(mockFile);
			expect((queue as any).debounceTimer).not.toBeNull();

			const result = await queue.syncPendingChanges();

			expect(result).toBe(true);
			expect((queue as any).debounceTimer).toBeNull();
			expect(mockUploader.uploadContent).toHaveBeenCalled();
		});
	});

	// ==================== onFileModify guards ====================

	describe('onFileModify guards', () => {
		it('should not queue when autoSync is disabled', () => {
			mockPlugin.settings.ragIndexing.autoSync = false;
			const file = createMockTFile('notes/test.md');
			queue.onFileModify(file);
			expect(queue.getPendingCount()).toBe(0);
		});

		it('should not queue when shouldIndex returns false', () => {
			mockCallbacks.getVaultAdapter.mockReturnValue({
				shouldIndex: vi.fn().mockReturnValue(false),
			});
			const file = createMockTFile('notes/test.md');
			queue.onFileModify(file);
			expect(queue.getPendingCount()).toBe(0);
		});

		it('should not queue when not ready', () => {
			mockCallbacks.isReady.mockReturnValue(false);
			const file = createMockTFile('notes/test.md');
			queue.onFileModify(file);
			expect(queue.getPendingCount()).toBe(0);
		});
	});

	// ==================== onFileDelete guards ====================

	describe('onFileDelete guards', () => {
		it('should not queue when autoSync is disabled', () => {
			mockPlugin.settings.ragIndexing.autoSync = false;
			const file = createMockTFile('notes/test.md');
			queue.onFileDelete(file);
			expect(queue.getPendingCount()).toBe(0);
		});

		it('should not queue when not ready', () => {
			mockCallbacks.isReady.mockReturnValue(false);
			const file = createMockTFile('notes/test.md');
			queue.onFileDelete(file);
			expect(queue.getPendingCount()).toBe(0);
		});
	});

	// ==================== onFileRename guards ====================

	describe('onFileRename guards', () => {
		it('should not queue when not ready', () => {
			mockCallbacks.isReady.mockReturnValue(false);
			const file = createMockTFile('notes/new.md');
			queue.onFileRename(file, 'notes/old.md');
			expect(queue.getPendingCount()).toBe(0);
		});

		it('should only queue delete when shouldIndex is false for new path', () => {
			mockCallbacks.getVaultAdapter.mockReturnValue({
				shouldIndex: vi.fn().mockReturnValue(false),
			});
			const file = createMockTFile('notes/new.md');
			queue.onFileRename(file, 'notes/old.md');

			expect(queue.getPendingCount()).toBe(1);
			expect(queue.getPendingChanges().get('notes/old.md')!.type).toBe('delete');
			expect(queue.getPendingChanges().get('notes/new.md')).toBeUndefined();
		});

		it('should not queue when autoSync is disabled', () => {
			mockPlugin.settings.ragIndexing.autoSync = false;
			const file = createMockTFile('notes/new.md');
			queue.onFileRename(file, 'notes/old.md');
			expect(queue.getPendingCount()).toBe(0);
		});
	});
});
