import type { FailedFileEntry, IndexProgress } from './rag-types';

/** The processed/total pair of an indexing run, as the status bar reads it. */
export type IndexProgressCount = Pick<IndexProgress, 'current' | 'total'>;

/** A read-only copy of one indexing run's progress. */
export interface IndexRunProgressSnapshot {
	progress: IndexProgressCount;
	currentFile: string | undefined;
	startTime: number | undefined;
	indexed: number;
	skipped: number;
	failed: number;
	failedFiles: FailedFileEntry[];
}

/** A run's scalar progress without the failure list, for frequent progress updates. */
export type IndexRunProgressCounts = Omit<IndexRunProgressSnapshot, 'failedFiles'>;

/**
 * The progress of the current (or most recent) vault indexing run (#1703).
 *
 * One holder with named operations replaces the loose fields `RagVaultScanner`
 * used to keep, so adding a counter means touching this class and its
 * snapshot, and every reset policy is a named method instead of a hand-copied
 * list of assignments. Run *control* (the in-flight promise, cancellation)
 * stays on the scanner.
 *
 * A leaf module: it imports only types.
 */
export class IndexRunProgress {
	private progress: IndexProgressCount = { current: 0, total: 0 };
	private currentFile: string | undefined;
	private startTime: number | undefined;
	private indexed = 0;
	private skipped = 0;
	private failed = 0;
	private failedFiles: FailedFileEntry[] = [];

	/**
	 * Clear everything. Pass `startTime` when a run begins, to stamp it; omit it
	 * on teardown.
	 */
	reset(startTime?: number): void {
		this.progress = { current: 0, total: 0 };
		this.currentFile = undefined;
		this.startTime = startTime;
		this.indexed = 0;
		this.skipped = 0;
		this.failed = 0;
		this.failedFiles = [];
	}

	/**
	 * End the run without forgetting its totals: clears the current file and the
	 * start time, but keeps the counters and failed files so the status bar and
	 * the status modal can still report the finished run. This partial clear is
	 * deliberate; a full clear is `reset()`.
	 */
	finishRun(): void {
		this.currentFile = undefined;
		this.startTime = undefined;
	}

	/** Set the processed/total pair. */
	setProgress(progress: IndexProgressCount): void {
		this.progress = { current: progress.current, total: progress.total };
	}

	setCurrentFile(path: string | undefined): void {
		this.currentFile = path;
	}

	recordIndexed(path: string | undefined): void {
		this.indexed++;
		this.currentFile = path;
	}

	recordSkipped(path: string | undefined): void {
		this.skipped++;
		this.currentFile = path;
	}

	/** Count a failed file; `entry` is recorded when the uploader named the file. */
	recordFailure(entry?: FailedFileEntry): void {
		this.failed++;
		if (entry) this.failedFiles.push(entry);
	}

	getProgress(): IndexProgressCount {
		return this.progress;
	}

	/**
	 * The run's scalars without copying the failure list. Progress listeners
	 * fire on every file event, so copying a growing list there would be
	 * quadratic over a run with many failures.
	 */
	counts(): IndexRunProgressCounts {
		return {
			progress: { ...this.progress },
			currentFile: this.currentFile,
			startTime: this.startTime,
			indexed: this.indexed,
			skipped: this.skipped,
			failed: this.failed,
		};
	}

	snapshot(): IndexRunProgressSnapshot {
		return { ...this.counts(), failedFiles: [...this.failedFiles] };
	}
}
