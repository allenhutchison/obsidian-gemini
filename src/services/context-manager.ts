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

import { GoogleGenAI } from '@google/genai';
import { Logger } from '../utils/logger';
import type ObsidianGemini from '../main';
import { GeminiClientFactory, ModelUseCase } from '../api/simple-factory';
import { truncateOldToolResults } from '../agent/agent-loop-helpers';

// @ts-ignore
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
 * Rough token-count estimate for providers that don't expose a countTokens
 * endpoint (Ollama). Char/4 is the standard heuristic; drift vs. real tokens
 * is acceptable here because we only use it to decide whether to compact.
 */
function estimateTokensFromContents(contents: any[]): number {
	const json = JSON.stringify(contents ?? []);
	return Math.ceil(json.length / 4);
}

/** Minimum number of recent turns to preserve during compaction */
const MIN_RECENT_TURNS_TO_KEEP = 6;

/** Maximum number of recent turns to preserve during normal compaction (~30%) */
const RECENT_TURNS_RATIO = 0.3;

/** Minimum turns to keep during aggressive compaction */
const AGGRESSIVE_RECENT_TURNS = 5;

/** Marker prefix for summary entries in conversation history */
export const CONTEXT_SUMMARY_MARKER = '[Context Summary]';

export interface CompactionResult {
	/** The compacted history array ready to send to the API */
	compactedHistory: any[];
	/** Whether compaction was performed */
	wasCompacted: boolean;
	/** Current estimated token count */
	estimatedTokens: number;
	/** Summary text that was generated (if compacted) */
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

