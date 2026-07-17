/**
 * Context Manager Service
 *
 * Monitors token usage across agent conversations and automatically compacts
 * (summarizes) older turns when the context window fills up.
 *
 * Addresses issues:
 * - #336: Long context reliability
 * - #328: Tool calling unreliability in long conversations
 * - #129: 429 errors from oversized context
 */
import { GoogleGenAI, Content, Part } from '@google/genai';
import { Logger } from '../utils/logger';
import type { ObsidianGemini } from '../types/plugin';
import { ModelClientFactory, ModelUseCase } from '../api';
import { executeWithRetry } from '../utils/retry';
import { createGoogleGenAI } from '../api/providers/gemini/google-genai-factory';
import { truncateOldToolResults } from '../agent/agent-loop-helpers';
import { getLegacyEntryTextTruthy } from '../utils/history-normalize';
import { isInteractionsOnlyModel, resolveGenerateContentModel } from '../models';

import contextSummaryPromptContent from '../../prompts/contextSummaryPrompt.hbs';

/** Aggressive compaction triggers at this % of total model context window */
const AGGRESSIVE_COMPACTION_THRESHOLD_PERCENT = 80;

/** Default model input token limit (1M for all current Gemini models) */
const DEFAULT_INPUT_TOKEN_LIMIT = 1_000_000;

/**
 * Conservative default input token limit for Ollama models. Local models vary
 * widely (4k–128k); we pick a safe middle so compaction triggers before
 * smaller models truncate. Users with larger-context models can let
 * compaction happen later without harm.
 */
const OLLAMA_DEFAULT_INPUT_TOKEN_LIMIT = 32_000;

/**
 * Starting chars-per-token ratio for providers that don't expose a countTokens
 * endpoint (Ollama), used until real usage data calibrates a per-model ratio.
 * 4 is the standard char/token heuristic for English text.
 */
const DEFAULT_OLLAMA_CHARS_PER_TOKEN = 4;

/** Weight given to each new observation when blending the calibrated ratio (EMA). */
const OLLAMA_RATIO_CALIBRATION_WEIGHT = 0.5;

/** Minimum number of recent turns to preserve during compaction */
const MIN_RECENT_TURNS_TO_KEEP = 6;

/** Maximum number of recent turns to preserve during normal compaction (~30%) */
const RECENT_TURNS_RATIO = 0.3;

/** Minimum turns to keep during aggressive compaction */
const AGGRESSIVE_RECENT_TURNS = 5;

/** Marker prefix for summary entries in conversation history */
export const CONTEXT_SUMMARY_MARKER = '[Context Summary]';

export interface CompactionResult {
	/** The history array ready to send to the API. May be the original
	 *  reference (no changes), the truncated form (phase 1), or a fully
	 *  summarized form (phase 2). */
	compactedHistory: Content[];
	/** True iff phase 2 summarization occurred — i.e. older turns were
	 *  replaced with a generated summary entry. NOT set for phase 1
	 *  truncation, which only sheds bytes from existing tool-result turns
	 *  without producing a summary. Paired with `summaryText`: callers that
	 *  surface a "Context Compacted" notification gate on the conjunction
	 *  (see agent-view-send.ts) so phase 1 stays silent. */
	wasCompacted: boolean;
	/** Current estimated token count */
	estimatedTokens: number;
	/** Summary text that was generated (only set when phase 2 ran) */
	summaryText?: string;
}

export interface TokenUsageInfo {
	/** Estimated total tokens in current context */
	estimatedTokens: number;
	/** Model's input token limit */
	inputTokenLimit: number;
	/** Percentage of limit used */
	percentUsed: number;
	/** Tokens served from Gemini's implicit cache */
	cachedTokens: number;
}

export interface UsageMetadata {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	totalTokenCount?: number;
	cachedContentTokenCount?: number;
	thoughtsTokenCount?: number;
}

/**
 * ContextManager monitors token usage and compacts conversation history
 * when it approaches configurable thresholds.
 */
