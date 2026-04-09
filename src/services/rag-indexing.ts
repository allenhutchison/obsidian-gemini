import { TFile, Notice } from 'obsidian';
import { GoogleGenAI } from '@google/genai';
import { FileUploader } from '@allenhutchison/gemini-utils';
import type ObsidianGemini from '../main';
import { ObsidianVaultAdapter } from './obsidian-file-adapter';
import { getErrorMessage } from '../utils/error-utils';
import { RagCache } from './rag-cache';
import { RagRateLimiter } from './rag-rate-limiter';
import { RagStatusBar } from './rag-status-bar';
import { RagSyncQueue } from './rag-sync-queue';
import { RagVaultScanner } from './rag-vault-scanner';
import type {
	IndexProgress,
	IndexResult,
	FailedFileEntry,
	RagIndexStatus,
	RagProgressInfo,
	ProgressListener,
} from './rag-types';

// Re-export all types for backwards compatibility
export type {
	IndexedFileEntry,
	RagIndexCache,
	IndexProgress,
	IndexResult,
	FailedFileEntry,
	RagIndexStatus,
	RagProgressInfo,
	ProgressListener,
} from './rag-types';

/**
 * Service for managing RAG indexing of vault files to Google's File Search API.
 *
 * Orchestrates the following concerns via composition:
 * - RagCache: Local cache persistence
 * - RagRateLimiter: API rate limit handling
 * - RagStatusBar: Status bar UI
 * - RagSyncQueue: File change queue and debouncing
 * - RagVaultScanner: Vault-wide indexing and file search store management
 */
export class RagIndexingService {
	private plugin: ObsidianGemini;
	private ai: GoogleGenAI | null = null;
	private fileUploader: FileUploader | null = null;
	private vaultAdapter: ObsidianVaultAdapter | null = null;

	private status: RagIndexStatus = 'disabled';
	private progressListeners: Set<ProgressListener> = new Set();

	// Composed modules
	private ragCache: RagCache;
	private rateLimiter: RagRateLimiter;
	private statusBar: RagStatusBar;
	private syncQueue: RagSyncQueue;
	private vaultScanner: RagVaultScanner;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;

		// Create all composed modules eagerly so they exist from construction time.
		// API client, file uploader, and vault adapter are set during initialize()
		// and accessed through callback getters.
		this.ragCache = new RagCache(plugin);

		this.rateLimiter = new RagRateLimiter(this.plugin.logger, {
			onStatusChange: (s) => {
				this.status = s;
			},
			onUpdateStatusBar: () => this.updateStatusBar(),
			onNotifyListeners: () => this.notifyProgressListeners(),
		});

		this.syncQueue = new RagSyncQueue(this.plugin, this.ragCache, this.rateLimiter, {
			getStatus: () => this.status,
			setStatus: (s) => {
				this.status = s;
			},
			isReady: () => this.isReady(),
			getVaultAdapter: () => this.vaultAdapter,
			getFileUploader: () => this.fileUploader,
			getStoreName: () => this.getStoreName(),
			onUpdateStatusBar: () => this.updateStatusBar(),
		});

		this.vaultScanner = new RagVaultScanner(this.plugin, this.ragCache, this.rateLimiter, {
			getStatus: () => this.status,
			setStatus: (s) => {
				this.status = s;
			},
			isReady: () => this.isReady(),
			getAi: () => this.ai,
			getVaultAdapter: () => this.vaultAdapter,
			getFileUploader: () => this.fileUploader,
			getStoreName: () => this.getStoreName(),
			onUpdateStatusBar: () => this.updateStatusBar(),
			onNotifyListeners: () => this.notifyProgressListeners(),
		});

