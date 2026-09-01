import { describe, it, expect } from 'vitest';
import { formatTokenUsageLine } from '../../../src/ui/agent-view/token-usage-format';
import type { TokenUsageInfo } from '../../../src/services/context-manager';

function usage(overrides: Partial<TokenUsageInfo> = {}): TokenUsageInfo {
	return {
		estimatedTokens: 12_345,
		inputTokenLimit: 1_000_000,
		percentUsed: 1.2,
		cachedTokens: 0,
		...overrides,
	};
}

describe('formatTokenUsageLine', () => {
	it('renders the base line when neither cached nor reasoning tokens are reported', () => {
		expect(formatTokenUsageLine(usage())).toBe('Tokens: ~12,345 / 1,000,000 (1.2%)');
	});

	it('appends the cached segment when part of the prompt was served from cache', () => {
		// 5000 of 12,345 prompt tokens served from cache → 41%
		expect(formatTokenUsageLine(usage({ cachedTokens: 5_000 }))).toBe(
			'Tokens: ~12,345 / 1,000,000 (1.2%) · 41% cached'
		);
	});

	it('appends the reasoning segment when the model reports thinking tokens (#1437 follow-up)', () => {
		expect(formatTokenUsageLine(usage({ thoughtsTokens: 890 }))).toBe(
			'Tokens: ~12,345 / 1,000,000 (1.2%) · 890 reasoning'
		);
	});

	it('combines cached and reasoning segments when both are present', () => {
		expect(formatTokenUsageLine(usage({ cachedTokens: 5_000, thoughtsTokens: 890 }))).toBe(
			'Tokens: ~12,345 / 1,000,000 (1.2%) · 41% cached · 890 reasoning'
		);
	});

	it('formats the reasoning count with locale grouping', () => {
		expect(formatTokenUsageLine(usage({ thoughtsTokens: 12_345 }))).toContain('· 12,345 reasoning');
	});

	it('omits the reasoning segment when the provider reports zero thinking tokens', () => {
		// A thinking model that didn't think this turn — 0 is "no reasoning",
		// not "zero tokens of reasoning worth surfacing".
		expect(formatTokenUsageLine(usage({ thoughtsTokens: 0 }))).toBe('Tokens: ~12,345 / 1,000,000 (1.2%)');
	});

	it('omits the reasoning segment when the provider does not report the field at all', () => {
		// Ollama / OpenAI: the field is undefined, not zero.
		expect(formatTokenUsageLine(usage())).toBe('Tokens: ~12,345 / 1,000,000 (1.2%)');
	});

	it('omits the cached segment when cached tokens are zero', () => {
		expect(formatTokenUsageLine(usage({ cachedTokens: 0 }))).toBe('Tokens: ~12,345 / 1,000,000 (1.2%)');
	});
});
