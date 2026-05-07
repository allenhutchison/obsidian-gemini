import { describe, it, expect } from 'vitest';
import { summarizeProgress, formatProgressLine, progressChanged } from '../../evals/lib/progress.mjs';

const apiResponse = () => ({ event: 'apiResponseReceived', payload: {} });
const toolDone = () => ({ event: 'toolExecutionComplete', payload: {} });
const noise = () => ({ event: 'turnStart', payload: {} });

describe('summarizeProgress', () => {
	it('counts apiResponseReceived as turns and toolExecutionComplete as tool calls', () => {
		const events = [apiResponse(), toolDone(), toolDone(), apiResponse(), toolDone(), noise()];
		const s = summarizeProgress(events, 1000, 13_000);
		expect(s.turn).toBe(2);
		expect(s.toolCalls).toBe(3);
		expect(s.elapsedSec).toBe(12);
	});

	it('handles empty / undefined event arrays', () => {
		const s = summarizeProgress(undefined as any, 1000, 5000);
		expect(s.turn).toBe(0);
		expect(s.toolCalls).toBe(0);
		expect(s.elapsedSec).toBe(4);
		expect(s.avgTurnSec).toBeNull();
		expect(s.etaSec).toBeNull();
	});

	it('computes ETA when maxTurns is provided and turns are in progress', () => {
		// 2 turns in 12s = 6s/turn. With maxTurns=10, 8 turns remaining → 48s ETA.
		const events = [apiResponse(), apiResponse()];
		const s = summarizeProgress(events, 1000, 13_000, 10);
		expect(s.avgTurnSec).toBe(6);
		expect(s.etaSec).toBe(48);
	});

	it('omits ETA when maxTurns is unset', () => {
		const events = [apiResponse(), apiResponse()];
		const s = summarizeProgress(events, 1000, 13_000);
		expect(s.etaSec).toBeNull();
	});

	it('omits ETA when no turns have completed yet', () => {
		const events = [toolDone()];
		const s = summarizeProgress(events, 1000, 5000, 10);
		expect(s.turn).toBe(0);
		expect(s.etaSec).toBeNull();
	});

	it('omits ETA when the budget is already met', () => {
		const events = [apiResponse(), apiResponse(), apiResponse()];
		// turns >= maxTurns → no remaining work to estimate.
		const s = summarizeProgress(events, 1000, 13_000, 3);
		expect(s.etaSec).toBeNull();
	});

	it('clamps negative elapsed time to zero (clock skew defense)', () => {
		const s = summarizeProgress([], 10_000, 5_000);
		expect(s.elapsedSec).toBe(0);
	});
});

describe('formatProgressLine', () => {
	it('renders a turn / tool / elapsed / ETA line', () => {
		const line = formatProgressLine({ turn: 3, toolCalls: 5, elapsedSec: 18, avgTurnSec: 6, etaSec: 24 });
		expect(line).toBe('  [turn 3 | 5 tool calls | 18s elapsed | ETA 24s]');
	});

	it('omits the ETA segment when etaSec is null', () => {
		const line = formatProgressLine({ turn: 1, toolCalls: 0, elapsedSec: 4, avgTurnSec: null, etaSec: null });
		expect(line).toBe('  [turn 1 | 0 tool calls | 4s elapsed]');
	});
});

describe('progressChanged', () => {
	it('treats first non-zero summary as a change', () => {
		expect(progressChanged(null, { turn: 1, toolCalls: 0, elapsedSec: 2, avgTurnSec: 2, etaSec: null })).toBe(true);
	});

	it('does not flag elapsed-only ticks as a change', () => {
		const prev = { turn: 1, toolCalls: 0, elapsedSec: 2, avgTurnSec: 2, etaSec: null };
		const next = { turn: 1, toolCalls: 0, elapsedSec: 4, avgTurnSec: 4, etaSec: null };
		expect(progressChanged(prev, next)).toBe(false);
	});

	it('flags when turn count increases', () => {
		const prev = { turn: 1, toolCalls: 0, elapsedSec: 2, avgTurnSec: 2, etaSec: null };
		const next = { turn: 2, toolCalls: 0, elapsedSec: 4, avgTurnSec: 2, etaSec: null };
		expect(progressChanged(prev, next)).toBe(true);
	});

	it('flags when tool-call count increases', () => {
		const prev = { turn: 1, toolCalls: 0, elapsedSec: 2, avgTurnSec: 2, etaSec: null };
		const next = { turn: 1, toolCalls: 1, elapsedSec: 4, avgTurnSec: 4, etaSec: null };
		expect(progressChanged(prev, next)).toBe(true);
	});

	it('does not flag a zero summary against null', () => {
		expect(progressChanged(null, { turn: 0, toolCalls: 0, elapsedSec: 0, avgTurnSec: null, etaSec: null })).toBe(false);
	});
});
