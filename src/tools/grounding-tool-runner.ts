import { ToolResult } from './types';
import type { ObsidianGemini } from '../types/plugin';
import { resolveGenerateContentModel } from '../models';
import { createGoogleGenAI } from '../api/providers/gemini/google-genai-factory';
import { executeWithRetry } from '../utils/retry';
import { getRawErrorMessage } from '../utils/error-utils';
import type { GroundingChunk } from '@google/genai';

/**
 * Citation fields pulled from a single grounding chunk. Each Gemini grounding
 * source stores its evidence under a different subkey (`chunk.web` for Google
 * Search, `chunk.maps` for Google Maps), so the caller supplies a
 * {@link GroundingToolRequest.getChunkCitation} accessor that normalizes the
 * provider-specific shape into these common fields.
 */
export interface GroundingCitationFields {
	uri?: string;
	title?: string;
	snippet?: string;
}

/**
 * Everything a specific grounding tool (Google Search, Google Maps, …) needs to
 * feed into the shared {@link runGroundingTool} pipeline. Only the provider-specific
 * pieces live here; the API-key guard, client construction, retry, text
 * extraction, and reverse-sorted citation splicing are shared.
 */
export interface GroundingToolRequest {
	/** The user's raw query. */
	query: string;
	/** The grounding tool config object passed to `generateContent`, e.g. `{ googleSearch: {} }`. */
	groundingTool: object;
	/** Pull the citation fields out of a grounding chunk (reads `chunk.web` vs `chunk.maps`). */
	getChunkCitation(chunk: GroundingChunk): GroundingCitationFields;
	/** Prefix prepended to the query to form the model prompt (include any trailing separator). */
	promptPrefix: string;
	/** Prefix for the error message on failure (include any trailing separator), e.g. `'Google search failed: '`. */
	errorPrefix: string;
	/** Operation name used for retry/logging telemetry. */
	operationName: string;
}

/**
 * Shared execution pipeline for Gemini "grounding" tools that answer a query by
 * grounding the response in an external source (web search, Maps, …).
 *
 * Runs a single `generateContent` call with the given grounding tool enabled,
 * extracts the answer text, collects citations from `groundingMetadata`, and
 * splices inline `[n](url)` links into the answer by walking `groundingSupports`
 * in descending `endIndex` order so earlier insertions don't shift later offsets.
 *
 * `GoogleSearchTool` and `GoogleMapsTool` are thin wrappers over this helper; the
 * only differences between them are captured in {@link GroundingToolRequest}.
 */
export async function runGroundingTool(plugin: ObsidianGemini, req: GroundingToolRequest): Promise<ToolResult> {
	try {
		// Check if API key is available
		if (!plugin.apiKey) {
			return {
				success: false,
				error: 'Google API key not configured',
			};
		}

		// Create a separate model instance with the requested grounding tool enabled.
		// Grounding runs on generateContent, so an interactions-only chat model is
		// swapped for the bundled default instead of hard-failing with a 400.
		const genAI = createGoogleGenAI(plugin);
		const modelToUse = resolveGenerateContentModel(plugin.settings.chatModelName);
		const config = {
			temperature: plugin.settings.temperature,
			maxOutputTokens: 8192, // Default max tokens
			tools: [req.groundingTool],
		};

		const prompt = `${req.promptPrefix}${req.query}`;

		const result = await executeWithRetry(
			() =>
				genAI.models.generateContent({
					model: modelToUse,
					config: config,
					contents: prompt,
				}),
			undefined,
			{ operationName: req.operationName, logger: plugin.logger }
		);

		// Extract text from response
		let text = '';
		if (result.candidates?.[0]?.content?.parts) {
			for (const part of result.candidates[0].content.parts) {
				if (part.text) {
					text += part.text;
				}
			}
		} else if (result.text) {
			// The text property might be a getter, not a function
			try {
				text = result.text;
			} catch (e) {
				// If it fails, it might be a legacy format
				plugin.logger.warn('Failed to get text from result:', e);
			}
		}

		// Extract grounding metadata and citations if available
		const groundingMetadata = result.candidates?.[0]?.groundingMetadata;
		let citations: Array<{ title?: string; url: string; snippet?: string }> = [];
		let textWithCitations = text;

		if (groundingMetadata?.groundingChunks) {
			const chunks = groundingMetadata.groundingChunks;
			citations = chunks
				.map((chunk) => req.getChunkCitation(chunk))
				.filter((citation): citation is GroundingCitationFields & { uri: string } => Boolean(citation.uri))
				.map((citation) => ({
					url: citation.uri,
					title: citation.title || citation.uri,
					snippet: citation.snippet || '',
				}));

			// Add inline citations to text if supports are available
			if (groundingMetadata.groundingSupports) {
				const supports = groundingMetadata.groundingSupports;
				// Sort supports by end_index in descending order so insertions don't shift later offsets
				const sortedSupports = [...supports].sort((a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0));

				for (const support of sortedSupports) {
					const endIndex = support.segment?.endIndex;
					if (endIndex === undefined || !support.groundingChunkIndices?.length) {
						continue;
					}

					const citationLinks = support.groundingChunkIndices
						.map((i) => {
							const chunk = chunks[i];
							const uri = chunk ? req.getChunkCitation(chunk).uri : undefined;
							if (uri) {
								return `[${i + 1}](${uri})`;
							}
							return null;
						})
						.filter(Boolean);

					if (citationLinks.length > 0) {
						const citationString = ` ${citationLinks.join(', ')}`;
						textWithCitations =
							textWithCitations.slice(0, endIndex) + citationString + textWithCitations.slice(endIndex);
					}
				}
			}
		}

		return {
			success: true,
			data: {
				query: req.query,
				answer: textWithCitations, // Text with inline citations
				originalAnswer: text, // Original text without citations
				citations: citations,
				searchGrounding: groundingMetadata || undefined,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: `${req.errorPrefix}${getRawErrorMessage(error)}`,
		};
	}
}