export class ContextManager {
	private lastUsageMetadata: UsageMetadata | null = null;
	private acceptNextLowerUpdate = false;
	private ai: GoogleGenAI | null;
	/** Per-model chars-per-token ratio for Ollama, calibrated from real usage metadata. */
	private ollamaCharsPerToken: Map<string, number> = new Map();
	/** Char length of the most recent Ollama countTokens() estimate per model, awaiting calibration against the next real response. */
	private pendingOllamaEstimateCharLength: Map<string, number> = new Map();

	constructor(
		private plugin: ObsidianGemini,
		private logger: Logger
	) {
		// Only construct the Gemini SDK when the active provider is Gemini —
		// Ollama runs locally and has no key, so the SDK is unused. Default
		// missing `provider` to 'gemini' so legacy/upgraded users don't fall
		// into the Ollama estimation path with `this.ai` left null.
		const provider = plugin.settings.provider ?? 'gemini';
		this.ai = provider === 'gemini' ? createGoogleGenAI(plugin) : null;
	}

	/**
	 * Signal the start of a new turn. The next updateUsageMetadata call
	 * will accept a lower value (resetting the counter to the new turn's
	 * actual prompt size). Subsequent updates within the turn still use
	 * high-water mark so the counter only goes up during tool calls.
	 */
	beginTurn(): void {
		this.acceptNextLowerUpdate = true;
		this.logger.debug('[ContextManager] Begin turn — will accept next lower update');
	}

	/**
	 * Update the cached usage metadata from an API response.
	 * Uses high-water mark within a turn: only accepts higher promptTokenCount
	 * unless beginTurn() was called (which allows one lower update to reset the baseline).
	 * Use setUsageMetadata() to unconditionally force a value (e.g. after compaction).
	 *
	 * When `modelName` is provided and the active provider is Ollama, this also
	 * calibrates that model's chars-per-token ratio against the real
	 * `promptTokenCount` Ollama just reported (see calibrateOllamaRatio).
	 */
	updateUsageMetadata(metadata: UsageMetadata, modelName?: string): void {
		if (!metadata) return;

		if (modelName && this.plugin.settings.provider === 'ollama') {
			this.calibrateOllamaRatio(modelName, metadata.promptTokenCount);
		}

		const newPrompt = metadata.promptTokenCount ?? 0;
		const cachedPrompt = this.lastUsageMetadata?.promptTokenCount ?? 0;

		if (newPrompt >= cachedPrompt || this.acceptNextLowerUpdate) {
			this.lastUsageMetadata = { ...metadata };
			this.acceptNextLowerUpdate = false;
			this.logger.log(`[ContextManager] Updated usage metadata: ${this.formatUsageForLog(metadata)}`);
		} else {
			this.logger.debug(`[ContextManager] Skipped lower metadata: prompt=${newPrompt} < cached=${cachedPrompt}`);
		}
	}

	/**
	 * Calibrate this model's Ollama chars-per-token ratio from a real response.
	 * Correlates the character length of the most recent countTokens() estimate
	 * for this model (computed just before the request that produced this
	 * response, via prepareHistory) against the response's actual
	 * promptTokenCount, and blends the observed ratio into the running one via
	 * exponential moving average. Requires no extra API call and converges
	 * toward the model's real tokenization over a few turns.
	 */
	private calibrateOllamaRatio(modelName: string, promptTokenCount: number | undefined): void {
		const charLength = this.pendingOllamaEstimateCharLength.get(modelName);
		if (!charLength || !promptTokenCount) return;
		this.pendingOllamaEstimateCharLength.delete(modelName);

		const observedRatio = charLength / promptTokenCount;
		const previousRatio = this.ollamaCharsPerToken.get(modelName) ?? DEFAULT_OLLAMA_CHARS_PER_TOKEN;
		const calibratedRatio =
			previousRatio * (1 - OLLAMA_RATIO_CALIBRATION_WEIGHT) + observedRatio * OLLAMA_RATIO_CALIBRATION_WEIGHT;
		this.ollamaCharsPerToken.set(modelName, calibratedRatio);
		this.logger.debug(
			`[ContextManager] Calibrated Ollama chars/token for ${modelName}: ${previousRatio.toFixed(2)} -> ${calibratedRatio.toFixed(2)}`
		);
	}

