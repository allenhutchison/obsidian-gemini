import { describe, it, expect, vi } from 'vitest';
import { evaluateMatchers } from '../../evals/lib/matchers.mjs';

const ctx = (responseText: string, userMessage = '') => ({ responseText, userMessage });

describe('evaluateMatchers — contains', () => {
	it('passes when a single substring is present', async () => {
		const result = await evaluateMatchers([{ type: 'contains', value: 'foo' }], ctx('xyz foo bar'));
		expect(result.pass).toBe(true);
	});

	it('fails when a single substring is missing', async () => {
		const result = await evaluateMatchers([{ type: 'contains', value: 'foo' }], ctx('xyz bar'));
		expect(result.pass).toBe(false);
	});

	it('passes if any of the array forms appears (any-of OR)', async () => {
		const result = await evaluateMatchers(
			[{ type: 'contains', value: ['Neural Networks', 'neural-networks'] }],
			ctx('See [[neural-networks]]')
		);
		expect(result.pass).toBe(true);
	});

	it('fails if none of the array forms appears', async () => {
		const result = await evaluateMatchers(
			[{ type: 'contains', value: ['Neural Networks', 'neural-networks'] }],
			ctx('See [[reinforcement-learning]]')
		);
		expect(result.pass).toBe(false);
	});

	it('treats every matcher as AND (all must match)', async () => {
		const result = await evaluateMatchers(
			[
				{ type: 'contains', value: ['Neural Networks', 'neural-networks'] },
				{ type: 'contains', value: ['Transformers', 'transformer-architecture'] },
			],
			ctx('See [[neural-networks]]')
		);
		expect(result.pass).toBe(false);
	});
});

describe('evaluateMatchers — regex', () => {
	it('matches with provided flags', async () => {
		const result = await evaluateMatchers([{ type: 'regex', value: 'NEURAL', flags: 'i' }], ctx('neural network'));
		expect(result.pass).toBe(true);
	});

	it('any-of pattern array', async () => {
		const result = await evaluateMatchers(
			[{ type: 'regex', value: ['^foo$', 'bar+'], flags: 'm' }],
			ctx('barrr is here')
		);
		expect(result.pass).toBe(true);
	});

	it('invalid regex fails the matcher rather than throwing', async () => {
		const result = await evaluateMatchers([{ type: 'regex', value: '(' }], ctx('anything'));
		expect(result.pass).toBe(false);
	});
});

describe('evaluateMatchers — judge', () => {
	it('passes when the judge returns true', async () => {
		const judge = vi.fn().mockResolvedValue(true);
		const result = await evaluateMatchers(
			[{ type: 'judge', criteria: 'is a haiku' }],
			ctx('blossoms drift\nspring rain on stone\nsilent path', 'write a haiku'),
			judge
		);
		expect(result.pass).toBe(true);
		expect(result.judgeAttempted).toBe(true);
		expect(result.judgeAvailable).toBe(true);
		expect(judge).toHaveBeenCalledWith('is a haiku', expect.objectContaining({ userMessage: 'write a haiku' }));
	});

	it('fails when the judge returns false', async () => {
		const judge = vi.fn().mockResolvedValue(false);
		const result = await evaluateMatchers([{ type: 'judge', criteria: 'covers X and Y' }], ctx('only X', ''), judge);
		expect(result.pass).toBe(false);
	});

	it('fails the matcher when the judge throws (no silent pass)', async () => {
		const judge = vi.fn().mockRejectedValue(new Error('429'));
		const result = await evaluateMatchers([{ type: 'judge', criteria: 'x' }], ctx('y'), judge);
		expect(result.pass).toBe(false);
	});

	it('fails when a judge matcher is used but no judgeFn is supplied', async () => {
		const result = await evaluateMatchers([{ type: 'judge', criteria: 'x' }], ctx('y'));
		expect(result.pass).toBe(false);
		expect(result.judgeAttempted).toBe(true);
		expect(result.judgeAvailable).toBe(false);
	});

	it('does not invoke the judge for non-judge matchers', async () => {
		const judge = vi.fn().mockResolvedValue(true);
		await evaluateMatchers([{ type: 'contains', value: 'hi' }], ctx('hi there'), judge);
		expect(judge).not.toHaveBeenCalled();
	});
});

describe('evaluateMatchers — empty / unknown', () => {
	it('passes for an empty matcher list (no rubric, nothing to fail)', async () => {
		const result = await evaluateMatchers([], ctx('anything'));
		expect(result.pass).toBe(true);
	});

	it('handles undefined matcher list as empty', async () => {
		const result = await evaluateMatchers(undefined, ctx('anything'));
		expect(result.pass).toBe(true);
	});

	it('fails closed on an unknown matcher type', async () => {
		const result = await evaluateMatchers([{ type: 'mystery', value: 'x' } as any], ctx('x'));
		expect(result.pass).toBe(false);
	});
});
