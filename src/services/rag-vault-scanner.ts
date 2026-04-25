import { TFile, Notice } from 'obsidian';
import type { GoogleGenAI } from '@google/genai';
import type { FileUploader } from '@allenhutchison/gemini-utils';
import type ObsidianGemini from '../main';
import type { ObsidianVaultAdapter } from './obsidian-file-adapter';
import type { RagCache } from './rag-cache';
import type { RagRateLimiter } from './rag-rate-limiter';
import { CACHE_VERSION } from './rag-types';
import type { IndexProgress, IndexResult, FailedFileEntry, RagIndexStatus } from './rag-types';
import { getErrorMessage, isQuotaExhausted } from '../utils/error-utils';

/**
 * Callbacks for the vault scanner to interact with the orchestrator.
 */
export interface VaultScannerCallbacks {
	getStatus: () => RagIndexStatus;
	setStatus: (status: RagIndexStatus) => void;
	isReady: () => boolean;
	getAi: () => GoogleGenAI | null;
	getVaultAdapter: () => ObsidianVaultAdapter | null;
	getFileUploader: () => FileUploader | null;
	getStoreName: () => string | null;
	onUpdateStatusBar: () => void;
	onNotifyListeners: () => void;
}

/**
 * Manages vault-wide indexing operations, file search store management,
 * and interrupted indexing recovery for the RAG indexing service.
 */
export class RagVaultScanner {
	private plugin: ObsidianGemini;
	private ragCache: RagCache;
	private rateLimiter: RagRateLimiter;
	private callbacks: VaultScannerCallbacks;

	// Progress tracking state
	private _indexingPromise: Promise<IndexResult> | null = null;
	private indexingProgress: { current: number; total: number } = { current: 0, total: 0 };
	private currentFile?: string;
	private indexingStartTime?: number;
	private runningIndexed: number = 0;
	private runningSkipped: number = 0;
	private runningFailed: number = 0;
	private cancelRequested: boolean = false;
	private failedFiles: FailedFileEntry[] = [];

	constructor(
		plugin: ObsidianGemini,
		ragCache: RagCache,
		rateLimiter: RagRateLimiter,
		callbacks: VaultScannerCallbacks
	) {
		this.plugin = plugin;
		this.ragCache = ragCache;
		this.rateLimiter = rateLimiter;
		this.callbacks = callbacks;
	}

	// ==================== Progress Getters ====================

	getIndexingProgress(): { current: number; total: number } {
		return this.indexingProgress;
	}

	getCurrentFile(): string | undefined {
		return this.currentFile;
	}

	getIndexingStartTime(): number | undefined {
		return this.indexingStartTime;
	}

	getRunningIndexed(): number {
		return this.runningIndexed;
	}

	getRunningSkipped(): number {
		return this.runningSkipped;
	}

	getRunningFailed(): number {
		return this.runningFailed;
	}

	getFailedFiles(): FailedFileEntry[] {
		return this.failedFiles;
	}

	/**
	 * Request cancellation of the current indexing operation
	 */
	cancelIndexing(): void {
		if (this.callbacks.getStatus() !== 'indexing') return;
		this.cancelRequested = true;
		this.plugin.logger.log('RAG Indexing: Cancellation requested');
	}

	/**
	 * Check if indexing is in progress
	 */
	isIndexing(): boolean {
		return this.callbacks.getStatus() === 'indexing';
	}

	/**
	 * Check if there is an active indexing promise
	 */
	hasActivePromise(): boolean {
		return this._indexingPromise !== null;
	}

	// ==================== File Search Store Management ====================