	/**
	 * Force-set usage metadata, bypassing the high-water mark check.
	 * Used after compaction or when counting tokens from history.
	 */
	setUsageMetadata(metadata: UsageMetadata): void {
		if (metadata) {
			this.lastUsageMetadata = { ...metadata };
			this.logger.log(`[ContextManager] Force-set usage metadata: ${this.formatUsageForLog(metadata)}`);
		}
	}

	/**
	 * Format usage metadata for a one-line debug log, including cached-prefix
	 * share so cache effectiveness is observable per request.
	 */
	private formatUsageForLog(metadata: UsageMetadata): string {
		const prompt = metadata.promptTokenCount ?? 0;
		const total = metadata.totalTokenCount ?? 0;
		const cached = metadata.cachedContentTokenCount ?? 0;
		const ratio = prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
		return `prompt=${prompt}, total=${total}, cached=${cached} (${ratio}%)`;
	}

	/**
	 * Get the input token limit for a given model.
	 */
	private async getInputTokenLimit(_modelName: string): Promise<number> {
		if (this.plugin.settings.provider === 'ollama') {
			return OLLAMA_DEFAULT_INPUT_TOKEN_LIMIT;
		}
		return DEFAULT_INPUT_TOKEN_LIMIT;
	}

	/**
	 * Get the compaction threshold in tokens based on settings.
	 */
	private async getCompactionThreshold(modelName: string): Promise<number> {
		const inputTokenLimit = await this.getInputTokenLimit(modelName);
		const threshold = this.plugin.settings.contextCompactionThreshold / 100;
		return Math.floor(inputTokenLimit * threshold);
	}

	/**
	 * Get the aggressive compaction threshold in tokens.
	 */
	private async getAggressiveThreshold(modelName: string): Promise<number> {
		const inputTokenLimit = await this.getInputTokenLimit(modelName);
		return Math.floor(inputTokenLimit * (AGGRESSIVE_COMPACTION_THRESHOLD_PERCENT / 100));
	}

	/**
	 * Get current estimated token usage info.
	 */
	async getTokenUsage(modelName: string): Promise<TokenUsageInfo> {
		const inputTokenLimit = await this.getInputTokenLimit(modelName);
		const estimatedTokens = this.lastUsageMetadata?.promptTokenCount ?? 0;
		const cachedTokens = this.lastUsageMetadata?.cachedContentTokenCount ?? 0;
		return {
			estimatedTokens,
			inputTokenLimit,
			percentUsed: inputTokenLimit > 0 ? Math.round((estimatedTokens / inputTokenLimit) * 100 * 10) / 10 : 0,
			cachedTokens,
		};
	}

	/**
	 * Chars-per-token estimate for Ollama, using this model's calibrated ratio
	 * (falling back to the generic default until enough real data has arrived).
	 * Records the char length used so the next updateUsageMetadata() call for
	 * this model can calibrate against it.
	 */
	private estimateTokensFromContents(modelName: string, contents: Content[]): number {
		const json = JSON.stringify(contents ?? []);
		const charsPerToken = this.ollamaCharsPerToken.get(modelName) ?? DEFAULT_OLLAMA_CHARS_PER_TOKEN;
		this.pendingOllamaEstimateCharLength.set(modelName, json.length);
		return Math.ceil(json.length / charsPerToken);
	}

