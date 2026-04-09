/**
 * Represents a file that has been indexed in the File Search Store
 */
export interface IndexedFileEntry {
	resourceName: string; // Gemini file resource name
	contentHash: string; // SHA-256 hash for reliable change detection
	lastIndexed: number; // Timestamp
}

/**
 * Cache structure for tracking indexed files
 */
export interface RagIndexCache {
	version: string;
	storeName: string;
	lastSync: number;
	files: Record<string, IndexedFileEntry>;
	// Resume capability fields
	indexingInProgress?: boolean; // True while indexing is active
	indexingStartedAt?: number; // Timestamp when current indexing started
	lastIndexedFile?: string; // Last successfully indexed file path
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
 * Represents a file that failed to index with error details
 */
export interface FailedFileEntry {
	path: string;
	error: string;
	timestamp: number;
}

/**
 * Pending file change for debouncing
 */
export interface PendingChange {
	type: 'create' | 'modify' | 'delete' | 'rename';
	path: string;
	oldPath?: string;
	timestamp: number;
}

/**
 * Status of the RAG indexing service
 */
export type RagIndexStatus = 'disabled' | 'idle' | 'indexing' | 'error' | 'paused' | 'rate_limited';

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

export const CACHE_VERSION = '1.0';
export const DEBOUNCE_MS = 2000;

/**
 * Number of files/changes to process before saving the cache incrementally.
 * Balances durability (lower = more frequent saves) vs performance (higher = fewer I/O ops).
 * Set to 10 to limit potential data loss to ~10 files if Obsidian crashes during indexing.
 */
export const CACHE_SAVE_INTERVAL = 10;

/**
 * Rate limit handling configuration
 */
export const RATE_LIMIT_BASE_DELAY_MS = 30000; // 30 seconds base delay
export const RATE_LIMIT_MAX_DELAY_MS = 300000; // 5 minutes max delay
export const RATE_LIMIT_MAX_RETRIES = 5; // Maximum retry attempts before failing
