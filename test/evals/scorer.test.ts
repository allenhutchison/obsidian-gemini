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
		expect(result.solve_details.judge_skipped).toBe(false);
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

	it('records judge_skipped when a clean run cannot create the judge', async () => {
		const events = [apiResponse(), turnEnd()];
		const result: any = await scoreTask(baseTask as any, events, 'response text', 'gemini-2.5-flash', 1234, 'ollama');
		expect(result.passed).toBe(true);
		expect(result.solved).toBe(false);
		expect(result.solve_details.judge_attempted).toBe(true);
		expect(result.solve_details.judge_available).toBe(false);
		expect(result.solve_details.judge_skipped).toBe(true);
	});
});

function toolComplete(toolName: string) {
	return { event: 'toolExecutionComplete', payload: { toolName, result: { success: true } } };
}

describe('scoreTask — vault assertions', () => {
	const task = {
		id: 'write-task',
		userMessage: 'create the note',
		expectedTools: ['write_file'],
		forbiddenTools: [],
		outputMatchers: [],
		vaultAssertions: [{ type: 'fileContains', path: 'eval-scratch/out.md', value: 'Summary' }],
	};

	it('solves when the vault assertion holds', async () => {
		const events = [apiResponse(), toolComplete('write_file'), turnEnd()];
		const result: any = await scoreTask(task as any, events, 'done', 'gemini-2.5-flash', 100, 'gemini', undefined, {
			vaultState: { 'eval-scratch/out.md': { exists: true, content: '# Summary', frontmatter: null } },
		});
		expect(result.solved).toBe(true);
		expect(result.solve_details.vault_assertions_pass).toBe(true);
	});

	it('does not solve when the file was never written, even if write_file was called', async () => {
		const events = [apiResponse(), toolComplete('write_file'), turnEnd()];
		const result: any = await scoreTask(task as any, events, 'done', 'gemini-2.5-flash', 100, 'gemini', undefined, {
			vaultState: { 'eval-scratch/out.md': { exists: false, content: null, frontmatter: null } },
		});
		expect(result.passed).toBe(true);
		expect(result.solved).toBe(false);
		expect(result.solve_details.vault_assertions_pass).toBe(false);
	});

	it('treats a task with no vaultAssertions as trivially passing that gate', async () => {
		const plain = { id: 't', userMessage: 'x', expectedTools: [], forbiddenTools: [], outputMatchers: [] };
		const result: any = await scoreTask(
			plain as any,
			[apiResponse(), turnEnd()],
			'ok',
			'gemini-2.5-flash',
			100,
			'gemini'
		);
		expect(result.solved).toBe(true);
		expect(result.solve_details.vault_assertions_pass).toBe(true);
	});
});

describe('scoreTask — tool-call budget', () => {
	const task = {
		id: 'budget-task',
		userMessage: 'find it efficiently',
		expectedTools: [],
		forbiddenTools: [],
		outputMatchers: [],
		toolCallBudget: 2,
	};

	it('solves when tool calls stay within budget', async () => {
		const events = [apiResponse(), toolComplete('find_files_by_content'), toolComplete('read_file'), turnEnd()];
		const result: any = await scoreTask(task as any, events, 'answer', 'gemini-2.5-flash', 100, 'gemini');
		expect(result.solve_details.tool_budget_ok).toBe(true);
		expect(result.solved).toBe(true);
	});

	it('does not solve when tool calls exceed budget', async () => {
		const events = [
			apiResponse(),
			toolComplete('read_file'),
			toolComplete('read_file'),
			toolComplete('read_file'),
			turnEnd(),
		];
		const result: any = await scoreTask(task as any, events, 'answer', 'gemini-2.5-flash', 100, 'gemini');
		expect(result.passed).toBe(true);
		expect(result.solve_details.tool_budget_ok).toBe(false);
		expect(result.solved).toBe(false);
	});
});