	/**
	 * Sanitize conversation contents for the countTokens API.
	 * The countTokens API only accepts text parts, so we convert
	 * functionCall, functionResponse, and inlineData parts to text descriptions.
	 */
	private sanitizeContentsForTokenCount(contents: Content[]): Content[] {
		const result: Content[] = [];
		for (const entry of contents) {
			if (!entry.parts || !Array.isArray(entry.parts)) {
				// Legacy stored entries may have top-level text/message fields
				// (truthiness precedence: an empty-string `text` falls back to `message`).
				const legacyText = getLegacyEntryTextTruthy(entry);
				if (legacyText) {
					result.push({ role: entry.role || 'user', parts: [{ text: legacyText }] });
				}
				continue;
			}

			const textParts: Part[] = [];
			for (const part of entry.parts) {
				if (part.text) {
					textParts.push({ text: part.text });
				} else if (part.functionCall) {
					textParts.push({
						text: `[Tool call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args || {}).substring(0, 500)})]`,
					});
				} else if (part.functionResponse) {
					const responseStr = JSON.stringify(part.functionResponse.response || {});
					textParts.push({
						text: `[Tool result from ${part.functionResponse.name}: ${responseStr.substring(0, 1000)}]`,
					});
				} else if (part.inlineData) {
					textParts.push({ text: `[Inline attachment: ${part.inlineData.mimeType || 'unknown'}]` });
				}
			}

			if (textParts.length > 0) {
				result.push({ role: entry.role, parts: textParts });
			}
		}
		return result;
	}

	/**
	 * Count tokens for a given set of contents.
	 *
	 * For Gemini, calls the SDK's countTokens endpoint. For Ollama (which has no
	 * equivalent API) we fall back to a chars-per-token estimate, seeded at 4
	 * and calibrated per-model from real promptTokenCount values as they arrive
	 * (see calibrateOllamaRatio) — compaction precision improves as the session
	 * progresses instead of staying pinned to the generic heuristic.
	 */
	async countTokens(modelName: string, contents: Content[]): Promise<number> {
		// Sanitize contents to only include text-compatible parts
		const sanitizedContents = this.sanitizeContentsForTokenCount(contents);

		if (this.plugin.settings.provider === 'ollama' || !this.ai) {
			const estimate = this.estimateTokensFromContents(modelName, sanitizedContents);
			this.logger.log(`[ContextManager] countTokens (Ollama estimate): ${estimate}`);
			return estimate;
		}

		try {
			const response = await executeWithRetry(
				() =>
					this.ai!.models.countTokens({
						// countTokens is a generateContent-family endpoint; for an
						// interactions-only model, count against the bundled default
						// instead — tokenization is close enough for compaction
						// thresholds, and the real call would 400.
						model: resolveGenerateContentModel(modelName),
						contents: sanitizedContents,
					}),
				undefined,
				{ operationName: 'ContextManager.countTokens', logger: this.logger }
			);

			const totalTokens = response.totalTokens ?? 0;
			this.logger.log(`[ContextManager] countTokens result: ${totalTokens}`);
			return totalTokens;
		} catch (error) {
			this.logger.error('[ContextManager] countTokens failed:', error);
			// Fall back to estimate from last usage metadata
			return this.lastUsageMetadata?.promptTokenCount ?? 0;
		}
	}

