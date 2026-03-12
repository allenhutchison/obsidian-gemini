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
import { ToolDefinition } from '../api/interfaces/model-api';
import { Logger } from '../utils/logger';
import type ObsidianGemini from '../main';

// @ts-ignore
import contextSummaryPromptContent from '../../prompts/contextSummaryPrompt.txt';

/** Aggressive compaction triggers at this % of total model context window */
const AGGRESSIVE_COMPACTION_THRESHOLD_PERCENT = 80;

/** Default model input token limit (1M for all current Gemini models) */
const DEFAULT_INPUT_TOKEN_LIMIT = 1_000_000;

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
}

export interface UsageMetadata {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	totalTokenCount?: number;
}

/**
 * ContextManager monitors token usage and compacts conversation history
 * when it approaches configurable thresholds.
 */
export class ContextManager {
	private lastUsageMetadata: UsageMetadata | null = null;
	private ai: GoogleGenAI;

	constructor(
		private plugin: ObsidianGemini,
		private logger: Logger
	) {
		this.ai = new GoogleGenAI({ apiKey: plugin.apiKey });
	}

	/**
	 * Update the cached usage metadata from an API response.
	 * This is essentially free — metadata comes with every response.
	 */
	updateUsageMetadata(metadata: UsageMetadata): void {
		if (metadata) {
			this.lastUsageMetadata = { ...metadata };
			this.logger.log(
				`[ContextManager] Updated usage metadata: prompt=${metadata.promptTokenCount}, total=${metadata.totalTokenCount}`
			);
		}
	}

	/**
	 * Get the input token limit for a given model.
	 * Uses ModelDiscoveryService cache if available, otherwise falls back to default.
	 */
	private async getInputTokenLimit(modelName: string): Promise<number> {
		try {
			const modelManager = this.plugin.getModelManager();
			const discoveredModels = await modelManager.getDiscoveredModels();
			if (discoveredModels.length > 0) {
				const model = discoveredModels.find(
					(m) => m.name === `models/${modelName}` || m.name === modelName || m.displayName === modelName
				);
				if (model?.inputTokenLimit) {
					return model.inputTokenLimit;
				}
			}
		} catch (error) {
			this.logger.warn('[ContextManager] Failed to get model token limit from discovery:', error);
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
		return {
			estimatedTokens,
			inputTokenLimit,
			percentUsed: inputTokenLimit > 0 ? Math.round((estimatedTokens / inputTokenLimit) * 100 * 10) / 10 : 0,
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
	 * Count tokens for a given set of contents using the Gemini API.
	 */
	async countTokens(modelName: string, contents: any[]): Promise<number> {
		try {
			const config: any = {};

			// Sanitize contents to only include text-compatible parts
			const sanitizedContents = this.sanitizeContentsForTokenCount(contents);

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
	 * It uses cached usageMetadata for fast estimates, and only calls
	 * countTokens() for precise counts when approaching the threshold.
	 */
	async prepareHistory(
		conversationHistory: any[],
		modelName: string,
		systemInstruction?: string,
		tools?: ToolDefinition[]
	): Promise<CompactionResult> {
		// Short-circuit for very short conversations
		if (conversationHistory.length <= MIN_RECENT_TURNS_TO_KEEP) {
			return {
				compactedHistory: conversationHistory,
				wasCompacted: false,
				estimatedTokens: this.lastUsageMetadata?.promptTokenCount ?? 0,
			};
		}

		const compactionThreshold = await this.getCompactionThreshold(modelName);
		const aggressiveThreshold = await this.getAggressiveThreshold(modelName);

		// Phase 1: Use cached usageMetadata for a quick estimate
		let estimatedTokens = this.lastUsageMetadata?.promptTokenCount ?? 0;

		if (estimatedTokens > 0 && estimatedTokens < compactionThreshold * 0.8) {
			// Well under threshold — no need to do anything
			this.logger.log(
				`[ContextManager] Under threshold (${estimatedTokens} < ${Math.floor(compactionThreshold * 0.8)}), skipping compaction`
			);
			return {
				compactedHistory: conversationHistory,
				wasCompacted: false,
				estimatedTokens,
			};
		}

		// Phase 2: Approaching threshold or no estimate — do a precise count
		this.logger.log('[ContextManager] Approaching threshold, performing precise token count...');
		estimatedTokens = await this.countTokens(modelName, conversationHistory);

		if (estimatedTokens < compactionThreshold) {
			this.logger.log(
				`[ContextManager] Under threshold after precise count (${estimatedTokens} < ${compactionThreshold}), skipping`
			);
			return {
				compactedHistory: conversationHistory,
				wasCompacted: false,
				estimatedTokens,
			};
		}

		// Phase 3: Over threshold — perform compaction
		this.logger.log(`[ContextManager] Over threshold (${estimatedTokens} >= ${compactionThreshold}), compacting...`);

		const isAggressive = estimatedTokens >= aggressiveThreshold;
		const result = await this.compactHistory(conversationHistory, modelName, isAggressive);

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
		while (splitIndex > 0 && splitIndex < totalTurns) {
			const entry = conversationHistory[splitIndex];
			// Safe to split if this entry is a user message (starts a new turn)
			if (entry.role === 'user' && entry.parts?.[0]?.text) {
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

		try {
			const response = await this.ai.models.generateContent({
				model: modelName,
				contents: `${summaryPrompt}\n\n---\n\nConversation to summarize:\n\n${conversationText}`,
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
	}
}
