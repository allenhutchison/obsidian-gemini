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
		history.push({ key, timestamp, toolCall });
		
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
		const key = this.getToolCallKey(toolCall);
		const history = this.executionHistory.get(sessionId) || [];
		const now = Date.now();
		
		// Count recent identical calls
		const recentIdenticalCalls = history.filter(record => 
			record.key === key && 
			(now - record.timestamp) < this.timeWindowMs
		);
		
		return recentIdenticalCalls.length >= this.loopThreshold;
	}

	/**
	 * Get loop detection info for a tool call
	 */
	getLoopInfo(sessionId: string, toolCall: ToolCall): LoopDetectionInfo {
		const key = this.getToolCallKey(toolCall);
		const history = this.executionHistory.get(sessionId) || [];
		const now = Date.now();
		
		const recentIdenticalCalls = history.filter(record => 
			record.key === key && 
			(now - record.timestamp) < this.timeWindowMs
		);
		
		const consecutiveCalls = this.countConsecutiveCalls(history, key);
		
		return {
			isLoop: recentIdenticalCalls.length >= this.loopThreshold,
			identicalCallCount: recentIdenticalCalls.length,
			consecutiveCallCount: consecutiveCalls,
			timeWindowMs: this.timeWindowMs,
			lastCallTimestamp: recentIdenticalCalls[recentIdenticalCalls.length - 1]?.timestamp
		};
	}

	/**
	 * Clear history for a session
	 */
	clearSession(sessionId: string) {
		this.executionHistory.delete(sessionId);
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
	private sortObject(obj: any): any {
		if (obj === null || typeof obj !== 'object') return obj;
		if (Array.isArray(obj)) return obj.map(item => this.sortObject(item));
		
		return Object.keys(obj)
			.sort()
			.reduce((sorted: any, key) => {
				sorted[key] = this.sortObject(obj[key]);
				return sorted;
			}, {});
	}

	/**
	 * Count consecutive calls with the same key
	 */
	private countConsecutiveCalls(history: ToolExecutionRecord[], targetKey: string): number {
		let count = 0;
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].key === targetKey) {
				count++;
			} else {
				break;
			}
		}
		return count;
	}

	/**
	 * Clean up entries older than the time window
	 */
	private cleanupOldEntries(sessionId: string) {
		const history = this.executionHistory.get(sessionId);
		if (!history) return;
		
		const now = Date.now();
		const filtered = history.filter(record => 
			(now - record.timestamp) < this.timeWindowMs * 2 // Keep 2x window for analysis
		);
		
		this.executionHistory.set(sessionId, filtered);
	}
}

interface ToolExecutionRecord {
	key: string;
	timestamp: number;
	toolCall: ToolCall;
}

export interface LoopDetectionInfo {
	isLoop: boolean;
	identicalCallCount: number;
	consecutiveCallCount: number;
	timeWindowMs: number;
	lastCallTimestamp?: number;
}