	/**
	 * Check if compaction is needed and perform it if so.
	 *
	 * This is the main entry point called before each API request — including
	 * mid-loop, after each tool batch in `AgentLoop`, so long tool chains don't
	 * overflow the context window. `options.protectFromIndex` marks the start
	 * of the caller's protected suffix (e.g. the current agent-loop's turns,
	 * which carry `functionCall`/`thoughtSignature` continuity that summarization
	 * must never touch); entries at or after that index are never folded into
	 * the summary. It uses cached usageMetadata from the last API response to
	 * decide whether compaction is needed; the compaction decision itself does
	 * not call countTokens() (that only happens after compaction, to measure
	 * the result size), but for Ollama every call still seeds the pending
	 * chars-per-token calibration estimate for this model — see the note at
	 * the top of the method body.
	 */
	async prepareHistory(
		conversationHistory: Content[],
		modelName: string,
		options?: { protectFromIndex?: number }
	): Promise<CompactionResult> {
		const protectFromIndex = options?.protectFromIndex;
		const estimatedTokens = this.lastUsageMetadata?.promptTokenCount ?? 0;

		// prepareHistory() runs immediately before every outgoing request, so this
		// is the char length that will correlate with the next real
		// promptTokenCount for this model — seed it unconditionally (not just on
		// the compaction path below, which only runs when over threshold) so
		// calibrateOllamaRatio() has something to calibrate against on ordinary
		// turns too. The returned estimate itself isn't needed here.
		if (this.plugin.settings.provider === 'ollama') {
			this.estimateTokensFromContents(modelName, this.sanitizeContentsForTokenCount(conversationHistory));
		}

		// Short-circuit for very short conversations
		if (conversationHistory.length <= MIN_RECENT_TURNS_TO_KEEP) {
			return {
				compactedHistory: conversationHistory,
				wasCompacted: false,
				estimatedTokens,
			};
		}

		// No cached metadata — can't determine if we're over threshold (e.g., first message)
		if (estimatedTokens === 0) {
			this.logger.log('[ContextManager] No cached token usage, skipping compaction');
			return {
				compactedHistory: conversationHistory,
				wasCompacted: false,
				estimatedTokens: 0,
			};
		}

		const compactionThreshold = await this.getCompactionThreshold(modelName);

		// Under threshold: do nothing. In particular, do **not** truncate
		// older tool-result turns. Truncation modifies older history bytes,
		// which invalidates Gemini's implicit prefix cache from that point
		// forward — those bytes get billed at full input rate this turn
		// instead of the cached rate. Below threshold, that "cache-miss tax"
		// is pure waste: we could have served subsequent turns at the
		// discounted rate without any structural change. So truncation only
		// fires when we'd otherwise compact (compaction already breaks the
		// cache, so truncation rides along for free). See #763.
		if (estimatedTokens < compactionThreshold) {
			this.logger.log(
				`[ContextManager] Under threshold (${estimatedTokens} < ${compactionThreshold}), skipping compaction`
			);
			return {
				compactedHistory: conversationHistory,
				wasCompacted: false,
				estimatedTokens,
			};
		}

		// Over threshold — multi-phase compaction.
		//
		// Phase 1: try truncating old tool-result payloads. Cheap (no LLM
		// call), deterministic, and often enough on its own when a single big
		// `read_file` is responsible for most of the bloat. We reuse the
		// existing 4-chars-per-token heuristic to estimate the post-truncation
		// size without spending a `countTokens` roundtrip.
		//
		// Phase 2: if truncation alone didn't get us back under threshold, fall
		// through to summarization. Summarization runs against the truncated
		// history (so the compactor isn't paying to re-serialize content that
		// already got elided to markers).
		const truncatedHistory = truncateOldToolResults(conversationHistory);
		let postPhase1Tokens = estimatedTokens;
		if (truncatedHistory !== conversationHistory) {
			const truncationDelta = JSON.stringify(conversationHistory).length - JSON.stringify(truncatedHistory).length;
			if (truncationDelta > 0) {
				this.logger.log(`[ContextManager] Phase 1 (truncation): shed ~${truncationDelta} bytes from old tool results`);
				postPhase1Tokens = Math.max(0, estimatedTokens - Math.ceil(truncationDelta / 4));
			}
		}

		if (postPhase1Tokens < compactionThreshold) {
			this.logger.log(
				`[ContextManager] Phase 1 sufficient (${postPhase1Tokens} < ${compactionThreshold}); skipping summarization`
			);
			// Force-set even though wasCompacted is false: truncation may have
			// genuinely lowered the estimate, and updateUsageMetadata's
			// high-water mark would otherwise reject the next (accurate, lower)
			// API-reported count for the rest of this turn, leaving the cache
			// stuck on the stale pre-truncation figure.
			this.setUsageMetadata({ promptTokenCount: postPhase1Tokens, totalTokenCount: postPhase1Tokens });
			return {
				compactedHistory: truncatedHistory,
				wasCompacted: false,
				estimatedTokens: postPhase1Tokens,
			};
		}

		// Phase 2: still over threshold — perform full summarization compaction.
		this.logger.log(
			`[ContextManager] Phase 2 (summarization): still over threshold (${postPhase1Tokens} >= ${compactionThreshold}) after truncation`
		);

		const aggressiveThreshold = await this.getAggressiveThreshold(modelName);
		const isAggressive = postPhase1Tokens >= aggressiveThreshold;
		const result = await this.compactHistory(truncatedHistory, modelName, isAggressive, protectFromIndex);

		if (!result) {
			// Nothing old enough to summarize — the protected suffix (e.g. the
			// current agent-loop's turns) covers the whole history. Truncation
			// (phase 1) still applies; summarization is a no-op this call.
			this.logger.log('[ContextManager] Protected region covers entire history; skipping summarization');
			// Same force-set rationale as the phase-1-sufficient branch above.
			this.setUsageMetadata({ promptTokenCount: postPhase1Tokens, totalTokenCount: postPhase1Tokens });
			return {
				compactedHistory: truncatedHistory,
				wasCompacted: false,
				estimatedTokens: postPhase1Tokens,
			};
		}

		// Verify the compacted history is smaller
		const compactedTokens = await this.countTokens(modelName, result.compactedHistory);
		this.logger.log(
			`[ContextManager] Compaction complete: ${estimatedTokens} -> ${compactedTokens} tokens (${isAggressive ? 'aggressive' : 'normal'})`
		);

		return {
			compactedHistory: result.compactedHistory,
			wasCompacted: true,
			estimatedTokens: compactedTokens,
			summaryText: result.summaryText,
		};
	}

