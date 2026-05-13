import { normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { formatLocalTimestamp } from './format-utils';

/**
 * Writes log entries to a file in the plugin state folder.
 *
 * - Buffers entries and flushes on a debounced timer to minimize I/O
 * - Uses vault.adapter.write() to avoid triggering file event listeners
 * - Rotates the log file when it exceeds MAX_FILE_SIZE
 * - All file operations are fire-and-forget; failures never propagate
 */
export class FileLogWriter {
	private plugin: ObsidianGemini;
	private buffer: string[] = [];
	private flushTimer: number | null = null;
	private isFlushing = false;
	private currentFlushPromise: Promise<void> | null = null;

	private static readonly FLUSH_INTERVAL_MS = 1000;
	private static readonly MAX_FILE_SIZE = 1_048_576; // 1MB
	private static readonly LOG_FILENAME = 'debug.log';
	private static readonly OLD_LOG_FILENAME = 'debug.log.old';

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	private get logPath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/${FileLogWriter.LOG_FILENAME}`);
	}

	private get oldLogPath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/${FileLogWriter.OLD_LOG_FILENAME}`);
	}

	/**
	 * Buffer a log entry for writing. Synchronous — never blocks the caller.
	 * Checks the fileLogging setting so Logger doesn't need to.
	 */
	write(level: string, prefix: string, args: any[]): void {
		if (!this.plugin.settings?.fileLogging) return;

		const timestamp = formatLocalTimestamp();
		const message = this.formatArgs(args);
		this.buffer.push(`[${timestamp}] [${level}] ${prefix} ${message}`);
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			this.flush().catch((error) => {
				// Log to console only — never recurse through the Logger
				console.error('[Gemini Scribe] FileLogWriter flush error:', error);
			});
		}, FileLogWriter.FLUSH_INTERVAL_MS);
	}

	private async flush(): Promise<void> {
		if (this.isFlushing || this.buffer.length === 0) return;

		const adapter = this.plugin.app?.vault?.adapter;
		if (!adapter) return;

		this.isFlushing = true;
		const entries = this.buffer.splice(0);
		const newContent = entries.join('\n') + '\n';

		this.currentFlushPromise = (async () => {
			try {
				const path = this.logPath;
				let existing = '';
				let currentSize = 0;

				if (await adapter.exists(path)) {
					const stat = await adapter.stat(path);
					currentSize = stat?.size ?? 0;

					if (currentSize + newContent.length > FileLogWriter.MAX_FILE_SIZE) {
						await this.rotate();
						// After rotation the file is gone, start fresh
						existing = '';
					} else {
						existing = await adapter.read(path);
					}
				}

				await adapter.write(path, existing + newContent);
			} catch (error) {
				// Drop entries on failure to prevent unbounded buffer growth
				console.error('[Gemini Scribe] FileLogWriter write error:', error);
			} finally {
				this.isFlushing = false;
				this.currentFlushPromise = null;
			}
		})();

		await this.currentFlushPromise;
	}

	private async rotate(): Promise<void> {
		const adapter = this.plugin.app?.vault?.adapter;
		if (!adapter) return;

		try {
			const oldPath = this.oldLogPath;
			const currentPath = this.logPath;

			// Remove old log if it exists
			if (await adapter.exists(oldPath)) {
				await adapter.remove(oldPath);
			}

			// Rename current → old by copy + delete
			if (await adapter.exists(currentPath)) {
				const content = await adapter.read(currentPath);
				await adapter.write(oldPath, content);
				await adapter.remove(currentPath);
			}
		} catch (error) {
			console.error('[Gemini Scribe] FileLogWriter rotation error:', error);
		}
	}

	/**
	 * Flush remaining buffer and clean up. Call during plugin unload.
	 */
	async destroy(): Promise<void> {
		if (this.flushTimer) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		// Wait for any in-flight flush to complete
		if (this.currentFlushPromise) {
			await this.currentFlushPromise;
		}

		// Drain any remaining buffer entries
		if (this.buffer.length > 0) {
			await this.flush();
		}
	}

	private formatArgs(args: any[]): string {
		return args
			.map((arg) => {
				if (arg === null || arg === undefined) return String(arg);
				if (arg instanceof Error) return `${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
				if (typeof arg === 'object') {
					try {
						return JSON.stringify(arg);
					} catch {
						return String(arg);
					}
				}
				return String(arg);
			})
			.join(' ');
	}
}
