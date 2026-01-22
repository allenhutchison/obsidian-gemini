import { ToolLoopDetector } from '../../src/tools/loop-detector';
import { ToolCall } from '../../src/tools/types';

describe('ToolLoopDetector', () => {
	let detector: ToolLoopDetector;

	beforeEach(() => {
		detector = new ToolLoopDetector(3, 60); // 3 identical calls within 60 seconds
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should not detect loop for different tool calls', () => {
		const sessionId = 'test-session';

		// Record different tool calls
		detector.recordExecution(sessionId, { name: 'tool1', arguments: { arg: 'value1' } });
		detector.recordExecution(sessionId, { name: 'tool2', arguments: { arg: 'value2' } });

		// Should not detect loop for a new different tool
		expect(detector.isLoopDetected(sessionId, { name: 'tool3', arguments: { arg: 'value3' } })).toBe(false);
	});

	it('should not detect loop for same tool with different arguments', () => {
		const sessionId = 'test-session';

		// Record same tool with different arguments
		detector.recordExecution(sessionId, { name: 'read_file', arguments: { path: 'file1.md' } });
		detector.recordExecution(sessionId, { name: 'read_file', arguments: { path: 'file2.md' } });

		// Should not detect loop for same tool with yet another different argument
		expect(detector.isLoopDetected(sessionId, { name: 'read_file', arguments: { path: 'file3.md' } })).toBe(false);
	});

	it('should detect loop when identical calls exceed threshold', () => {
		const sessionId = 'test-session';
		const toolCall: ToolCall = { name: 'search_files', arguments: { pattern: 'test' } };

		// Record two identical calls
		detector.recordExecution(sessionId, toolCall);
		detector.recordExecution(sessionId, toolCall);

		// Should not detect loop yet (threshold is 3)
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(false);

		// Record third call
		detector.recordExecution(sessionId, toolCall);

		// Now should detect loop
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(true);
	});

	it('should reset loop detection after time window expires', () => {
		const sessionId = 'test-session';
		const toolCall: ToolCall = { name: 'search_files', arguments: { pattern: 'test' } };

		// Make two calls
		detector.recordExecution(sessionId, toolCall);
		detector.recordExecution(sessionId, toolCall);

		// Advance time past the window (60 seconds)
		jest.advanceTimersByTime(61000);

		// Should not detect loop since old calls expired
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(false);
	});

	it('should track loops separately per session', () => {
		const toolCall: ToolCall = { name: 'write_file', arguments: { path: 'test.md', content: 'content' } };

		// Session 1: Record three calls (threshold is 3)
		detector.recordExecution('session1', toolCall);
		detector.recordExecution('session1', toolCall);
		detector.recordExecution('session1', toolCall);

		// Session 2: Record three calls
		detector.recordExecution('session2', toolCall);
		detector.recordExecution('session2', toolCall);
		detector.recordExecution('session2', toolCall);

		// Both sessions should detect loop now
		expect(detector.isLoopDetected('session1', toolCall)).toBe(true);
		expect(detector.isLoopDetected('session2', toolCall)).toBe(true);
	});

	it('should clear session history', () => {
		const sessionId = 'test-session';
		const toolCall: ToolCall = { name: 'read_file', arguments: { path: 'file.md' } };

		// Record calls
		detector.recordExecution(sessionId, toolCall);
		detector.recordExecution(sessionId, toolCall);

		// Clear session
		detector.clearSession(sessionId);

		// Should not detect loop after clearing
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(false);

		// Should need 3 calls again to trigger loop
		detector.recordExecution(sessionId, toolCall);
		detector.recordExecution(sessionId, toolCall);
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(false);
		detector.recordExecution(sessionId, toolCall);
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(true);
	});

	it('should handle complex argument objects correctly', () => {
		const sessionId = 'test-session';

		// These should be treated as identical despite property order
		const call1: ToolCall = { name: 'complex_tool', arguments: { b: 'value', a: 1, c: { nested: true } } };
		const call2: ToolCall = { name: 'complex_tool', arguments: { a: 1, b: 'value', c: { nested: true } } };
		const call3: ToolCall = { name: 'complex_tool', arguments: { c: { nested: true }, b: 'value', a: 1 } };

		detector.recordExecution(sessionId, call1);
		detector.recordExecution(sessionId, call2);
		detector.recordExecution(sessionId, call3);

		// Should detect loop since arguments are identical
		expect(detector.isLoopDetected(sessionId, call1)).toBe(true);
	});

	it('should distinguish between similar but different arguments', () => {
		const sessionId = 'test-session';

		// Similar but different patterns
		const call1: ToolCall = { name: 'search_files', arguments: { pattern: 'test' } };
		const call2: ToolCall = { name: 'search_files', arguments: { pattern: 'test*' } };

		// Record alternating calls
		detector.recordExecution(sessionId, call1);
		detector.recordExecution(sessionId, call2);
		detector.recordExecution(sessionId, call1);
		detector.recordExecution(sessionId, call2);

		// Neither should trigger loop since they alternate
		expect(detector.isLoopDetected(sessionId, call1)).toBe(false);
		expect(detector.isLoopDetected(sessionId, call2)).toBe(false);
	});

	it('should provide accurate loop info', () => {
		const sessionId = 'test-session';
		const toolCall: ToolCall = { name: 'read_file', arguments: { path: 'test.md' } };

		// Record calls
		detector.recordExecution(sessionId, toolCall);
		detector.recordExecution(sessionId, toolCall);

		const info = detector.getLoopInfo(sessionId, toolCall);

		expect(info.isLoop).toBe(false);
		expect(info.identicalCallCount).toBe(2);
		expect(info.consecutiveCallCount).toBe(2);
		expect(info.timeWindowMs).toBe(60000);
		expect(info.lastCallTimestamp).toBeDefined();
	});

	it('should handle edge cases', () => {
		const sessionId = 'test-session';

		// Empty arguments
		const emptyCall: ToolCall = { name: 'tool', arguments: {} };
		detector.recordExecution(sessionId, emptyCall);
		detector.recordExecution(sessionId, emptyCall);
		detector.recordExecution(sessionId, emptyCall);
		expect(detector.isLoopDetected(sessionId, emptyCall)).toBe(true);

		// Null/undefined handling
		const nullCall: ToolCall = { name: 'tool2', arguments: { value: null } };
		const undefinedCall: ToolCall = { name: 'tool2', arguments: { value: undefined } };

		detector.recordExecution(sessionId, nullCall);
		detector.recordExecution(sessionId, undefinedCall);

		// Should be treated as different
		expect(detector.isLoopDetected(sessionId, nullCall)).toBe(false);
	});

	it('should update configuration', () => {
		const sessionId = 'test-session';
		const toolCall: ToolCall = { name: 'test', arguments: {} };

		// Record 2 calls
		detector.recordExecution(sessionId, toolCall);
		detector.recordExecution(sessionId, toolCall);

		// Should not detect loop with threshold of 3
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(false);

		// Update config to lower threshold
		detector.updateConfig(2, 60);

		// Now should detect loop
		expect(detector.isLoopDetected(sessionId, toolCall)).toBe(true);
	});
});