	/**
	 * Perform the actual compaction: split history, summarize old turns,
	 * and return the compacted history. Returns `null` when there's nothing
	 * old enough to summarize (the protected suffix covers the whole history).
	 */
	private async compactHistory(
		conversationHistory: Content[],
		modelName: string,
		aggressive: boolean,
		protectFromIndex?: number
	): Promise<{ compactedHistory: Content[]; summaryText: string } | null> {
		const totalTurns = conversationHistory.length;

		// Determine how many recent turns to keep
		const recentTurnsToKeep = aggressive
			? Math.min(AGGRESSIVE_RECENT_TURNS, totalTurns - 1)
			: Math.max(MIN_RECENT_TURNS_TO_KEEP, Math.floor(totalTurns * RECENT_TURNS_RATIO));

		let splitIndex = totalTurns - recentTurnsToKeep;

		// Never fold the protected suffix (e.g. the current agent-loop's turns,
		// which carry live functionCall/thoughtSignature continuity) into the
		// summary — clamp the split to stay strictly before it.
		if (protectFromIndex !== undefined) {
			splitIndex = Math.min(splitIndex, protectFromIndex);
		}

		// Ensure we don't split in the middle of a tool exchange (functionCall/functionResponse pair)
		// Scan backward to find a safe boundary at the start of a user turn
		// History entries may use parts[].text (API format) or message (stored format)
		while (splitIndex > 0 && splitIndex < totalTurns) {
			const entry = conversationHistory[splitIndex];
			if (entry.role === 'user' && (entry.parts?.[0]?.text || getLegacyEntryTextTruthy(entry))) {
				break;
			}
			splitIndex--;
		}

		if (splitIndex <= 0) {
			return null;
		}

		// Split into old (to summarize) and recent (to keep verbatim)
		const oldTurns = conversationHistory.slice(0, splitIndex);
		const recentTurns = conversationHistory.slice(splitIndex);

		this.logger.log(
			`[ContextManager] Splitting history: ${oldTurns.length} turns to summarize, ${recentTurns.length} to keep`
		);

		// Generate summary of old turns
		const summaryText = await this.summarizeConversation(oldTurns, modelName);

		// Build compacted history: summary entry + recent turns
		const summaryEntry = {
			role: 'user',
			parts: [
				{
					text: `${CONTEXT_SUMMARY_MARKER}\nThe following is a summary of the earlier part of this conversation:\n\n${summaryText}\n\n---\nThe conversation continues below with the most recent exchanges.`,
				},
			],
		};

		// We need model acknowledgment after the summary to maintain valid turn structure
		const summaryAck = {
			role: 'model',
			parts: [
				{
					text: 'I understand. I have the context from the conversation summary above and will continue the conversation based on that context.',
				},
			],
		};

		const compactedHistory = [summaryEntry, summaryAck, ...recentTurns];

		return {
			compactedHistory,
			summaryText,
		};
	}

