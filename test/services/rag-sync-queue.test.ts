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
	isRateLimitError: () => false,
	isQuotaExhausted: () => false,
	getErrorMessage: (e: any) => (e instanceof Error ? e.message : String(e)),
}));

import { RagSyncQueue } from '../../src/services/rag-sync-queue';
import { RagCache } from '../../src/services/rag-cache';
import { RagRateLimiter } from '../../src/services/rag-rate-limiter';
import { TFile } from 'obsidian';

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

	afterEach(() => {
		vi.useRealTimers();
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
			(queue as any).debounceTimer = setTimeout(() => {}, 1000);
			queue.clearTimer();
			expect((queue as any).debounceTimer).toBeNull();
		});
	});

	describe('destroy', () => {
		it('should clear all state', () => {
			(queue as any).debounceTimer = setTimeout(() => {}, 1000);
			(queue as any).pendingChanges = new Map([['test.md', {}]]);

			queue.destroy();

			expect((queue as any).debounceTimer).toBeNull();
			expect(queue.getPendingCount()).toBe(0);
			expect(queue.getIsProcessing()).toBe(false);
		});
	});
});