	constructor(
		private plugin: ObsidianGemini,
		private logger: Logger
	) {
		// Only construct the Gemini SDK when the active provider is Gemini —
		// Ollama runs locally and has no key, so the SDK is unused. Default
		// missing `provider` to 'gemini' so legacy/upgraded users don't fall
		// into the Ollama estimation path with `this.ai` left null.
		const provider = plugin.settings.provider ?? 'gemini';
		this.ai = provider === 'gemini' ? new GoogleGenAI({ apiKey: plugin.apiKey }) : null;
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
	 */
	updateUsageMetadata(metadata: UsageMetadata): void {
		if (!metadata) return;

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
	 * Sanitize conversation contents for the countTokens API.
	 * The countTokens API only accepts text parts, so we convert
	 * functionCall, functionResponse, and inlineData parts to text descriptions.
	 */
	private sanitizeContentsForTokenCount(contents: any[]): any[] {
		return contents
			.map((entry) => {
				if (!entry.parts || !Array.isArray(entry.parts)) {
					// If there's a direct text or message field, convert it
					if (entry.text) return { role: entry.role || 'user', parts: [{ text: entry.text }] };
					if (entry.message) return { role: entry.role || 'user', parts: [{ text: entry.message }] };
					return null;
				}

				const textParts = entry.parts
					.map((part: any) => {
						if (part.text) return { text: part.text };
						if (part.functionCall) {
							return {
								text: `[Tool call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args || {}).substring(0, 500)})]`,
							};
						}
						if (part.functionResponse) {
							const responseText =
								typeof part.functionResponse.response === 'string'
									? part.functionResponse.response.substring(0, 1000)
									: JSON.stringify(part.functionResponse.response || {}).substring(0, 1000);
							return { text: `[Tool result from ${part.functionResponse.name}: ${responseText}]` };
						}
						if (part.inlineData) {
							return { text: `[Inline attachment: ${part.inlineData.mimeType || 'unknown'}]` };
						}
						// Skip any other unknown part types
						return null;
					})
					.filter(Boolean);

				if (textParts.length === 0) return null;
				return { role: entry.role, parts: textParts };
			})
			.filter(Boolean);
	}

	/**
	 * Count tokens for a given set of contents.
	 *
	 * For Gemini, calls the SDK's countTokens endpoint. For Ollama (which has no
	 * equivalent API) we fall back to a chars/4 estimate — compaction precision
	 * is degraded but the trigger logic still works.
	 */
	async countTokens(modelName: string, contents: any[]): Promise<number> {
		// Sanitize contents to only include text-compatible parts
		const sanitizedContents = this.sanitizeContentsForTokenCount(contents);

		if (this.plugin.settings.provider === 'ollama' || !this.ai) {
			const estimate = estimateTokensFromContents(sanitizedContents);
			this.logger.log(`[ContextManager] countTokens (Ollama estimate): ${estimate}`);
			return estimate;
		}

		try {
			const config: any = {};
			const response = await this.ai.models.countTokens({
				model: modelName,
				contents: sanitizedContents,
				config: Object.keys(config).length > 0 ? config : undefined,
			});

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
	 * This is the main entry point called before each API request.
	 * It uses cached usageMetadata from the last API response to decide
	 * whether compaction is needed. countTokens() is only called after
	 * compaction to measure the result size.
	 */
	async prepareHistory(conversationHistory: any[], modelName: string): Promise<CompactionResult> {
		const estimatedTokens = this.lastUsageMetadata?.promptTokenCount ?? 0;

		// Shed bloat from old tool-result turns (e.g., big `read_file` payloads)
		// before any threshold check. This is cheap, deterministic, always-helpful,
		// and often keeps a session below the compaction threshold long enough
		// that the (more expensive) summarization pass never runs. The most
		// recent few tool-result turns are left intact — see truncateOldToolResults
		// for defaults. Tracked under #763.
		const truncatedHistory = truncateOldToolResults(conversationHistory);
		const truncationDelta = JSON.stringify(conversationHistory).length - JSON.stringify(truncatedHistory).length;
		if (truncationDelta > 0) {
			this.logger.log(`[ContextManager] Truncated old tool results: shed ~${truncationDelta} bytes from history`);
		}

		// Short-circuit for very short conversations
		if (truncatedHistory.length <= MIN_RECENT_TURNS_TO_KEEP) {
			return {
				compactedHistory: truncatedHistory,
				wasCompacted: false,
				estimatedTokens,
			};
		}

		// No cached metadata — can't determine if we're over threshold (e.g., first message)
		if (estimatedTokens === 0) {
			this.logger.log('[ContextManager] No cached token usage, skipping compaction');
			return {
				compactedHistory: truncatedHistory,
				wasCompacted: false,
				estimatedTokens: 0,
			};
		}

		const compactionThreshold = await this.getCompactionThreshold(modelName);

		if (estimatedTokens < compactionThreshold) {
			this.logger.log(
				`[ContextManager] Under threshold (${estimatedTokens} < ${compactionThreshold}), skipping compaction`
			);
			return {
				compactedHistory: truncatedHistory,
				wasCompacted: false,
				estimatedTokens,
			};
		}

		// Over threshold — perform compaction
		this.logger.log(`[ContextManager] Over threshold (${estimatedTokens} >= ${compactionThreshold}), compacting...`);

		const aggressiveThreshold = await this.getAggressiveThreshold(modelName);
		const isAggressive = estimatedTokens >= aggressiveThreshold;
		const result = await this.compactHistory(truncatedHistory, modelName, isAggressive);

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
	 * and return the compacted history.
	 */
	private async compactHistory(
		conversationHistory: any[],
		modelName: string,
		aggressive: boolean
	): Promise<{ compactedHistory: any[]; summaryText: string }> {
		const totalTurns = conversationHistory.length;

		// Determine how many recent turns to keep
		const recentTurnsToKeep = aggressive
			? Math.min(AGGRESSIVE_RECENT_TURNS, totalTurns - 1)
			: Math.max(MIN_RECENT_TURNS_TO_KEEP, Math.floor(totalTurns * RECENT_TURNS_RATIO));

		let splitIndex = totalTurns - recentTurnsToKeep;

		// Ensure we don't split in the middle of a tool exchange (functionCall/functionResponse pair)
		// Scan backward to find a safe boundary at the start of a user turn
		// History entries may use parts[].text (API format) or message (stored format)
		while (splitIndex > 0 && splitIndex < totalTurns) {
			const entry = conversationHistory[splitIndex];
			if (entry.role === 'user' && (entry.parts?.[0]?.text || entry.message || entry.text)) {
				break;
			}
			splitIndex--;
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
	private async summarizeConversation(turns: any[], modelName: string): Promise<string> {
		// Convert turns to readable text for summarization
		const conversationText = turns
			.map((turn) => {
				const role = turn.role === 'user' ? 'User' : 'Assistant';
				let text = '';

				if (turn.parts && Array.isArray(turn.parts)) {
					text = turn.parts
						.map((part: any) => {
							if (part.text) return part.text;
							if (part.functionCall) return `[Called tool: ${part.functionCall.name}]`;
							if (part.functionResponse) return `[Tool result from: ${part.functionResponse.name}]`;
							return '';
						})
						.filter(Boolean)
						.join('\n');
				} else if (turn.text) {
					text = turn.text;
				} else if (turn.message) {
					text = turn.message;
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
			// whichever provider the user has configured.
			if (this.plugin.settings.provider === 'ollama' || !this.ai) {
				// Pass ModelUseCase.SUMMARY to the factory and let its
				// resolveModelName populate the request — overriding `model`
				// here would route compaction through the chat model on Ollama
				// (where the client honours request.model over config.model)
				// instead of the user's configured `summaryModelName`.
				const summaryClient = GeminiClientFactory.createFromPlugin(this.plugin, ModelUseCase.SUMMARY);
				const response = await summaryClient.generateModelResponse({
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

			const response = await this.ai.models.generateContent({
				model: modelName,
				contents: fullPrompt,
				config: {
					temperature: 0.3, // Low temperature for factual summarization
					maxOutputTokens: 4096,
				},
			});

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