	/**
	 * Generate a summary of conversation turns using Gemini.
	 */
	private async summarizeConversation(turns: Content[], modelName: string): Promise<string> {
		// Convert turns to readable text for summarization
		const conversationText = turns
			.map((turn) => {
				const role = turn.role === 'user' ? 'User' : 'Assistant';
				let text = '';

				if (turn.parts && Array.isArray(turn.parts)) {
					text = turn.parts
						.map((part: Part) => {
							if (part.text) return part.text;
							if (part.functionCall) return `[Called tool: ${part.functionCall.name}]`;
							if (part.functionResponse) return `[Tool result from: ${part.functionResponse.name}]`;
							return '';
						})
						.filter(Boolean)
						.join('\n');
				} else {
					// Legacy stored format: top-level text or message fields
					// (truthiness precedence: an empty-string `text` falls back to `message`).
					const legacyText = getLegacyEntryTextTruthy(turn);
					if (legacyText) {
						text = legacyText;
					}
				}

				if (!text.trim()) return '';
				return `${role}: ${text}`;
			})
			.filter(Boolean)
			.join('\n\n');

		const summaryPrompt = contextSummaryPromptContent;
		const fullPrompt = `${summaryPrompt}\n\n---\n\nConversation to summarize:\n\n${conversationText}`;

		try {
			// Ollama has no SDK instance here; route through the factory so we use
			// whichever provider the user has configured. An interactions-only
			// model also goes through the factory (its summary client routes
			// interactions-only models via the Interactions API) since the direct
			// generateContent call below would 400.
			if (this.plugin.settings.provider === 'ollama' || !this.ai || isInteractionsOnlyModel(modelName)) {
				// Pass ModelUseCase.SUMMARY to the factory and let its
				// resolveModelName populate the request — overriding `model`
				// here would route compaction through the chat model on Ollama
				// (where the client honours request.model over config.model)
				// instead of the user's configured `summaryModelName`.
				const summaryClient = ModelClientFactory.createFromPlugin(this.plugin, ModelUseCase.SUMMARY);
				const response = await summaryClient.generateModelResponse({
					kind: 'base',
					prompt: fullPrompt,
					temperature: 0.3,
				});
				const summary = response.markdown?.trim();
				if (!summary) {
					this.logger.warn('[ContextManager] Summary generation returned empty result');
					return 'Previous conversation context could not be summarized. The conversation continues below.';
				}
				return summary;
			}

			const response = await executeWithRetry(
				() =>
					this.ai!.models.generateContent({
						model: modelName,
						contents: fullPrompt,
						config: {
							temperature: 0.3, // Low temperature for factual summarization
							maxOutputTokens: 4096,
						},
					}),
				undefined,
				{ operationName: 'ContextManager.generateSummaryContent', logger: this.logger }
			);

			const summary = response.candidates?.[0]?.content?.parts
				?.map((part) => ('text' in part && part.text ? part.text : ''))
				.join('');

			if (!summary?.trim()) {
				this.logger.warn('[ContextManager] Summary generation returned empty result');
				return 'Previous conversation context could not be summarized. The conversation continues below.';
			}

			return summary.trim();
		} catch (error) {
			this.logger.error('[ContextManager] Failed to generate summary:', error);
			return 'Previous conversation context could not be summarized due to an error. The conversation continues below.';
		}
	}

	/**
	 * Reset the cached usage metadata (e.g., when starting a new session).
	 */
	reset(): void {
		this.lastUsageMetadata = null;
		this.logger.debug('[ContextManager] Usage metadata reset');
	}
}
