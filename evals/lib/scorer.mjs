/**
 * Per-task scoring against the rubric defined in task JSON.
 * Takes raw collector events and produces a structured TaskResult.
 */

import { calculateCost } from './pricing.mjs';

/**
 * Score a single task run.
 *
 * @param {object} task - Task definition from JSON
 * @param {Array} events - Captured event-bus events
 * @param {string} modelResponse - Final model response text
 * @param {string} modelName - Model used for this run
 * @param {number} durationMs - Wall-clock duration
 * @returns {object} TaskResult
 */
export function scoreTask(task, events, modelResponse, modelName, durationMs) {
	const apiEvents = events.filter((e) => e.event === 'apiResponseReceived');
	const toolEvents = events.filter((e) => e.event === 'toolExecutionComplete');
	const errorEvents = events.filter((e) => e.event === 'turnError');
	const endEvents = events.filter((e) => e.event === 'turnEnd');

	// Metrics from events
	const turns = apiEvents.length;
	const toolCalls = toolEvents.length;
	const toolList = toolEvents.map((e) => e.payload.toolName);
	const toolSet = new Set(toolList);

	// Token counts — use max prompt (high-water mark), sum output
	let maxPrompt = 0;
	let maxCached = 0;
	let totalOutput = 0;
	for (const e of apiEvents) {
		const meta = e.payload.usageMetadata || {};
		const prompt = meta.promptTokenCount || 0;
		const cached = meta.cachedContentTokenCount || 0;
		const output = meta.candidatesTokenCount || 0;
		if (prompt > maxPrompt) {
			maxPrompt = prompt;
			maxCached = cached;
		}
		totalOutput += output;
	}

	const cacheRatio = maxPrompt > 0 ? maxCached / maxPrompt : 0;
	const costUsd = calculateCost(maxPrompt, maxCached, totalOutput, modelName);

	// Loop fires
	const loopFires = toolEvents.filter(
		(e) => !e.payload.result?.success && (e.payload.result?.error || '').toLowerCase().includes('loop detected')
	).length;

	// Pass / solve checks
	const hasError = errorEvents.length > 0;
	const timedOut = endEvents.length === 0;
	const passed = !hasError && !timedOut;

	// Solve: check expected tools, forbidden tools, output matchers
	const expectedToolsMet = (task.expectedTools || []).every((t) => toolSet.has(t));
	const forbiddenToolsClean = !(task.forbiddenTools || []).some((t) => toolSet.has(t));
	const responseText = typeof modelResponse === 'string' ? modelResponse : '';
	const matchersPass = (task.outputMatchers || []).every((m) => {
		if (m.type === 'contains') return responseText.includes(m.value);
		if (m.type === 'regex') {
			try {
				return new RegExp(m.value).test(responseText);
			} catch {
				return false;
			}
		}
		return true;
	});
	const solved = passed && expectedToolsMet && forbiddenToolsClean && matchersPass;

	return {
		id: task.id,
		passed,
		solved,
		metrics: {
			turns,
			tool_calls: toolCalls,
			prompt_tokens: maxPrompt,
			cached_tokens: maxCached,
			cache_ratio: Math.round(cacheRatio * 1000) / 1000,
			output_tokens: totalOutput,
			cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
			loop_fires: loopFires,
			duration_ms: durationMs,
			tool_list: toolList,
		},
		errors: hasError ? errorEvents.map((e) => e.payload.error) : [],
		solve_details: {
			expected_tools_met: expectedToolsMet,
			forbidden_tools_clean: forbiddenToolsClean,
			matchers_pass: matchersPass,
		},
	};
}
