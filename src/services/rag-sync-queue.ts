import { TFile, Notice } from 'obsidian';
import type { FileUploader } from '@allenhutchison/gemini-utils';
import type ObsidianGemini from '../main';
import type { ObsidianVaultAdapter } from './obsidian-file-adapter';
import type { RagCache } from './rag-cache';
import type { RagRateLimiter } from './rag-rate-limiter';
import { DEBOUNCE_MS } from './rag-types';
import type { PendingChange, RagIndexStatus } from './rag-types';
import { getErrorMessage, isQuotaExhausted } from '../utils/error-utils';

/**
 * Callbacks for the sync queue to interact with the orchestrator.
 */
export interface SyncQueueCallbacks {
	getStatus: () => RagIndexStatus;
	setStatus: (status: RagIndexStatus) => void;
	isReady: () => boolean;
	getVaultAdapter: () => ObsidianVaultAdapter | null;
	getFileUploader: () => FileUploader | null;
	getStoreName: () => string | null;
	onUpdateStatusBar: () => void;
}

/**
 * Manages the queue of pending file changes and debounced processing
 * for the RAG indexing service.
 */
export class RagSyncQueue {
	private plugin: ObsidianGemini;
	private ragCache: RagCache;
	private rateLimiter: RagRateLimiter;
	private callbacks: SyncQueueCallbacks;
	private pendingChanges: Map<string, PendingChange> = new Map();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private isProcessing: boolean = false;

	constructor(plugin: ObsidianGemini, ragCache: RagCache, rateLimiter: RagRateLimiter, callbacks: SyncQueueCallbacks) {
		this.plugin = plugin;
		this.ragCache = ragCache;
		this.rateLimiter = rateLimiter;
		this.callbacks = callbacks;
	}

	/**
	 * Get the number of pending file changes awaiting sync
	 */
	getPendingCount(): number {
		return this.pendingChanges.size;
	}

	/**
	 * Check if the queue is currently processing changes
	 */
	getIsProcessing(): boolean {
		return this.isProcessing;
	}

	/**
	 * Get a reference to the pending changes map (for status reporting)
	 */
	getPendingChanges(): Map<string, PendingChange> {
		return this.pendingChanges;
	}

	// ==================== File Event Handlers ====================

