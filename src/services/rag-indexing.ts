import { TFile, normalizePath, Notice } from 'obsidian';
import { GoogleGenAI } from '@google/genai';
import type ObsidianGemini from '../main';

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

const CACHE_VERSION = '1.0';
const DEBOUNCE_MS = 2000;

/**
 * Service for managing RAG indexing of vault files to Google's File Search API
 */
export class RagIndexingService {
	private plugin: ObsidianGemini;
	private ai: GoogleGenAI | null = null;
	private statusBarItem: HTMLElement | null = null;
	private cache: RagIndexCache | null = null;
	private pendingChanges: Map<string, PendingChange> = new Map();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private status: RagIndexStatus = 'disabled';
	private indexedCount: number = 0;
	private isProcessing: boolean = false;
	private indexingProgress: { current: number; total: number } = { current: 0, total: 0 };
	private _indexingPromise: Promise<IndexResult> | null = null;

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
				// Run indexing in background (don't await)
				this.indexVault((progress) => {
					this.updateStatusBar();
				}).then((result) => {
					new Notice(`RAG Indexing complete: ${result.indexed} files indexed`);
				}).catch((error) => {
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
		this.statusBarItem.addEventListener('click', () => {
			// TODO: Open status modal
			new Notice(`RAG Index: ${this.indexedCount} files indexed`);
		});
	}

	/**
	 * Update the status bar display
	 */
	private updateStatusBar(): void {
		if (!this.statusBarItem) return;

		this.statusBarItem.empty();

		switch (this.status) {
			case 'disabled':
				this.statusBarItem.style.display = 'none';
				break;
			case 'idle':
				this.statusBarItem.style.display = '';
				this.statusBarItem.setText(`RAG: ${this.indexedCount} files`);
				break;
			case 'indexing':
				this.statusBarItem.style.display = '';
				if (this.indexingProgress.total > 0) {
					const pct = Math.round((this.indexingProgress.current / this.indexingProgress.total) * 100);
					this.statusBarItem.setText(`RAG: ${pct}% (${this.indexingProgress.current}/${this.indexingProgress.total})`);
				} else {
					this.statusBarItem.setText('RAG: Indexing...');
				}
				break;
			case 'error':
				this.statusBarItem.style.display = '';
				this.statusBarItem.setText('RAG: Error');
				break;
			case 'paused':
				this.statusBarItem.style.display = '';
				this.statusBarItem.setText('RAG: Paused');
				break;
		}
	}

	// ==================== File Indexing ====================

	/**
	 * Compute a hash for change detection (mtime:size)
	 */
	private computeHash(file: TFile): string {
		return `${file.stat.mtime}:${file.stat.size}`;
	}

	/**
	 * Check if a file should be indexed
	 */
	private shouldIndexFile(file: TFile): boolean {
		// Only index markdown files for MVP
		if (file.extension !== 'md') return false;

		// Exclude system folders
		const path = file.path;
		if (path.startsWith('.obsidian/')) return false;
		if (path.startsWith(this.plugin.settings.historyFolder + '/')) return false;

		// Check user-configured exclude folders
		for (const folder of this.plugin.settings.ragIndexing.excludeFolders) {
			if (path.startsWith(folder + '/') || path === folder) return false;
		}

		return true;
	}

	/**
	 * Extract metadata from a file for indexing
	 */
	private extractMetadata(file: TFile): Array<{ key: string; stringValue: string }> {
		const metadata: Array<{ key: string; stringValue: string }> = [];

		// Add path
		metadata.push({ key: 'path', stringValue: file.path });

		// Add folder
		metadata.push({ key: 'folder', stringValue: file.parent?.path || '' });

		// Extract frontmatter
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		if (fm) {
			// Add tags
			if (Array.isArray(fm.tags)) {
				const tags = fm.tags.join(', ');
				if (tags.length <= 256) {
					metadata.push({ key: 'tags', stringValue: tags });
				} else {
					metadata.push({ key: 'tags', stringValue: tags.substring(0, 253) + '...' });
				}
			}

			// Add aliases
			if (Array.isArray(fm.aliases)) {
				const aliases = fm.aliases.join(', ');
				if (aliases.length <= 256) {
					metadata.push({ key: 'aliases', stringValue: aliases });
				} else {
					metadata.push({ key: 'aliases', stringValue: aliases.substring(0, 253) + '...' });
				}
			}
		}

		return metadata;
	}

	/**
	 * Upload a single file to the File Search Store with retry logic
	 */
	private async uploadFile(file: TFile, retryCount: number = 0): Promise<string | null> {
		const MAX_RETRIES = 3;
		const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

		if (!this.ai || !this.plugin.settings.ragIndexing.fileSearchStoreName) {
			return null;
		}

		try {
			const content = await this.plugin.app.vault.read(file);
			const metadata = this.extractMetadata(file);

			// Skip empty or very small files (less than 10 chars of content)
			if (!content || content.trim().length < 10) {
				this.plugin.logger.log(`RAG Indexing: Skipping empty/tiny file ${file.path}`);
				return null;
			}

			// Create a Blob from the content
			const blob = new Blob([content], { type: 'text/markdown' });

			// Upload to File Search Store
			let operation = await this.ai.fileSearchStores.uploadToFileSearchStore({
				fileSearchStoreName: this.plugin.settings.ragIndexing.fileSearchStoreName,
				file: blob,
				config: {
					displayName: file.path,
					customMetadata: metadata,
				},
			});

			// Poll for completion with exponential backoff
			let delay = 500;
			const maxDelay = 5000;
			const timeout = 60000;
			const startTime = Date.now();

			while (!operation.done) {
				if (Date.now() - startTime > timeout) {
					throw new Error('Upload operation timed out');
				}

				await new Promise(resolve => setTimeout(resolve, delay));
				operation = await this.ai!.operations.get({ operation });
				delay = Math.min(delay * 1.5, maxDelay);
			}

			// Return the operation name as the resource identifier
			// The operation name contains the document reference
			return operation.name || null;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Check if it's a retryable error (network issues, parsing errors, rate limits)
			const isRetryable =
				errorMessage.includes('Unexpected end of input') ||
				errorMessage.includes('SyntaxError') ||
				errorMessage.includes('network') ||
				errorMessage.includes('ECONNRESET') ||
				errorMessage.includes('429') ||
				errorMessage.includes('rate limit');

			if (isRetryable && retryCount < MAX_RETRIES) {
				const delay = RETRY_DELAYS[retryCount] || 4000;
				this.plugin.logger.log(`RAG Indexing: Retrying ${file.path} in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
				await new Promise(resolve => setTimeout(resolve, delay));
				return this.uploadFile(file, retryCount + 1);
			}

			this.plugin.logger.error(`RAG Indexing: Failed to upload ${file.path} after ${retryCount} retries`, error);
			return null;
		}
	}

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

		try {
			this.status = 'indexing';
			this.indexingProgress = { current: 0, total: 0 };
			this.updateStatusBar();

			// Get all markdown files
			const files = this.plugin.app.vault.getMarkdownFiles()
				.filter(f => this.shouldIndexFile(f));

			this.indexingProgress.total = files.length;

			progressCallback?.({
				current: 0,
				total: files.length,
				phase: 'scanning',
				message: `Found ${files.length} files to index`,
			});

			// Process files
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const hash = this.computeHash(file);

				// Update progress
				this.indexingProgress.current = i + 1;

				// Check if file needs indexing
				const existingEntry = this.cache?.files[file.path];
				if (existingEntry && existingEntry.contentHash === hash) {
					result.skipped++;
					this.updateStatusBar();
					continue;
				}

				progressCallback?.({
					current: i + 1,
					total: files.length,
					currentFile: file.path,
					phase: 'indexing',
				});

				this.updateStatusBar();

				// Upload file
				const resourceName = await this.uploadFile(file);
				if (resourceName) {
					// Update cache
					if (this.cache) {
						this.cache.files[file.path] = {
							resourceName,
							contentHash: hash,
							lastIndexed: Date.now(),
						};
					}
					result.indexed++;
				} else {
					result.failed++;
				}

				// Yield to event loop periodically
				if (i % 10 === 0) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}

			// Save cache
			if (this.cache) {
				this.cache.lastSync = Date.now();
				await this.saveCache();
			}

			this.indexedCount = Object.keys(this.cache?.files || {}).length;
			this.status = 'idle';
			this.updateStatusBar();

			progressCallback?.({
				current: files.length,
				total: files.length,
				phase: 'complete',
				message: `Indexed ${result.indexed} files, skipped ${result.skipped}, failed ${result.failed}`,
			});

		} catch (error) {
			this.status = 'error';
			this.updateStatusBar();
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
		if (!this.shouldIndexFile(file)) return;

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
		if (!this.shouldIndexFile(file)) return;

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

		if (this.shouldIndexFile(file)) {
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
			this.flushPendingChanges();
		}, DEBOUNCE_MS);
	}

	/**
	 * Process all pending changes
	 */
	private async flushPendingChanges(): Promise<void> {
		if (this.isProcessing || this.pendingChanges.size === 0) return;

		this.isProcessing = true;
		const changes = Array.from(this.pendingChanges.values());
		this.pendingChanges.clear();

		// Update status to show syncing activity
		const previousStatus = this.status;
		this.status = 'indexing';
		this.updateStatusBar();

		try {
			for (const change of changes) {
				switch (change.type) {
					case 'create':
					case 'modify': {
						const file = this.plugin.app.vault.getAbstractFileByPath(change.path);
						if (file instanceof TFile) {
							const resourceName = await this.uploadFile(file);
							if (resourceName && this.cache) {
								this.cache.files[file.path] = {
									resourceName,
									contentHash: this.computeHash(file),
									lastIndexed: Date.now(),
								};
							}
						}
						break;
					}
					case 'delete':
						await this.deleteFile(change.path);
						break;
				}
			}

			// Save cache
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
		}
	}
}
