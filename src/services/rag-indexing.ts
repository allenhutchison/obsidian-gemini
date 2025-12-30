import { TFile, normalizePath, Notice, setIcon, setTooltip } from 'obsidian';
import { GoogleGenAI } from '@google/genai';
import { FileUploader } from '@allenhutchison/gemini-utils';
import type ObsidianGemini from '../main';
import { ObsidianVaultAdapter } from './obsidian-file-adapter';

/**
 * Represents a file that has been indexed in the File Search Store
 */
export interface IndexedFileEntry {
	resourceName: string;  // Gemini file resource name
	contentHash: string;   // mtime:size for fast change detection
	lastIndexed: number;   // Timestamp
}

/**
 * Cache structure for tracking indexed files
 */
export interface RagIndexCache {
	version: string;
	storeName: string;
	lastSync: number;
	files: Record<string, IndexedFileEntry>;
}

/**
 * Progress information for indexing operations
 */
export interface IndexProgress {
	current: number;
	total: number;
	currentFile?: string;
	phase: 'scanning' | 'indexing' | 'complete' | 'error';
	message?: string;
}

/**
 * Result of an indexing operation
 */
export interface IndexResult {
	indexed: number;
	skipped: number;
	failed: number;
	duration: number;
}

/**
 * Pending file change for debouncing
 */
interface PendingChange {
	type: 'create' | 'modify' | 'delete' | 'rename';
	path: string;
	oldPath?: string;
	timestamp: number;
}

/**
 * Status of the RAG indexing service
 */
export type RagIndexStatus = 'disabled' | 'idle' | 'indexing' | 'error' | 'paused';

/**
 * Extended progress information for live UI updates
 */
export interface RagProgressInfo {
	status: RagIndexStatus;
	indexedCount: number;
	skippedCount: number;
	failedCount: number;
	totalCount: number;
	currentFile?: string;
	startTime?: number;
	storeName: string | null;
	lastSync: number | null;
}

/**
 * Callback for progress updates
 */
export type ProgressListener = (progress: RagProgressInfo) => void;

const CACHE_VERSION = '1.0';
const DEBOUNCE_MS = 2000;
const CACHE_SAVE_INTERVAL = 10; // Save cache every N files for durability

/**
 * Service for managing RAG indexing of vault files to Google's File Search API
 */
export class RagIndexingService {
	private plugin: ObsidianGemini;
	private ai: GoogleGenAI | null = null;
	private fileUploader: FileUploader | null = null;
	private vaultAdapter: ObsidianVaultAdapter | null = null;
	private statusBarItem: HTMLElement | null = null;
	private cache: RagIndexCache | null = null;
	private pendingChanges: Map<string, PendingChange> = new Map();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private status: RagIndexStatus = 'disabled';
	private indexedCount: number = 0;
	private isProcessing: boolean = false;
	private indexingProgress: { current: number; total: number } = { current: 0, total: 0 };
	private _indexingPromise: Promise<IndexResult> | null = null;

