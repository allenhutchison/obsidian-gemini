import { ToolCall } from './types';

/**
 * Tracks tool execution history to detect and prevent loops
 */
export class ToolLoopDetector {
	private executionHistory: Map<string, ToolExecutionRecord[]> = new Map();
	private readonly maxHistorySize = 100;
	private loopThreshold: number;
	private timeWindowMs: number;

	constructor(loopThreshold: number = 3, timeWindowSeconds: number = 30) {
		this.loopThreshold = loopThreshold;
		this.timeWindowMs = timeWindowSeconds * 1000;
	}

	/**
	 * Update configuration
	 */
	updateConfig(loopThreshold: number, timeWindowSeconds: number) {
		this.loopThreshold = loopThreshold;
		this.timeWindowMs = timeWindowSeconds * 1000;
	}

	/**
	 * Record a tool execution
	 */
	recordExecution(sessionId: string, toolCall: ToolCall) {
		const key = this.getToolCallKey(toolCall);
		const timestamp = Date.now();

		if (!this.executionHistory.has(sessionId)) {
			this.executionHistory.set(sessionId, []);
		}

		const history = this.executionHistory.get(sessionId)!;
		history.push({ key, timestamp });

		// Keep history size manageable
		if (history.length > this.maxHistorySize) {
			history.shift();
		}

		// Clean up old entries
		this.cleanupOldEntries(sessionId);
	}

	/**
	 * Check if executing this tool call would create a loop
	 */
	isLoopDetected(sessionId: string, toolCall: ToolCall): boolean {
		return this.getRecentIdenticalCalls(sessionId, toolCall).length >= this.loopThreshold;
	}

	/**
	 * Get loop detection info for a tool call
	 */
	getLoopInfo(sessionId: string, toolCall: ToolCall): LoopDetectionInfo {
		const recentIdenticalCalls = this.getRecentIdenticalCalls(sessionId, toolCall);

		return {
			isLoop: recentIdenticalCalls.length >= this.loopThreshold,
			identicalCallCount: recentIdenticalCalls.length,
			timeWindowMs: this.timeWindowMs,
			lastCallTimestamp: recentIdenticalCalls[recentIdenticalCalls.length - 1]?.timestamp,
		};
	}

	/**
	 * Clear history for a session
	 */
	clearSession(sessionId: string) {
		this.executionHistory.delete(sessionId);
	}

	/**
	 * Records for this session matching the tool call, within the time window.
	 *
	 * The `isLoop` decision and the `identicalCallCount` reported alongside it are
	 * the same count, so both entry points read it from here rather than each
	 * repeating the key/history/window filter.
	 */
	private getRecentIdenticalCalls(sessionId: string, toolCall: ToolCall): ToolExecutionRecord[] {
		const key = this.getToolCallKey(toolCall);
		const history = this.executionHistory.get(sessionId) || [];
		const now = Date.now();

		return history.filter((record) => record.key === key && now - record.timestamp < this.timeWindowMs);
	}

	/**
	 * Create a unique key for a tool call
	 */
	private getToolCallKey(toolCall: ToolCall): string {
		// Create a deterministic key based on tool name and parameters
		const params = JSON.stringify(this.sortObject(toolCall.arguments));
		return `${toolCall.name}:${params}`;
	}

	/**
	 * Sort object keys for consistent stringification
	 */
	private sortObject(obj: unknown): unknown {
		if (obj === null || typeof obj !== 'object') return obj;
		if (Array.isArray(obj)) return obj.map((item) => this.sortObject(item));

		const record = obj as Record<string, unknown>;
		return Object.keys(record)
			.sort()
			.reduce<Record<string, unknown>>((sorted, key) => {
				sorted[key] = this.sortObject(record[key]);
				return sorted;
			}, {});
	}

	/**
	 * Clean up entries older than the time window
	 */
	private cleanupOldEntries(sessionId: string) {
		const history = this.executionHistory.get(sessionId);
		if (!history) return;

		const now = Date.now();
		const filtered = history.filter(
			(record) => now - record.timestamp < this.timeWindowMs * 2 // Keep 2x window for analysis
		);

		// When everything expires, drop the key entirely instead of parking an
		// empty array under it — otherwise a dead session's key lives forever.
		if (filtered.length === 0) {
			this.executionHistory.delete(sessionId);
		} else {
			this.executionHistory.set(sessionId, filtered);
		}
	}
}

/**
 * One recorded call. Only the derived {@link key} and the timestamp are kept —
 * matching and windowing are both done on those, so holding the original
 * `ToolCall` (and its arguments) here would retain it for the life of the
 * session's history for no reader.
 */
interface ToolExecutionRecord {
	key: string;
	timestamp: number;
}

export interface LoopDetectionInfo {
	isLoop: boolean;
	identicalCallCount: number;
	timeWindowMs: number;
	lastCallTimestamp?: number;
}
