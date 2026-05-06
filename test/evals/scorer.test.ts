import { describe, it, expect, vi } from 'vitest';
import { scoreTask } from '../../evals/lib/scorer.mjs';

function turnEnd() {
	return { event: 'turnEnd', payload: {} };
}
function turnError(message = 'boom') {
	return { event: 'turnError', payload: { error: message } };
}
function apiResponse(usage: any = {}) {
	return { event: 'apiResponseReceived', payload: { usageMetadata: usage } };
}

describe('scoreTask — judge short-circuit on failed runs', () => {
	const baseTask = {
		id: 't',
		userMessage: 'do the thing',
		expectedTools: [],
		forbiddenTools: [],
		outputMatchers: [{ type: 'judge', criteria: 'covers X' }],
	};

	it('does not invoke the judge when the run errored (passed=false)', async () => {
		const judge = vi.fn().mockResolvedValue(true);
		const events = [apiResponse(), turnError('agent crashed')];
		// No `turnEnd` event → run is not in a normal terminal state, but the
		// turnError alone already makes passed=false. Either way, the judge
		// must not be called.
		const result: any = await scoreTask(
			baseTask as any,
			events,
			'response text',
			'gemini-2.5-flash',
			1234,
			'gemini',
			judge as any
		);
		expect(result.passed).toBe(false);
		expect(result.solved).toBe(false);
		expect(judge).not.toHaveBeenCalled();
		// `judgeAttempted` still records that the rubric *would* have called the
		// judge — useful for reporting. `judgeAvailable` reflects the env.
		expect(result.solve_details.judge_attempted).toBe(true);
		expect(result.solve_details.judge_available).toBe(true);
	});

	it('does not invoke the judge when the run timed out (no turnEnd)', async () => {
		const judge = vi.fn().mockResolvedValue(true);
		const events = [apiResponse()]; // No turnEnd → timedOut → passed=false
		const result: any = await scoreTask(
			baseTask as any,
			events,
			'response text',
			'gemini-2.5-flash',
			1234,
			'gemini',
			judge as any
		);
		expect(result.passed).toBe(false);
		expect(judge).not.toHaveBeenCalled();
	});

	it('still invokes the judge when the run passed cleanly', async () => {
		const judge = vi.fn().mockResolvedValue(true);
		const events = [apiResponse(), turnEnd()];
		const result: any = await scoreTask(
			baseTask as any,
			events,
			'response text',
			'gemini-2.5-flash',
			1234,
			'gemini',
			judge as any
		);
		expect(result.passed).toBe(true);
		expect(judge).toHaveBeenCalledOnce();
		expect(result.solved).toBe(true);
	});
});