	/**
	 * Handle file creation
	 */
	onFileCreate(file: TFile): void {
		if (!this.callbacks.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;
		if (!this.callbacks.getVaultAdapter()?.shouldIndex(file.path)) return;

		this.queueChange({
			type: 'create',
			path: file.path,
			timestamp: Date.now(),
		});
	}

	/**
	 * Handle file modification
	 */
	onFileModify(file: TFile): void {
		if (!this.callbacks.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;
		if (!this.callbacks.getVaultAdapter()?.shouldIndex(file.path)) return;

		this.queueChange({
			type: 'modify',
			path: file.path,
			timestamp: Date.now(),
		});
	}

	/**
	 * Handle file deletion
	 */
	onFileDelete(file: TFile): void {
		if (!this.callbacks.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;

		this.queueChange({
			type: 'delete',
			path: file.path,
			timestamp: Date.now(),
		});
	}

	/**
	 * Handle file rename
	 */
	onFileRename(file: TFile, oldPath: string): void {
		if (!this.callbacks.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;

		// Handle as delete old + create new
		this.queueChange({
			type: 'delete',
			path: oldPath,
			timestamp: Date.now(),
		});

		if (this.callbacks.getVaultAdapter()?.shouldIndex(file.path)) {
			this.queueChange({
				type: 'create',
				path: file.path,
				timestamp: Date.now(),
			});
		}
	}

	// ==================== Debouncing ====================

	/**
	 * Queue a file change for debounced processing
	 */
	private queueChange(change: PendingChange): void {
		// Collapse changes for the same path
		const existing = this.pendingChanges.get(change.path);

		if (existing) {
			// Collapse rules
			if (existing.type === 'create' && change.type === 'delete') {
				// Create + delete = no-op
				this.pendingChanges.delete(change.path);
			} else if (existing.type === 'create' && change.type === 'modify') {
				// Create + modify = create
				// Keep existing
			} else {
				// Use latest change
				this.pendingChanges.set(change.path, change);
			}
		} else {
			this.pendingChanges.set(change.path, change);
		}

		// Don't start debounce timer when paused - changes will be processed on resume
		if (this.callbacks.getStatus() === 'paused') {
			return;
		}

		// Reset debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(() => {
			this.flushPendingChanges().catch((error) => {
				this.plugin.logger.error('RAG Indexing: Error in debounced flush', error);
			});
		}, DEBOUNCE_MS);
	}

	/**
	 * Immediately process pending changes (bypass debounce)
	 * Returns true if sync was started, false if nothing to sync or already processing
	 */
	async syncPendingChanges(): Promise<boolean> {
		if (this.pendingChanges.size === 0) {
			return false;
		}
		if (this.isProcessing || this.callbacks.getStatus() === 'indexing') {
			return false;
		}

		// Clear debounce timer and process immediately
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		await this.flushPendingChanges();
		return true;
	}

	/**
	 * Process all pending changes
	 */
	async flushPendingChanges(): Promise<void> {
		if (this.isProcessing || this.pendingChanges.size === 0) return;

		const fileUploader = this.callbacks.getFileUploader();
		const vaultAdapter = this.callbacks.getVaultAdapter();
		if (!fileUploader || !vaultAdapter) return;

		const storeName = this.callbacks.getStoreName();
		if (!storeName) return;

		this.isProcessing = true;
		const changes = Array.from(this.pendingChanges.values());
		this.pendingChanges.clear();

		// Update status to show syncing activity
		this.callbacks.setStatus('indexing');
		this.callbacks.onUpdateStatusBar();

		// Track changes since last cache save for incremental durability
		let changesSinceLastSave = 0;
		let currentChangeIndex = 0;

		try {
			for (let i = 0; i < changes.length; i++) {
				currentChangeIndex = i;
				const change = changes[i];
				switch (change.type) {
					case 'create': {
						const file = this.plugin.app.vault.getAbstractFileByPath(change.path);
						if (file instanceof TFile && vaultAdapter.shouldIndex(file.path)) {
							const content = await vaultAdapter.readFileForUpload(file.path, file.path);
							if (content) {
								await fileUploader.uploadContent(content, storeName);
								// Update cache for new file
								if (this.ragCache.cache) {
									this.ragCache.cache.files[file.path] = {
										resourceName: storeName,
										contentHash: content.hash,
										lastIndexed: Date.now(),
									};
								}
								// Incremental cache save for durability
								changesSinceLastSave = await this.ragCache.incrementAndMaybeSaveCache(changesSinceLastSave);
							}
						}
						break;
					}
					case 'modify': {
						// Update existing file - don't increment indexedCount since file is already indexed
						const file = this.plugin.app.vault.getAbstractFileByPath(change.path);
						if (file instanceof TFile && vaultAdapter.shouldIndex(file.path)) {
							const content = await vaultAdapter.readFileForUpload(file.path, file.path);
							if (content) {
								await fileUploader.uploadContent(content, storeName);
								// Update cache with new hash
								if (this.ragCache.cache) {
									this.ragCache.cache.files[file.path] = {
										resourceName: storeName,
										contentHash: content.hash,
										lastIndexed: Date.now(),
									};
								}
								// Incremental cache save for durability
								changesSinceLastSave = await this.ragCache.incrementAndMaybeSaveCache(changesSinceLastSave);
							}
						}
						break;
					}
					case 'delete': {
						const cacheSaved = await this.deleteFile(change.path);
						if (cacheSaved) {
							changesSinceLastSave = 0;
						}
						break;
					}
				}
			}

			// Save cache and update count
			if (this.ragCache.cache) {
				this.ragCache.cache.lastSync = Date.now();
				await this.ragCache.saveCache();
			}
			this.ragCache.refreshIndexedCount();
			this.callbacks.setStatus('idle');
			this.rateLimiter.resetTracking(); // Success - reset rate limit counter
			this.callbacks.onUpdateStatusBar();
		} catch (error) {
			// Check for rate limit error
			if (this.rateLimiter.isRateLimitError(error)) {
				// Fail fast on permanent quota exhaustion — retrying won't help
				if (isQuotaExhausted(error)) {
					this.plugin.logger.error('RAG Indexing: Permanent quota exhaustion detected, stopping sync');
					this.rateLimiter.resetTracking();
					this.callbacks.setStatus('error');
					this.callbacks.onUpdateStatusBar();
					new Notice(getErrorMessage(error), 8000);
				} else {
					// Save progress before waiting
					if (this.ragCache.cache) {
						this.ragCache.cache.lastSync = Date.now();
						await this.ragCache.saveCache();
					}

					// Re-queue unprocessed changes for retry after cooldown
					for (let i = currentChangeIndex; i < changes.length; i++) {
						this.pendingChanges.set(changes[i].path, changes[i]);
					}

					// Wait for cooldown (pass error so API-provided delay can be used)
					await this.rateLimiter.handleRateLimit(error);

					this.callbacks.setStatus('idle');
					this.callbacks.onUpdateStatusBar();
				}
			} else {
				this.plugin.logger.error('RAG Indexing: Failed to process changes', error);
				this.callbacks.setStatus('error');
				this.callbacks.onUpdateStatusBar();
			}
		} finally {
			this.isProcessing = false;

			// If new changes arrived while processing, immediately process them
			if (this.pendingChanges.size > 0) {
				// Use void to indicate intentional fire-and-forget
				// Errors are already logged in the catch block above
				void this.flushPendingChanges();
			}
		}
	}

	/**
	 * Delete a file from the index.
	 *
	 * LIMITATION: This only removes the file from the local cache. The document
	 * remains in Google's File Search Store as an orphaned file.
	 *
	 * @returns true if the cache was saved, false if file wasn't in cache or save failed
	 */
	private async deleteFile(path: string): Promise<boolean> {
		if (!this.ragCache.cache?.files[path]) {
			return false;
		}

		try {
			// Remove from local cache only - document remains orphaned in cloud
			delete this.ragCache.cache.files[path];
			this.ragCache.indexedCount = Object.keys(this.ragCache.cache.files).length;
			await this.ragCache.saveCache();
			return true;
		} catch (error) {
			this.plugin.logger.error(`RAG Indexing: Failed to delete ${path}`, error);
			return false;
		}
	}

	/**
	 * Clear the debounce timer
	 */
	clearTimer(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		this.clearTimer();
		this.pendingChanges.clear();
		this.isProcessing = false;
	}
}