		this.statusBar = new RagStatusBar(this.plugin, this.createStatusProvider());
	}

	/**
	 * Initialize the RAG indexing service
	 */
	async initialize(): Promise<void> {
		if (!this.plugin.settings.ragIndexing.enabled) {
			this.status = 'disabled';
			return;
		}

		if (!this.plugin.apiKey) {
			this.plugin.logger.warn('RAG Indexing: No API key configured');
			this.status = 'error';
			return;
		}

		try {
			// Initialize Google GenAI client
			this.ai = new GoogleGenAI({ apiKey: this.plugin.apiKey });

			// Create vault adapter for file operations
			this.vaultAdapter = new ObsidianVaultAdapter({
				vault: this.plugin.app.vault,
				metadataCache: this.plugin.app.metadataCache,
				excludeFolders: this.plugin.settings.ragIndexing.excludeFolders,
				historyFolder: this.plugin.settings.historyFolder,
				includeAttachments: this.plugin.settings.ragIndexing.includeAttachments,
				logError: (msg, ...args) => this.plugin.logger.error(msg, ...args),
			});

			// Create file uploader with logger
			this.fileUploader = new FileUploader(this.ai, {
				debug: (msg, ...args) => this.plugin.logger.debug(msg, ...args),
				error: (msg, ...args) => this.plugin.logger.error(msg, ...args),
			});

			// Load cache from disk
			await this.ragCache.loadCache();

			// Create or verify File Search Store
			await this.vaultScanner.ensureFileSearchStore();

			// Setup status bar
			this.statusBar.setup();

			// Update status
			this.status = 'idle';
			this.updateStatusBar();

			this.plugin.logger.log('RAG Indexing: Initialized successfully');

			// Check for interrupted indexing
			if (this.ragCache.cache?.indexingInProgress) {
				this.plugin.logger.log('RAG Indexing: Detected interrupted indexing, prompting user');
				await this.vaultScanner.handleInterruptedIndexing(this);
				return; // handleInterruptedIndexing will trigger indexing if needed
			}

			// If this is first time (no indexed files), start initial indexing
			if (this.ragCache.indexedCount === 0) {
				new Notice('RAG Indexing: Starting initial vault indexing...');

				// Open progress modal for initial indexing
				import('../ui/rag-progress-modal').then(({ RagProgressModal }) => {
					const progressModal = new RagProgressModal(this.plugin.app, this, (result) => {
						new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
					});
					progressModal.open();
				});

				// Run indexing in background (don't await - modal handles display)
				this.indexVault().catch((error) => {
					this.plugin.logger.error('RAG Indexing: Initial indexing failed', error);
					new Notice(`RAG Indexing failed: ${getErrorMessage(error)}`);
				});
			}
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to initialize', error);
			this.status = 'error';
			this.updateStatusBar();
		}
	}

	/**
	 * Destroy the service and cleanup resources
	 */
	async destroy(): Promise<void> {
		// Wait for any in-flight indexing to complete
		if (this.vaultScanner?.hasActivePromise()) {
			try {
				await this.indexVault();
			} catch (error) {
				this.plugin.logger.error('RAG Indexing: Error while waiting for indexing during destroy', error);
			}
		}

		// Wait for any in-flight change processing
		if (this.syncQueue) {
			while (this.syncQueue.getIsProcessing()) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		// Cleanup composed modules
		this.syncQueue?.destroy();
		this.rateLimiter?.destroy();
		this.statusBar?.destroy();
		this.vaultScanner?.destroy();
		this.ragCache.destroy();

		this.ai = null;
		this.fileUploader = null;
		this.vaultAdapter = null;
		this.status = 'disabled';
	}

	// ==================== Status & Information ====================

	getStatus(): RagIndexStatus {
		return this.status;
	}

	getStoreName(): string | null {
		return this.plugin.settings.ragIndexing.fileSearchStoreName;
	}

	getClient(): GoogleGenAI | null {
		return this.ai;
	}

	isReady(): boolean {
		return this.status !== 'disabled' && this.status !== 'error' && this.ai !== null;
	}

	getIndexedFileCount(): number {
		return this.ragCache.indexedCount;
	}

	getStatusInfo(): {
		status: RagIndexStatus;
		indexedCount: number;
		storeName: string | null;
		lastSync: number | null;
		progress?: { current: number; total: number };
	} {
		return {
			status: this.status,
			indexedCount: this.ragCache.indexedCount,
			storeName: this.plugin.settings.ragIndexing.fileSearchStoreName,
			lastSync: this.ragCache.cache?.lastSync || null,
			progress: this.status === 'indexing' ? this.vaultScanner?.getIndexingProgress() : undefined,
		};
	}

	getProgressInfo(): RagProgressInfo {
		return {
			status: this.status,
			indexedCount: this.vaultScanner?.getRunningIndexed() ?? 0,
			skippedCount: this.vaultScanner?.getRunningSkipped() ?? 0,
			failedCount: this.vaultScanner?.getRunningFailed() ?? 0,
			totalCount: this.vaultScanner?.getIndexingProgress().total ?? 0,
			currentFile: this.vaultScanner?.getCurrentFile(),
			startTime: this.vaultScanner?.getIndexingStartTime(),
			storeName: this.plugin.settings.ragIndexing.fileSearchStoreName,
			lastSync: this.ragCache.cache?.lastSync || null,
		};
	}

	getPendingCount(): number {
		return this.syncQueue?.getPendingCount() ?? 0;
	}

	getDetailedStatus(): {
		status: RagIndexStatus;
		indexedCount: number;
		failedCount: number;
		pendingCount: number;
		storeName: string | null;
		lastSync: number | null;
		indexedFiles: Array<{ path: string; lastIndexed: number }>;
		failedFiles: FailedFileEntry[];
	} {
		// Build indexed files list from cache, sorted by lastIndexed (newest first)
		const indexedFiles = this.ragCache.cache
			? Object.entries(this.ragCache.cache.files)
					.map(([path, entry]) => ({ path, lastIndexed: entry.lastIndexed }))
					.sort((a, b) => b.lastIndexed - a.lastIndexed)
			: [];

		return {
			status: this.status,
			indexedCount: this.ragCache.indexedCount,
			failedCount: this.vaultScanner?.getFailedFiles().length ?? 0,
			pendingCount: this.syncQueue?.getPendingCount() ?? 0,
			storeName: this.plugin.settings.ragIndexing.fileSearchStoreName,
			lastSync: this.ragCache.cache?.lastSync || null,
			indexedFiles,
			failedFiles: [...(this.vaultScanner?.getFailedFiles() ?? [])],
		};
	}

	getIndexingProgress(): { current: number; total: number } {
		return this.vaultScanner?.getIndexingProgress() ?? { current: 0, total: 0 };
	}

	// ==================== Progress Listeners ====================

	addProgressListener(listener: ProgressListener): void {
		this.progressListeners.add(listener);
	}

	removeProgressListener(listener: ProgressListener): void {
		this.progressListeners.delete(listener);
	}

	private notifyProgressListeners(): void {
		const progress = this.getProgressInfo();
		for (const listener of this.progressListeners) {
			try {
				listener(progress);
			} catch (error) {
				this.plugin.logger.error('RAG Indexing: Error in progress listener', error);
			}
		}
	}

	// ==================== Control ====================

	cancelIndexing(): void {
		this.vaultScanner?.cancelIndexing();
	}

	isIndexing(): boolean {
		return this.status === 'indexing';
	}

	isPaused(): boolean {
		return this.status === 'paused';
	}

	pause(): void {
		if (this.status !== 'idle') {
			this.plugin.logger.log(`RAG Indexing: Cannot pause from ${this.status} state`);
			return;
		}

		this.syncQueue?.clearTimer();
		this.status = 'paused';
		this.updateStatusBar();
		this.plugin.logger.log('RAG Indexing: Paused');
	}

	resume(): void {
		if (this.status !== 'paused') {
			this.plugin.logger.log(`RAG Indexing: Cannot resume from ${this.status} state`);
			return;
		}

		this.status = 'idle';
		this.updateStatusBar();
		this.plugin.logger.log('RAG Indexing: Resumed');

		// Process any pending changes that accumulated while paused
		if (this.syncQueue && this.syncQueue.getPendingCount() > 0) {
			this.plugin.logger.log(`RAG Indexing: Processing ${this.syncQueue.getPendingCount()} pending changes`);
			this.syncQueue.flushPendingChanges();
		}
	}

	// ==================== Delegated Operations ====================

	async syncPendingChanges(): Promise<boolean> {
		return this.syncQueue?.syncPendingChanges() ?? false;
	}

	async indexVault(progressCallback?: (progress: IndexProgress) => void): Promise<IndexResult> {
		return this.vaultScanner.indexVault(progressCallback);
	}

	async deleteFileSearchStore(): Promise<void> {
		return this.vaultScanner.deleteFileSearchStore();
	}

	getRateLimitRemainingSeconds(): number {
		return this.rateLimiter?.getRemainingSeconds() ?? 0;
	}

	// ==================== File Event Handlers ====================

	onFileCreate(file: TFile): void {
		this.syncQueue?.onFileCreate(file);
	}

	onFileModify(file: TFile): void {
		this.syncQueue?.onFileModify(file);
	}

	onFileDelete(file: TFile): void {
		this.syncQueue?.onFileDelete(file);
	}

	onFileRename(file: TFile, oldPath: string): void {
		this.syncQueue?.onFileRename(file, oldPath);
	}

	// ==================== Private Helpers ====================

	private updateStatusBar(): void {
		this.statusBar?.update();
	}

	/**
	 * Create the status provider interface for the status bar
	 */
	private createStatusProvider() {
		return {
			getStatus: () => this.status,
			getIndexedFileCount: () => this.ragCache.indexedCount,
			getIndexingProgress: () => this.vaultScanner?.getIndexingProgress() ?? { current: 0, total: 0 },
			getProgressInfo: () => this.getProgressInfo(),
			isPaused: () => this.isPaused(),
			getRateLimitRemainingSeconds: () => this.getRateLimitRemainingSeconds(),
			getDetailedStatus: () => this.getDetailedStatus(),
			indexVault: () => this.indexVault(),
			syncPendingChanges: () => this.syncPendingChanges(),
			addProgressListener: (listener: ProgressListener) => this.addProgressListener(listener),
			removeProgressListener: (listener: ProgressListener) => this.removeProgressListener(listener),
			cancelIndexing: () => this.cancelIndexing(),
		};
	}
}