	/**
	 * Ensure the File Search Store exists, creating if necessary
	 */
	async ensureFileSearchStore(): Promise<void> {
		const ai = this.callbacks.getAi();
		if (!ai) return;

		const existingStoreName = this.plugin.settings.ragIndexing.fileSearchStoreName;

		if (existingStoreName) {
			// Verify the store still exists
			try {
				await ai.fileSearchStores.get({ name: existingStoreName });
				this.plugin.logger.log(`RAG Indexing: Using existing store ${existingStoreName}`);
				return;
			} catch (error) {
				// Check if it's a 404/not found error vs other errors
				const errorMessage = error instanceof Error ? error.message : String(error);
				const isNotFound =
					errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

				if (isNotFound) {
					this.plugin.logger.warn('RAG Indexing: Store no longer exists, creating new store');
				} else {
					// For other errors (network, auth, etc.), log and re-throw
					this.plugin.logger.error('RAG Indexing: Failed to verify store', error);
					throw error;
				}
			}
		}

		// Create new store
		try {
			const vaultName = this.plugin.app.vault.getName();
			const displayName = `obsidian-${vaultName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

			const store = await ai.fileSearchStores.create({
				config: { displayName },
			});

			// Save the store name to settings
			this.plugin.settings.ragIndexing.fileSearchStoreName = store.name ?? null;
			await this.plugin.saveData(this.plugin.settings);

			// Update cache
			if (this.ragCache.cache) {
				this.ragCache.cache.storeName = store.name ?? '';
			}

			this.plugin.logger.log(`RAG Indexing: Created new store ${store.name}`);
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to create store', error);
			throw error;
		}
	}

	/**
	 * Delete the File Search Store
	 */
	async deleteFileSearchStore(): Promise<void> {
		const ai = this.callbacks.getAi();
		if (!ai) return;

		const storeName = this.plugin.settings.ragIndexing.fileSearchStoreName;
		if (!storeName) return;

		try {
			await ai.fileSearchStores.delete({
				name: storeName,
				config: { force: true },
			});

			// Clear settings and cache
			this.plugin.settings.ragIndexing.fileSearchStoreName = null;
			await this.plugin.saveData(this.plugin.settings);

			// Delete cache file
			const file = this.plugin.app.vault.getAbstractFileByPath(this.ragCache.cachePath);
			if (file instanceof TFile) {
				await this.plugin.app.vault.delete(file);
			}

			this.ragCache.cache = null;
			this.ragCache.indexedCount = 0;

			this.plugin.logger.log('RAG Indexing: Deleted store and cache');
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to delete store', error);
			throw error;
		}
	}

	// ==================== Interrupted Indexing ====================

	/**
	 * Handle interrupted indexing by prompting user to resume or start fresh.
	 * @param progressProvider - The object to pass to the progress modal (typically the orchestrator)
	 */
	async handleInterruptedIndexing(progressProvider: any): Promise<void> {
		if (!this.ragCache.cache) return;

		const resumeInfo = {
			filesIndexed: Object.keys(this.ragCache.cache.files).length,
			interruptedAt: this.ragCache.cache.indexingStartedAt || this.ragCache.cache.lastSync,
			lastFile: this.ragCache.cache.lastIndexedFile,
		};

		// Show modal and wait for user choice
		const { RagResumeModal } = await import('../ui/rag-resume-modal');

		return new Promise<void>((resolve) => {
			const modal = new RagResumeModal(this.plugin.app, resumeInfo, async (resume: boolean) => {
				if (resume) {
					// Resume: just start indexing - smart sync will skip already-indexed files
					new Notice('RAG Indexing: Resuming interrupted indexing...');
					this.startResumeIndexing(progressProvider);
				} else {
					// Start fresh: clear cache and store, then reindex
					new Notice('RAG Indexing: Starting fresh...');
					await this.startFresh(progressProvider);
				}
				resolve();
			});
			modal.open();
		});
	}

	/**
	 * Start resume indexing with progress modal.
	 * @param progressProvider - The object to pass to the progress modal (typically the orchestrator)
	 */
	startResumeIndexing(progressProvider: any): void {
		import('../ui/rag-progress-modal').then(({ RagProgressModal }) => {
			const progressModal = new RagProgressModal(this.plugin.app, progressProvider, (result) => {
				new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
			});
			progressModal.open();
		});

		// Run indexing in background (don't await - modal handles display)
		this.indexVault().catch((error) => {
			this.plugin.logger.error('RAG Indexing: Resume indexing failed', error);
			new Notice(`RAG Indexing failed: ${getErrorMessage(error)}`);
		});
	}

	/**
	 * Clear cache and store, then start fresh indexing
	 */
	private async startFresh(progressProvider: any): Promise<void> {
		try {
			// Clear local cache
			this.ragCache.cache = {
				version: CACHE_VERSION,
				storeName: '',
				lastSync: 0,
				files: {},
			};
			await this.ragCache.saveCache();
			this.ragCache.indexedCount = 0;

			// Delete and recreate the store
			const storeName = this.plugin.settings.ragIndexing.fileSearchStoreName;
			const ai = this.callbacks.getAi();
			if (storeName && ai) {
				try {
					await ai.fileSearchStores.delete({
						name: storeName,
						config: { force: true },
					});
					this.plugin.logger.log(`RAG Indexing: Deleted store ${storeName}`);
				} catch (deleteError) {
					const errorMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
					const isNotFound =
						errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

					if (isNotFound) {
						this.plugin.logger.debug(
							'RAG Indexing: Store no longer exists, proceeding with fresh creation',
							deleteError
						);
					} else {
						throw deleteError;
					}
				}
			}

			// Clear the store name in settings to force recreation
			this.plugin.settings.ragIndexing.fileSearchStoreName = null;
			await this.plugin.saveData(this.plugin.settings);

			// Recreate the store
			await this.ensureFileSearchStore();

			// Start fresh indexing
			this.startResumeIndexing(progressProvider); // Reuses same logic for starting indexing with modal
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to start fresh', error);
			new Notice(`RAG Indexing: Failed to start fresh: ${(error as Error).message}`);
		}
	}

	// ==================== Vault Indexing ====================

	/**
	 * Index the entire vault
	 * If indexing is already in progress, returns the existing promise
	 */
	async indexVault(progressCallback?: (progress: IndexProgress) => void): Promise<IndexResult> {
		// If indexing is already in progress, return the existing promise
		// This prevents race conditions from concurrent calls
		if (this._indexingPromise) {
			this.plugin.logger.debug('RAG Indexing: indexVault already in progress, returning existing promise');
			return this._indexingPromise;
		}

		if (!this.callbacks.isReady()) {
			throw new Error('RAG Indexing service is not ready');
		}

		// Create and store the indexing promise
		this._indexingPromise = this._doIndexVault(progressCallback);

		try {
			return await this._indexingPromise;
		} finally {
			this._indexingPromise = null;
		}
	}

	/**
	 * Internal implementation of vault indexing
	 */
	private async _doIndexVault(progressCallback?: (progress: IndexProgress) => void): Promise<IndexResult> {
		const startTime = Date.now();
		const result: IndexResult = { indexed: 0, skipped: 0, failed: 0, duration: 0 };

		const fileUploader = this.callbacks.getFileUploader();
		const vaultAdapter = this.callbacks.getVaultAdapter();
		if (!fileUploader || !vaultAdapter) {
			throw new Error('RAG Indexing service not properly initialized');
		}

		const storeName = this.callbacks.getStoreName();
		if (!storeName) {
			throw new Error('No File Search Store configured');
		}

		try {
			// Reset progress tracking
			this.callbacks.setStatus('indexing');
			this.indexingProgress = { current: 0, total: 0 };
			this.indexingStartTime = startTime;
			this.runningIndexed = 0;
			this.runningSkipped = 0;
			this.runningFailed = 0;
			this.failedFiles = [];
			this.currentFile = undefined;
			this.cancelRequested = false;
			this.callbacks.onUpdateStatusBar();
			this.callbacks.onNotifyListeners();

			// Mark indexing as in progress for resume capability
			if (this.ragCache.cache) {
				this.ragCache.cache.indexingInProgress = true;
				this.ragCache.cache.indexingStartedAt = startTime;
				this.ragCache.cache.lastIndexedFile = undefined;
				await this.ragCache.saveCache();
			}

			// Track files since last cache save for incremental durability
			let filesSinceLastSave = 0;

			// Use FileUploader with adapter - handles smart sync and parallel uploads
			await fileUploader.uploadWithAdapter(vaultAdapter, '', storeName, {
				smartSync: true,
				parallel: { maxConcurrent: 5 },
				logger: {
					debug: (msg: string, ...args: any[]) => this.plugin.logger.debug(msg, ...args),
					// Per-file upload failures are already tracked via the file_error progress
					// event and surfaced in the RAG Failures tab — downgrade to warn to avoid
					// alarming console noise for routine skips (empty files, inaccessible notes).
					error: (msg: string, ...args: any[]) => this.plugin.logger.warn(msg, ...args),
				},
				onProgress: async (event: any) => {
					// Check for cancellation
					if (this.cancelRequested) {
						throw new Error('Indexing cancelled by user');
					}

					// Map gemini-utils progress events to our format
					if (event.type === 'start') {
						this.indexingProgress = { current: 0, total: event.totalFiles || 0 };
						this.callbacks.onNotifyListeners();
						progressCallback?.({
							current: 0,
							total: event.totalFiles || 0,
							phase: 'scanning',
							message: `Found ${event.totalFiles} files to index`,
						});
					} else if (event.type === 'file_start') {
						this.currentFile = event.currentFile;
						this.callbacks.onNotifyListeners();
					} else if (event.type === 'file_complete') {
						result.indexed++;
						this.runningIndexed++;
						this.currentFile = event.currentFile;
						// Update cache for newly indexed file
						if (this.ragCache.cache && event.currentFile && vaultAdapter) {
							const contentHash = await vaultAdapter.computeHash(event.currentFile);
							this.ragCache.cache.files[event.currentFile] = {
								resourceName: storeName, // Store name as reference (individual doc names not available)
								contentHash,
								lastIndexed: Date.now(),
							};
							// Track last indexed file for resume capability
							this.ragCache.cache.lastIndexedFile = event.currentFile;
						}
						// Incremental cache save for durability
						filesSinceLastSave = await this.ragCache.incrementAndMaybeSaveCache(filesSinceLastSave);
						this.indexingProgress = {
							current: (event.completedFiles || 0) + (event.skippedFiles || 0),
							total: event.totalFiles || 0,
						};
						this.callbacks.onNotifyListeners();
						progressCallback?.({
							current: (event.completedFiles || 0) + (event.skippedFiles || 0),
							total: event.totalFiles || 0,
							currentFile: event.currentFile,
							phase: 'indexing',
						});
						this.callbacks.onUpdateStatusBar();
					} else if (event.type === 'file_skipped') {
						result.skipped++;
						this.runningSkipped++;
						this.currentFile = event.currentFile;
						// Skipped files are already in cache (unchanged), ensure they're tracked
						if (
							this.ragCache.cache &&
							event.currentFile &&
							!this.ragCache.cache.files[event.currentFile] &&
							vaultAdapter
						) {
							const contentHash = await vaultAdapter.computeHash(event.currentFile);
							this.ragCache.cache.files[event.currentFile] = {
								resourceName: storeName,
								contentHash,
								lastIndexed: Date.now(),
							};
						}
						// Incremental cache save for durability (count skipped files too)
						filesSinceLastSave = await this.ragCache.incrementAndMaybeSaveCache(filesSinceLastSave);
						this.indexingProgress = {
							current: (event.completedFiles || 0) + (event.skippedFiles || 0),
							total: event.totalFiles || 0,
						};
						this.callbacks.onNotifyListeners();
						this.callbacks.onUpdateStatusBar();
					} else if (event.type === 'file_error') {
						result.failed++;
						this.runningFailed++;

						// Track failed file with error details
						if (event.currentFile) {
							const errorMessage =
								event.error instanceof Error ? event.error.message : String(event.error || 'Unknown error');
							this.failedFiles.push({
								path: event.currentFile,
								error: errorMessage,
								timestamp: Date.now(),
							});
						}

						this.callbacks.onNotifyListeners();

						// Re-throw rate limit errors to trigger cooldown
						if (event.error && this.rateLimiter.isRateLimitError(event.error)) {
							throw event.error;
						}
					} else if (event.type === 'complete') {
						this.currentFile = undefined;
						this.callbacks.onNotifyListeners();
						progressCallback?.({
							current: event.totalFiles || 0,
							total: event.totalFiles || 0,
							phase: 'complete',
							message: `Indexed ${result.indexed}, skipped ${result.skipped}, failed ${result.failed}`,
						});
					}
				},
			});

			// Save cache and update local state - clear resume flags on success
			if (this.ragCache.cache) {
				this.ragCache.cache.lastSync = Date.now();
				this.ragCache.cache.indexingInProgress = false;
				this.ragCache.cache.indexingStartedAt = undefined;
				this.ragCache.cache.lastIndexedFile = undefined;
				await this.ragCache.saveCache();
			}
			this.ragCache.refreshIndexedCount();
			this.callbacks.setStatus('idle');
			this.currentFile = undefined;
			this.indexingStartTime = undefined;
			this.rateLimiter.resetTracking(); // Success - reset rate limit counter
			this.callbacks.onUpdateStatusBar();
			this.callbacks.onNotifyListeners();
		} catch (error) {
			// Handle rate limit with auto-retry
			if (this.rateLimiter.isRateLimitError(error)) {
				// Fail fast on permanent quota exhaustion — retrying won't help
				if (isQuotaExhausted(error)) {
					this.plugin.logger.error('RAG Indexing: Permanent quota exhaustion detected, stopping');
					this.rateLimiter.resetTracking();
					this.callbacks.setStatus('error');
					this.currentFile = undefined;
					this.indexingStartTime = undefined;
					if (this.ragCache.cache) {
						this.ragCache.cache.indexingInProgress = false;
						this.ragCache.cache.indexingStartedAt = undefined;
						this.ragCache.cache.lastIndexedFile = undefined;
						await this.ragCache.saveCache();
					}
					this.callbacks.onUpdateStatusBar();
					this.callbacks.onNotifyListeners();
					new Notice(getErrorMessage(error), 8000);
					result.duration = Date.now() - startTime;
					return result;
				}

				// Check if we've exceeded max retries
				if (this.rateLimiter.consecutiveCount >= this.rateLimiter.maxRetries) {
					this.plugin.logger.error(`RAG Indexing: Max rate limit retries (${this.rateLimiter.maxRetries}) exceeded`);
					this.rateLimiter.resetTracking();
					this.callbacks.setStatus('error');
					this.currentFile = undefined;
					this.indexingStartTime = undefined;
					// Clear resume flags on explicit failure
					if (this.ragCache.cache) {
						this.ragCache.cache.indexingInProgress = false;
						this.ragCache.cache.indexingStartedAt = undefined;
						this.ragCache.cache.lastIndexedFile = undefined;
						await this.ragCache.saveCache();
					}
					this.callbacks.onUpdateStatusBar();
					this.callbacks.onNotifyListeners();
					result.duration = Date.now() - startTime;
					return result;
				}

				// Save progress before waiting
				if (this.ragCache.cache) {
					this.ragCache.cache.lastSync = Date.now();
					await this.ragCache.saveCache();
				}

				// Wait for cooldown (pass error so API-provided delay can be used)
				await this.rateLimiter.handleRateLimit(error);

				// Auto-retry - smart sync will skip already-indexed files
				this.callbacks.setStatus('indexing');
				this.callbacks.onUpdateStatusBar();
				this.callbacks.onNotifyListeners();

				// Recursive retry - return combined results
				const retryResult = await this._doIndexVault(progressCallback);
				result.indexed += retryResult.indexed;
				result.skipped += retryResult.skipped;
				result.failed += retryResult.failed;
				result.duration = Date.now() - startTime;
				return result;
			}

			this.callbacks.setStatus(this.cancelRequested ? 'idle' : 'error');
			this.currentFile = undefined;
			this.indexingStartTime = undefined;
			this.cancelRequested = false;

			// Clear resume flags on cancellation or error.
			if (this.ragCache.cache) {
				this.ragCache.cache.indexingInProgress = false;
				this.ragCache.cache.indexingStartedAt = undefined;
				this.ragCache.cache.lastIndexedFile = undefined;
				await this.ragCache.saveCache();
			}

			this.callbacks.onUpdateStatusBar();
			this.callbacks.onNotifyListeners();

			// Don't re-throw if cancelled, just return partial results
			if (error instanceof Error && error.message === 'Indexing cancelled by user') {
				this.plugin.logger.log('RAG Indexing: Cancelled by user');
				result.duration = Date.now() - startTime;
				return result;
			}
			throw error;
		}

		result.duration = Date.now() - startTime;
		return result;
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		this.cancelRequested = false;
		this.failedFiles = [];
		this.currentFile = undefined;
		this.indexingStartTime = undefined;
		this.runningIndexed = 0;
		this.runningSkipped = 0;
		this.runningFailed = 0;
		this.indexingProgress = { current: 0, total: 0 };
	}
}