	// Extended progress tracking
	private progressListeners: Set<ProgressListener> = new Set();
	private currentFile?: string;
	private indexingStartTime?: number;
	private runningIndexed: number = 0;
	private runningSkipped: number = 0;
	private runningFailed: number = 0;
	private cancelRequested: boolean = false;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	/**
	 * Get the path to the index cache file
	 */
	private get cachePath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/rag-index-cache.json`);
	}

	/**
	 * Initialize the RAG indexing service
	 */
	async initialize(): Promise<void> {
		if (!this.plugin.settings.ragIndexing.enabled) {
			this.status = 'disabled';
			return;
		}

		if (!this.plugin.settings.apiKey) {
			this.plugin.logger.warn('RAG Indexing: No API key configured');
			this.status = 'error';
			return;
		}

		try {
			// Initialize Google GenAI client
			this.ai = new GoogleGenAI({ apiKey: this.plugin.settings.apiKey });

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
			await this.loadCache();

			// Create or verify File Search Store
			await this.ensureFileSearchStore();

			// Setup status bar
			this.setupStatusBar();

			// Update status
			this.status = 'idle';
			this.updateStatusBar();

			this.plugin.logger.log('RAG Indexing: Initialized successfully');

			// If this is first time (no indexed files), start initial indexing
			if (this.indexedCount === 0) {
				new Notice('RAG Indexing: Starting initial vault indexing...');

				// Open progress modal for initial indexing
				import('../ui/rag-progress-modal').then(({ RagProgressModal }) => {
					const progressModal = new RagProgressModal(
						this.plugin.app,
						this,
						(result) => {
							new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
						}
					);
					progressModal.open();
				});

				// Run indexing in background (don't await - modal handles display)
				this.indexVault().catch((error) => {
					this.plugin.logger.error('RAG Indexing: Initial indexing failed', error);
					new Notice(`RAG Indexing failed: ${error.message}`);
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
		if (this._indexingPromise) {
			try {
				await this._indexingPromise;
			} catch (error) {
				this.plugin.logger.error('RAG Indexing: Error while waiting for indexing during destroy', error);
			}
		}

		// Wait for any in-flight change processing
		while (this.isProcessing) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}

		// Clear pending changes
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.pendingChanges.clear();

		// Remove status bar
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}

		this.ai = null;
		this.fileUploader = null;
		this.vaultAdapter = null;
		this.cache = null;
		this.status = 'disabled';
	}

	/**
	 * Get current status
	 */
	getStatus(): RagIndexStatus {
		return this.status;
	}

	/**
	 * Get the File Search Store name
	 */
	getStoreName(): string | null {
		return this.plugin.settings.ragIndexing.fileSearchStoreName;
	}

	/**
	 * Check if the service is enabled and ready
	 */
	isReady(): boolean {
		return this.status !== 'disabled' && this.status !== 'error' && this.ai !== null;
	}

	/**
	 * Get the number of indexed files
	 */
	getIndexedFileCount(): number {
		return this.indexedCount;
	}

	/**
	 * Get full status info for display in modal
	 */
	getStatusInfo(): {
		status: RagIndexStatus;
		indexedCount: number;
		storeName: string | null;
		lastSync: number | null;
		progress?: { current: number; total: number };
	} {
		return {
			status: this.status,
			indexedCount: this.indexedCount,
			storeName: this.plugin.settings.ragIndexing.fileSearchStoreName,
			lastSync: this.cache?.lastSync || null,
			progress: this.status === 'indexing' ? this.indexingProgress : undefined,
		};
	}

	/**
	 * Get extended progress info for live UI updates
	 */
	getProgressInfo(): RagProgressInfo {
		return {
			status: this.status,
			indexedCount: this.runningIndexed,
			skippedCount: this.runningSkipped,
			failedCount: this.runningFailed,
			totalCount: this.indexingProgress.total,
			currentFile: this.currentFile,
			startTime: this.indexingStartTime,
			storeName: this.plugin.settings.ragIndexing.fileSearchStoreName,
			lastSync: this.cache?.lastSync || null,
		};
	}

	/**
	 * Register a listener for progress updates
	 */
	addProgressListener(listener: ProgressListener): void {
		this.progressListeners.add(listener);
	}

	/**
	 * Remove a progress listener
	 */
	removeProgressListener(listener: ProgressListener): void {
		this.progressListeners.delete(listener);
	}

	/**
	 * Notify all progress listeners
	 */
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

	/**
	 * Request cancellation of the current indexing operation
	 */
	cancelIndexing(): void {
		if (this.status !== 'indexing') return;
		this.cancelRequested = true;
		this.plugin.logger.log('RAG Indexing: Cancellation requested');
	}

	/**
	 * Check if indexing is in progress
	 */
	isIndexing(): boolean {
		return this.status === 'indexing';
	}

	// ==================== Cache Management ====================

	/**
	 * Load the index cache from disk
	 */
	private async loadCache(): Promise<void> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(this.cachePath);
			if (file instanceof TFile) {
				const content = await this.plugin.app.vault.read(file);
				const parsed = JSON.parse(content);

				// Validate cache version - reset if mismatched
				if (parsed?.version !== CACHE_VERSION) {
					this.plugin.logger.warn(`RAG Indexing: Cache version mismatch (got ${parsed?.version}, expected ${CACHE_VERSION}), resetting cache`);
					this.cache = {
						version: CACHE_VERSION,
						storeName: parsed?.storeName || '',
						lastSync: 0,
						files: {},
					};
				} else {
					this.cache = parsed;
				}

				// Count indexed files
				if (this.cache?.files) {
					this.indexedCount = Object.keys(this.cache.files).length;
				}

				this.plugin.logger.log(`RAG Indexing: Loaded cache with ${this.indexedCount} files`);
			} else {
				// Initialize empty cache
				this.cache = {
					version: CACHE_VERSION,
					storeName: '',
					lastSync: 0,
					files: {},
				};
			}
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to load cache', error);
			this.cache = {
				version: CACHE_VERSION,
				storeName: '',
				lastSync: 0,
				files: {},
			};
		}
	}

	/**
	 * Save the index cache to disk
	 */
	private async saveCache(): Promise<void> {
		if (!this.cache) return;

		try {
			const content = JSON.stringify(this.cache, null, 2);
			const file = this.plugin.app.vault.getAbstractFileByPath(this.cachePath);

			if (file instanceof TFile) {
				await this.plugin.app.vault.modify(file, content);
			} else {
				await this.plugin.app.vault.create(this.cachePath, content);
			}
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to save cache', error);
		}
	}

	// ==================== File Search Store Management ====================

	/**
	 * Ensure the File Search Store exists, creating if necessary
	 */
	private async ensureFileSearchStore(): Promise<void> {
		if (!this.ai) return;

		const existingStoreName = this.plugin.settings.ragIndexing.fileSearchStoreName;

		if (existingStoreName) {
			// Verify the store still exists
			try {
				await this.ai.fileSearchStores.get({ name: existingStoreName });
				this.plugin.logger.log(`RAG Indexing: Using existing store ${existingStoreName}`);
				return;
			} catch (error) {
				// Check if it's a 404/not found error vs other errors
				const errorMessage = error instanceof Error ? error.message : String(error);
				const isNotFound = errorMessage.includes('404') ||
					errorMessage.includes('not found') ||
					errorMessage.includes('NOT_FOUND');

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

			const store = await this.ai.fileSearchStores.create({
				config: { displayName },
			});

			// Save the store name to settings
			this.plugin.settings.ragIndexing.fileSearchStoreName = store.name ?? null;
			await this.plugin.saveData(this.plugin.settings);

			// Update cache
			if (this.cache) {
				this.cache.storeName = store.name ?? '';
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
		if (!this.ai) return;

		const storeName = this.plugin.settings.ragIndexing.fileSearchStoreName;
		if (!storeName) return;

		try {
			await this.ai.fileSearchStores.delete({
				name: storeName,
				config: { force: true },
			});

			// Clear settings and cache
			this.plugin.settings.ragIndexing.fileSearchStoreName = null;
			await this.plugin.saveData(this.plugin.settings);

			// Delete cache file
			const file = this.plugin.app.vault.getAbstractFileByPath(this.cachePath);
			if (file instanceof TFile) {
				await this.plugin.app.vault.delete(file);
			}

			this.cache = null;
			this.indexedCount = 0;

			this.plugin.logger.log('RAG Indexing: Deleted store and cache');
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to delete store', error);
			throw error;
		}
	}

	// ==================== Status Bar ====================

	/**
	 * Setup the status bar indicator
	 */
	private setupStatusBar(): void {
		if (this.statusBarItem) return;

		this.statusBarItem = this.plugin.addStatusBarItem();
		this.statusBarItem.addClass('rag-status-bar');

		// Create icon container
		const iconEl = this.statusBarItem.createSpan({ cls: 'rag-status-icon' });
		setIcon(iconEl, 'database');

		// Create text element for file count
		this.statusBarItem.createSpan({ cls: 'rag-status-text' });

		this.statusBarItem.addEventListener('click', async () => {
			// Show progress modal if indexing, otherwise show status modal
			if (this.status === 'indexing') {
				const { RagProgressModal } = await import('../ui/rag-progress-modal');
				const modal = new RagProgressModal(
					this.plugin.app,
					this,
					(result) => {
						new Notice(`RAG Indexing: ${result.indexed} indexed, ${result.skipped} unchanged`);
					}
				);
				modal.open();
			} else {
				const { RagStatusModal } = await import('../ui/rag-status-modal');
				const modal = new RagStatusModal(
					this.plugin.app,
					this.getStatusInfo(),
					() => {
						// Open settings to RAG section
						// @ts-expect-error - Obsidian's setting API
						this.plugin.app.setting.open();
						// @ts-expect-error - Obsidian's setting API
						this.plugin.app.setting.openTabById('gemini-scribe');
					},
					async () => {
						// Open progress modal and start reindexing
						const { RagProgressModal } = await import('../ui/rag-progress-modal');
						const progressModal = new RagProgressModal(
							this.plugin.app,
							this,
							(result) => {
								new Notice(`RAG Indexing complete: ${result.indexed} indexed, ${result.skipped} unchanged`);
							}
						);
						progressModal.open();

						// Trigger reindex (don't await - modal handles progress)
						this.indexVault().catch((error) => {
							new Notice(`RAG Indexing failed: ${error.message}`);
						});
					}
				);
				modal.open();
			}
		});
	}

	/**
	 * Update the status bar display
	 */
	private updateStatusBar(): void {
		if (!this.statusBarItem) return;

		const iconEl = this.statusBarItem.querySelector('.rag-status-icon') as HTMLElement;
		const textEl = this.statusBarItem.querySelector('.rag-status-text') as HTMLElement;

		if (!iconEl || !textEl) return;

		// Remove animation class by default
		this.statusBarItem.removeClass('rag-indexing');

		let tooltip = '';

		switch (this.status) {
			case 'disabled':
				this.statusBarItem.style.display = 'none';
				break;
			case 'idle':
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'database');
				textEl.setText(`${this.indexedCount}`);
				tooltip = `RAG Index: ${this.indexedCount} files indexed`;
				break;
			case 'indexing':
				this.statusBarItem.style.display = '';
				this.statusBarItem.addClass('rag-indexing');
				setIcon(iconEl, 'upload-cloud');
				if (this.indexingProgress.total > 0) {
					const pct = Math.round((this.indexingProgress.current / this.indexingProgress.total) * 100);
					textEl.setText(`${pct}%`);
					tooltip = `RAG Index: Uploading ${this.indexingProgress.current}/${this.indexingProgress.total}...`;
				} else {
					textEl.setText('...');
					tooltip = 'RAG Index: Indexing...';
				}
				break;
			case 'error':
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'alert-triangle');
				textEl.setText('');
				tooltip = 'RAG Index: Error - click for details';
				break;
			case 'paused':
				this.statusBarItem.style.display = '';
				setIcon(iconEl, 'pause-circle');
				textEl.setText('');
				tooltip = 'RAG Index: Paused';
				break;
		}

		if (tooltip) {
			setTooltip(this.statusBarItem, tooltip, { placement: 'top' });
		}
	}

	// ==================== File Indexing ====================

	/**
	 * Delete a file from the index
	 *
	 * LIMITATION: This only removes the file from the local cache. The document
	 * remains in Google's File Search Store as an orphaned file. This is a known
	 * limitation - the File Search API doesn't provide a direct way to delete
	 * individual documents from a store. The only way to fully clean up is to
	 * delete and recreate the entire store.
	 *
	 * Impact: Deleted vault files will remain searchable until the store is recreated.
	 * Workaround: Users can delete the store via settings when disabling RAG indexing.
	 *
	 * TODO: Investigate if Google adds document deletion API in the future.
	 * See: https://github.com/allenhutchison/obsidian-gemini/issues/247
	 */
	private async deleteFile(path: string): Promise<void> {
		if (!this.ai || !this.cache?.files[path]) {
			return;
		}

		try {
			// Remove from local cache only - document remains orphaned in cloud
			delete this.cache.files[path];
			this.indexedCount = Object.keys(this.cache.files).length;
			await this.saveCache();
		} catch (error) {
			this.plugin.logger.error(`RAG Indexing: Failed to delete ${path}`, error);
		}
	}

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

		if (!this.isReady()) {
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

		if (!this.fileUploader || !this.vaultAdapter) {
			throw new Error('RAG Indexing service not properly initialized');
		}

		const storeName = this.plugin.settings.ragIndexing.fileSearchStoreName;
		if (!storeName) {
			throw new Error('No File Search Store configured');
		}

		try {
			// Reset progress tracking
			this.status = 'indexing';
			this.indexingProgress = { current: 0, total: 0 };
			this.indexingStartTime = startTime;
			this.runningIndexed = 0;
			this.runningSkipped = 0;
			this.runningFailed = 0;
			this.currentFile = undefined;
			this.cancelRequested = false;
			this.updateStatusBar();
			this.notifyProgressListeners();

			// Track files since last cache save for incremental durability
			let filesSinceLastSave = 0;

			// Use FileUploader with adapter - handles smart sync and parallel uploads
			await this.fileUploader.uploadWithAdapter(
				this.vaultAdapter,
				'', // basePath - adapter handles this
				storeName,
				{
					smartSync: true,
					parallel: { maxConcurrent: 5 },
					logger: {
						debug: (msg, ...args) => this.plugin.logger.debug(msg, ...args),
						error: (msg, ...args) => this.plugin.logger.error(msg, ...args),
					},
					onProgress: async (event) => {
						// Check for cancellation
						if (this.cancelRequested) {
							throw new Error('Indexing cancelled by user');
						}

						// Map gemini-utils progress events to our format
						if (event.type === 'start') {
							this.indexingProgress = { current: 0, total: event.totalFiles || 0 };
							this.notifyProgressListeners();
							progressCallback?.({
								current: 0,
								total: event.totalFiles || 0,
								phase: 'scanning',
								message: `Found ${event.totalFiles} files to index`,
							});
						} else if (event.type === 'file_start') {
							this.currentFile = event.currentFile;
							this.notifyProgressListeners();
						} else if (event.type === 'file_complete') {
							result.indexed++;
							this.runningIndexed++;
							this.currentFile = event.currentFile;
							// Update cache for newly indexed file
							if (this.cache && event.currentFile && this.vaultAdapter) {
								const contentHash = await this.vaultAdapter.computeHash(event.currentFile);
								this.cache.files[event.currentFile] = {
									resourceName: storeName, // Store name as reference (individual doc names not available)
									contentHash,
									lastIndexed: Date.now(),
								};
								// Incremental cache save for durability
								filesSinceLastSave++;
								if (filesSinceLastSave >= CACHE_SAVE_INTERVAL) {
									this.cache.lastSync = Date.now();
									await this.saveCache();
									filesSinceLastSave = 0;
								}
							}
							this.indexingProgress = {
								current: (event.completedFiles || 0) + (event.skippedFiles || 0),
								total: event.totalFiles || 0,
							};
							this.notifyProgressListeners();
							progressCallback?.({
								current: (event.completedFiles || 0) + (event.skippedFiles || 0),
								total: event.totalFiles || 0,
								currentFile: event.currentFile,
								phase: 'indexing',
							});
							this.updateStatusBar();
						} else if (event.type === 'file_skipped') {
							result.skipped++;
							this.runningSkipped++;
							this.currentFile = event.currentFile;
							// Skipped files are already in cache (unchanged), ensure they're tracked
							if (this.cache && event.currentFile && !this.cache.files[event.currentFile] && this.vaultAdapter) {
								const contentHash = await this.vaultAdapter.computeHash(event.currentFile);
								this.cache.files[event.currentFile] = {
									resourceName: storeName,
									contentHash,
									lastIndexed: Date.now(),
								};
							}
							// Incremental cache save for durability (count skipped files too)
							filesSinceLastSave++;
							if (this.cache && filesSinceLastSave >= CACHE_SAVE_INTERVAL) {
								this.cache.lastSync = Date.now();
								await this.saveCache();
								filesSinceLastSave = 0;
							}
							this.indexingProgress = {
								current: (event.completedFiles || 0) + (event.skippedFiles || 0),
								total: event.totalFiles || 0,
							};
							this.notifyProgressListeners();
							this.updateStatusBar();
						} else if (event.type === 'file_error') {
							result.failed++;
							this.runningFailed++;
							this.notifyProgressListeners();
						} else if (event.type === 'complete') {
							this.currentFile = undefined;
							this.notifyProgressListeners();
							progressCallback?.({
								current: event.totalFiles || 0,
								total: event.totalFiles || 0,
								phase: 'complete',
								message: `Indexed ${result.indexed}, skipped ${result.skipped}, failed ${result.failed}`,
							});
						}
					},
				}
			);

			// Save cache and update local state
			if (this.cache) {
				this.cache.lastSync = Date.now();
				await this.saveCache();
			}
			this.indexedCount = Object.keys(this.cache?.files || {}).length;
			this.status = 'idle';
			this.currentFile = undefined;
			this.indexingStartTime = undefined;
			this.updateStatusBar();
			this.notifyProgressListeners();

		} catch (error) {
			this.status = this.cancelRequested ? 'idle' : 'error';
			this.currentFile = undefined;
			this.indexingStartTime = undefined;
			this.cancelRequested = false;
			this.updateStatusBar();
			this.notifyProgressListeners();

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

	// ==================== File Event Handlers ====================

	/**
	 * Handle file creation
	 */
	onFileCreate(file: TFile): void {
		if (!this.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;
		if (!this.vaultAdapter?.shouldIndex(file.path)) return;

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
		if (!this.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;
		if (!this.vaultAdapter?.shouldIndex(file.path)) return;

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
		if (!this.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;

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
		if (!this.isReady() || !this.plugin.settings.ragIndexing.autoSync) return;

		// Handle as delete old + create new
		this.queueChange({
			type: 'delete',
			path: oldPath,
			timestamp: Date.now(),
		});

		if (this.vaultAdapter?.shouldIndex(file.path)) {
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
	 * Process all pending changes
	 */
	private async flushPendingChanges(): Promise<void> {
		if (this.isProcessing || this.pendingChanges.size === 0) return;
		if (!this.fileUploader || !this.vaultAdapter) return;

		const storeName = this.plugin.settings.ragIndexing.fileSearchStoreName;
		if (!storeName) return;

		this.isProcessing = true;
		const changes = Array.from(this.pendingChanges.values());
		this.pendingChanges.clear();

		// Update status to show syncing activity
		this.status = 'indexing';
		this.updateStatusBar();

		// Track changes since last cache save for incremental durability
		let changesSinceLastSave = 0;

		try {
			for (const change of changes) {
				switch (change.type) {
					case 'create': {
						const file = this.plugin.app.vault.getAbstractFileByPath(change.path);
						if (file instanceof TFile && this.vaultAdapter.shouldIndex(file.path)) {
							const content = await this.vaultAdapter.readFileForUpload(file.path, file.path);
							if (content) {
								await this.fileUploader.uploadContent(content, storeName);
								// Update cache for new file
								if (this.cache) {
									this.cache.files[file.path] = {
										resourceName: storeName,
										contentHash: content.hash,
										lastIndexed: Date.now(),
									};
									// Incremental cache save for durability
									changesSinceLastSave++;
									if (changesSinceLastSave >= CACHE_SAVE_INTERVAL) {
										this.cache.lastSync = Date.now();
										await this.saveCache();
										changesSinceLastSave = 0;
									}
								}
							}
						}
						break;
					}
					case 'modify': {
						// Update existing file - don't increment indexedCount since file is already indexed
						const file = this.plugin.app.vault.getAbstractFileByPath(change.path);
						if (file instanceof TFile && this.vaultAdapter.shouldIndex(file.path)) {
							const content = await this.vaultAdapter.readFileForUpload(file.path, file.path);
							if (content) {
								await this.fileUploader.uploadContent(content, storeName);
								// Update cache with new hash
								if (this.cache) {
									this.cache.files[file.path] = {
										resourceName: storeName,
										contentHash: content.hash,
										lastIndexed: Date.now(),
									};
									// Incremental cache save for durability
									changesSinceLastSave++;
									if (changesSinceLastSave >= CACHE_SAVE_INTERVAL) {
										this.cache.lastSync = Date.now();
										await this.saveCache();
										changesSinceLastSave = 0;
									}
								}
							}
						}
						break;
					}
					case 'delete':
						await this.deleteFile(change.path);
						break;
				}
			}

			// Save cache and update count
			if (this.cache) {
				this.cache.lastSync = Date.now();
				await this.saveCache();
			}
			this.indexedCount = Object.keys(this.cache?.files || {}).length;
			this.status = 'idle';
			this.updateStatusBar();
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to process changes', error);
			this.status = 'error';
			this.updateStatusBar();
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
}
