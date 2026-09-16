/**
 * Curated metadata for the Claude models this plugin offers — the Anthropic
 * counterpart of `KNOWN_OPENAI_MODELS`. Leaf module: read by both the client
 * (per-model request shaping) and `AnthropicModelsService` (the model list).
 *
 * The request surface differs by model family, so the client can't send one
 * shape to every id the `/v1/models` endpoint advertises: adaptive thinking is
 * rejected by Haiku 4.5 and older models, and server-side refusal fallbacks
 * only apply to the tiers that run safety classifiers. The list is therefore
 * an allowlist, like the OpenAI-hosted one — an id not in it is not offered.
 */

import type { ModelRole } from '../../../types/features';

export interface AnthropicModelMetadata {
	/** Input token ceiling; overridden by `max_input_tokens` when `/v1/models` reports one. */
	contextWindow: number;
	/** Sends `thinking: { type: 'adaptive', display: 'summarized' }` when true; omits `thinking` otherwise. */
	adaptiveThinking: boolean;
	/** Opts into server-side refusal fallbacks (`fallbacks: 'default'`). */
	refusalFallback: boolean;
	defaultForRoles?: ModelRole[];
}

export const KNOWN_ANTHROPIC_MODELS: Record<string, AnthropicModelMetadata> = {
	'claude-opus-5': {
		contextWindow: 1_000_000,
		adaptiveThinking: true,
		refusalFallback: true,
		defaultForRoles: ['chat', 'rewrite'],
	},
	'claude-fable-5-1': { contextWindow: 1_000_000, adaptiveThinking: true, refusalFallback: true },
	'claude-sonnet-5': {
		contextWindow: 1_000_000,
		adaptiveThinking: true,
		refusalFallback: false,
		defaultForRoles: ['summary'],
	},
	'claude-opus-4-8': { contextWindow: 1_000_000, adaptiveThinking: true, refusalFallback: false },
	'claude-haiku-4-5': {
		contextWindow: 200_000,
		adaptiveThinking: false,
		refusalFallback: false,
		defaultForRoles: ['completions'],
	},
};

/** Request shaping for an id outside the catalog (e.g. a model a stale setting still names): the most conservative surface. */
const UNKNOWN_ANTHROPIC_MODEL: AnthropicModelMetadata = {
	contextWindow: 200_000,
	adaptiveThinking: false,
	refusalFallback: false,
};

export function anthropicModelMetadata(id: string): AnthropicModelMetadata {
	return KNOWN_ANTHROPIC_MODELS[id] ?? UNKNOWN_ANTHROPIC_MODEL;
}
