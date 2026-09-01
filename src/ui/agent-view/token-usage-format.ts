import { t } from '../../i18n';
import type { TokenUsageInfo } from '../../services/context-manager';

/**
 * Build the token-readout line for the agent view's usage indicator.
 *
 * Extracted from AgentView.updateTokenUsage (#1437 follow-up) so the
 * segment-selection logic — which optional segments (cached, reasoning)
 * appear, and with what values — is unit-testable without scaffolding the
 * full view. Rendering is a plain string; the caller puts it in the span.
 *
 * Segments appear only when the provider actually reported them:
 * - cached: positive cachedTokens against a positive prompt estimate
 *   (how much of the prompt the implicit/explicit cache served — a
 *   positive signal that rewards stable prefixes);
 * - reasoning (thoughtsTokens): present only on providers that report
 *   thinking-token counts (Gemini thinking models); absent elsewhere is
 *   honest rather than zero.
 */
export function formatTokenUsageLine(usage: TokenUsageInfo): string {
	const usageVars = {
		used: usage.estimatedTokens.toLocaleString(),
		limit: usage.inputTokenLimit.toLocaleString(),
		percent: usage.percentUsed,
	};
	const hasCached = usage.cachedTokens > 0 && usage.estimatedTokens > 0;
	const hasThoughts = usage.thoughtsTokens !== undefined && usage.thoughtsTokens > 0;
	if (hasCached && hasThoughts) {
		const cachedPercent = Math.round((usage.cachedTokens / usage.estimatedTokens) * 100);
		return t('agent.tokens.usageCachedThoughts', {
			...usageVars,
			cached: cachedPercent,
			thoughts: usage.thoughtsTokens!.toLocaleString(),
		});
	} else if (hasCached) {
		const cachedPercent = Math.round((usage.cachedTokens / usage.estimatedTokens) * 100);
		return t('agent.tokens.usageCached', { ...usageVars, cached: cachedPercent });
	} else if (hasThoughts) {
		return t('agent.tokens.usageThoughts', {
			...usageVars,
			thoughts: usage.thoughtsTokens!.toLocaleString(),
		});
	}
	return t('agent.tokens.usage', usageVars);
}
