/**
 * Model pricing table for cost estimation.
 *
 * Source: Google AI for Developers pricing page
 * Date: April 2026
 *
 * All prices are USD per 1M tokens.
 * cachedPer1M is the price for tokens served from implicit/explicit cache
 * (typically 25% of input price for Gemini models).
 */

const PRICING = {
	'gemini-2.5-flash': { inputPer1M: 0.15, cachedPer1M: 0.0375, outputPer1M: 0.6 },
	'gemini-2.5-pro': { inputPer1M: 1.25, cachedPer1M: 0.3125, outputPer1M: 10.0 },
	'gemini-2.0-flash': { inputPer1M: 0.1, cachedPer1M: 0.025, outputPer1M: 0.4 },
	'gemini-2.5-flash-lite': { inputPer1M: 0.075, cachedPer1M: 0.01875, outputPer1M: 0.3 },
};

const FALLBACK = PRICING['gemini-2.5-flash'];
const FREE = { inputPer1M: 0, cachedPer1M: 0, outputPer1M: 0 };

/**
 * Look up pricing for a model name. Local providers (e.g. Ollama) bill $0;
 * unknown Gemini models fall back to flash pricing. Matches by longest prefix
 * first so "gemini-2.5-flash-lite-001" resolves to "gemini-2.5-flash-lite"
 * instead of "gemini-2.5-flash".
 */
export function getModelPricing(modelName, provider) {
	if (provider === 'ollama') return FREE;
	if (!modelName) return FALLBACK;
	const exact = PRICING[modelName];
	if (exact) return exact;
	const keysBySpecificity = Object.keys(PRICING).sort((a, b) => b.length - a.length);
	for (const key of keysBySpecificity) {
		if (modelName.startsWith(`${key}-`)) return PRICING[key];
	}
	return FALLBACK;
}

/**
 * Calculate cost in USD for a single API call.
 *
 * @param {number} promptTokens - Total prompt tokens (including cached)
 * @param {number} cachedTokens - Portion of prompt served from cache
 * @param {number} outputTokens - Output/candidate tokens
 * @param {string} modelName - Model identifier from settings
 * @param {string} [provider] - Provider id ("gemini" or "ollama"); local providers bill $0
 * @returns {number} Estimated cost in USD
 */
export function calculateCost(promptTokens, cachedTokens, outputTokens, modelName, provider) {
	const pricing = getModelPricing(modelName, provider);
	const uncachedInput = promptTokens - cachedTokens;
	return (
		(uncachedInput / 1_000_000) * pricing.inputPer1M +
		(cachedTokens / 1_000_000) * pricing.cachedPer1M +
		(outputTokens / 1_000_000) * pricing.outputPer1M
	);
}

/**
 * Whether this provider exposes a meaningful cache-hit metric. Ollama has no
 * implicit cache, so cache% should be rendered "n/a" rather than "0%".
 */
export function providerSupportsCache(provider) {
	return provider !== 'ollama';
}
