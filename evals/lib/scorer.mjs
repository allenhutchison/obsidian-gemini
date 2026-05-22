/**
 * Per-task scoring against the rubric defined in task JSON.
 * Takes raw collector events and produces a structured TaskResult.
 */

import { calculateCost, providerSupportsCache } from './pricing.mjs';
import { evaluateMatchers, taskHasJudgeMatcher } from './matchers.mjs';
import { evaluateVaultAssertions } from './vault-assertions.mjs';

/**
 * Score a single task run.
 *
 * @param {object} task - Task definition from JSON
 * @param {Array} events - Captured event-bus events
 * @param {string} modelResponse - Final model response text
 * @param {string} modelName - Model used for this run
 * @param {number} durationMs - Wall-clock duration
 * @param {string} [provider] - Provider id ("gemini" or "ollama"); affects pricing and cache reporting
 * @param {Function} [judgeFn] - Optional async judge for `judge`-type matchers; see matchers.mjs / judge.mjs
 * @param {object} [extras] - Post-run state for side-effect scoring.
 * @param {object} [extras.vaultState] - Snapshot from `readVaultState` for `vaultAssertions`.
 * @param {Record<string,string>} [extras.fixtureMap] - Fixture file contents by name (for `fileUnchanged`).
 * @returns {Promise<object>} TaskResult
 */
export async function scoreTask(task, events, modelResponse, modelName, durationMs, provider, judgeFn, extras = {}) {
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

	// Cache is provider-specific. Ollama has no implicit cache, so we emit null
	// to mark "not applicable" — distinct from a Gemini run that genuinely served
	// 0% from cache.
	const cacheRatio = !providerSupportsCache(provider) ? null : maxPrompt > 0 ? maxCached / maxPrompt : 0;
	const cachedTokens = !providerSupportsCache(provider) ? null : maxCached;
	const costUsd = calculateCost(maxPrompt, maxCached, totalOutput, modelName, provider);

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
	// Short-circuit when the run already failed: `solved` requires `passed`,
	// so calling evaluateMatchers can't change the outcome — it would just
	// burn a judge API call (and rate-limit budget) on every error/timeout.
	const judgeAttempted = taskHasJudgeMatcher(task);
	const judgeAvailable = typeof judgeFn === 'function';
	const matcherEval = passed
		? await evaluateMatchers(task.outputMatchers, { responseText, userMessage: task.userMessage }, judgeFn)
		: {
				pass: false,
				judgeAttempted,
				judgeAvailable,
				judgeSkipped: judgeAttempted && !judgeAvailable,
			};
	const {
		pass: matchersPass,
		judgeAttempted: matcherJudgeAttempted,
		judgeAvailable: matcherJudgeAvailable,
		judgeSkipped,
	} = matcherEval;

	// Side-effect scoring: vault assertions verify what the agent did to the
	// vault (created/edited/deleted files), not just what it said. A task with
	// no `vaultAssertions` trivially passes this check.
	const vaultEval = evaluateVaultAssertions(task.vaultAssertions, extras.vaultState, extras.fixtureMap);
	const vaultAssertionsPass = vaultEval.pass;

	// Efficiency gate: when a task declares `toolCallBudget`, solving requires
	// staying at or under it. Catches "read every file in the vault" behavior
	// that a content-search tool would have answered in one call.
	const toolBudget = typeof task.toolCallBudget === 'number' ? task.toolCallBudget : null;
	const toolBudgetOk = toolBudget === null || toolCalls <= toolBudget;

	const solved =
		passed && expectedToolsMet && forbiddenToolsClean && matchersPass && vaultAssertionsPass && toolBudgetOk;

	return {
		id: task.id,
		passed,
		solved,
		metrics: {
			turns,
			tool_calls: toolCalls,
			prompt_tokens: maxPrompt,
			cached_tokens: cachedTokens,
			cache_ratio: cacheRatio === null ? null : Math.round(cacheRatio * 1000) / 1000,
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
			judge_attempted: matcherJudgeAttempted,
			judge_available: matcherJudgeAvailable,
			judge_skipped: judgeSkipped,
			vault_assertions_pass: vaultAssertionsPass,
			vault_assertion_details: vaultEval.details,
			tool_budget_ok: toolBudgetOk,
		},
	};
}
