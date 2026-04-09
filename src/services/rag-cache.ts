import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { CACHE_VERSION, CACHE_SAVE_INTERVAL } from './rag-types';
import type { RagIndexCache } from './rag-types';

/**
 * Manages the local cache of indexed files for the RAG indexing service.
 * Handles loading, saving, and incremental persistence of the cache.
 */
export class RagCache {
	private plugin: ObsidianGemini;
	private _cache: RagIndexCache | null = null;
	private _indexedCount: number = 0;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	get cache(): RagIndexCache | null {
		return this._cache;
	}

	set cache(value: RagIndexCache | null) {
		this._cache = value;
	}

	get indexedCount(): number {
		return this._indexedCount;
	}

	set indexedCount(value: number) {
		this._indexedCount = value;
	}

	/**
	 * Get the path to the index cache file
	 */
	get cachePath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/rag-index-cache.json`);
	}

	/**
	 * Load the index cache from disk
	 */
	async loadCache(): Promise<void> {
		try {
			let content: string | null = null;

			// Try to get file from metadata cache first
			const file = this.plugin.app.vault.getAbstractFileByPath(this.cachePath);
			if (file instanceof TFile) {
				content = await this.plugin.app.vault.read(file);
			} else {
				// File not in metadata cache - try reading directly from disk
				// This handles startup race conditions where file exists but isn't indexed yet
				const exists = await this.plugin.app.vault.adapter.exists(this.cachePath);
				if (exists) {
					this.plugin.logger.debug(
						'RAG Indexing: Cache file exists on disk but not in metadata cache, using adapter.read'
					);
					content = await this.plugin.app.vault.adapter.read(this.cachePath);
				}
			}

			if (content) {
				const parsed = JSON.parse(content);

				// Validate cache version - reset if mismatched
				if (parsed?.version !== CACHE_VERSION) {
					this.plugin.logger.warn(
						`RAG Indexing: Cache version mismatch (got ${parsed?.version}, expected ${CACHE_VERSION}), resetting cache`
					);
					this._cache = {
						version: CACHE_VERSION,
						storeName: parsed?.storeName || '',
						lastSync: 0,
						files: {},
					};
				} else {
					this._cache = parsed;
				}

				// Count indexed files
				if (this._cache?.files) {
					this._indexedCount = Object.keys(this._cache.files).length;
				}

				this.plugin.logger.log(`RAG Indexing: Loaded cache with ${this._indexedCount} files`);
			} else {
				// Initialize empty cache - no file exists
				this._cache = {
					version: CACHE_VERSION,
					storeName: '',
					lastSync: 0,
					files: {},
				};
			}
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to load cache', error);
			this._cache = {
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
	async saveCache(): Promise<void> {
		if (!this._cache) return;

		try {
			const content = JSON.stringify(this._cache, null, 2);
			const file = this.plugin.app.vault.getAbstractFileByPath(this.cachePath);

			if (file instanceof TFile) {
				await this.plugin.app.vault.modify(file, content);
			} else {
				try {
					await this.plugin.app.vault.create(this.cachePath, content);
				} catch (createError) {
					// Handle race condition where file exists on disk but not in metadata cache
					// This can happen on Linux or during startup
					const errorMessage = createError instanceof Error ? createError.message : String(createError);
					if (errorMessage.includes('File already exists')) {
						// Fall back to direct adapter write
						this.plugin.logger.debug(`RAG Indexing: Cache file exists but not in metadata cache, using adapter.write`, {
							path: this.cachePath,
							error: errorMessage,
						});
						await this.plugin.app.vault.adapter.write(this.cachePath, content);
					} else {
						throw createError;
					}
				}
			}
		} catch (error) {
			this.plugin.logger.error('RAG Indexing: Failed to save cache', error);
		}
	}

	/**
	 * Increment counter and save cache if threshold reached.
	 * Returns the new counter value (reset to 0 after save, otherwise incremented).
	 */
	async incrementAndMaybeSaveCache(counter: number): Promise<number> {
		counter++;
		if (this._cache && counter >= CACHE_SAVE_INTERVAL) {
			this._cache.lastSync = Date.now();
			await this.saveCache();
			return 0;
		}
		return counter;
	}

	/**
	 * Refresh the indexed count from the cache
	 */
	refreshIndexedCount(): void {
		this._indexedCount = Object.keys(this._cache?.files || {}).length;
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		this._cache = null;
		this._indexedCount = 0;
	}
}
