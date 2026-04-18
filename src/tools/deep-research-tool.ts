import { normalizePath } from 'obsidian';
import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import type ObsidianGemini from '../main';
import { ResearchScope } from '../services/deep-research';

/**
 * Deep Research Tool that conducts comprehensive research using Google's Deep Research API
 * and generates a well-cited report. Supports vault-only, web-only, or combined research.
 */
export class DeepResearchTool implements Tool {
	name = 'deep_research';
	displayName = 'Deep Research';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.EXTERNAL;
	description =
		'Conduct comprehensive research on a topic and generate a well-structured markdown report with citations. ' +
		'Can search your vault notes (via RAG), the web, or both. ' +
		'Use scope="vault_only" to synthesize existing notes, ' +
		'scope="web_only" for internet research, or scope="both" (default) for comprehensive research. ' +
		'Use this for broad research questions requiring synthesis across multiple sources. ' +
		'For quick factual lookups, prefer google_search instead. ' +
		'WARNING: This tool may take several minutes to complete. ' +
		'Set background=true to submit the research as a background task and return immediately — ' +
		'the report is written to output_file when complete and you can read it later with read_file.';
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			topic: {
				type: 'string' as const,
				description: 'The research topic or question',
			},
			scope: {
				type: 'string' as const,
				enum: ['vault_only', 'web_only', 'both'],
				description: 'Research scope: vault_only (your notes), web_only (internet), or both (default)',
			},
			outputFile: {
				type: 'string' as const,
				description:
					'Path for the output report file (optional). When background=true, the report is written here when complete — provide this so you know where to read the result.',
			},
			background: {
				type: 'boolean' as const,
				description:
					'When true, submit as a background task and return immediately with { taskId, output_file }. ' +
					'Use this when research is one step in a larger plan and you want to continue other work in parallel. ' +
					'Read the result later with read_file once the task completes.',
			},
		},
		required: ['topic'],
	};

	confirmationMessage = (params: { topic: string; scope?: ResearchScope }) => {
		const scopeText =
			params.scope === 'vault_only'
				? ' using vault notes only'
				: params.scope === 'web_only'
					? ' using web search only'
					: ' using vault and web';
		return `Conduct deep research on: "${params.topic}"${scopeText}`;
	};

	getProgressDescription(params: { topic: string; scope?: ResearchScope }): string {
		if (params.topic) {
			const topic = params.topic.length > 25 ? params.topic.substring(0, 22) + '...' : params.topic;
			const scopeText = params.scope === 'vault_only' ? ' (vault)' : params.scope === 'web_only' ? ' (web)' : '';
			return `Researching "${topic}"${scopeText}`;
		}
		return 'Conducting research';
	}

	async execute(
		params: { topic: string; scope?: ResearchScope; outputFile?: string; background?: boolean },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as ObsidianGemini;

		try {
			// Validate parameters
			if (!params.topic || typeof params.topic !== 'string' || params.topic.trim().length === 0) {
				return {
					success: false,
					error: 'Topic is required and must be a non-empty string',
				};
			}

			// Check if deep research service is available
			if (!plugin.deepResearch) {
				return {
					success: false,
					error: 'Deep research service not available',
				};
			}

			// Ensure .md extension if outputFile is provided
			let outputFile = params.outputFile;
			if (outputFile && !outputFile.endsWith('.md')) {
				outputFile += '.md';
			}

			// ── Background mode ──────────────────────────────────────────────────
			if (params.background) {
				if (!plugin.backgroundTaskManager) {
					return { success: false, error: 'Background task manager not available' };
				}

				// Resolve the output path upfront so the agent knows where to read results.
				// If the caller didn't specify one, generate a timestamped path inside the
				// plugin state folder's background-tasks directory.
				const resolvedOutputFile =
					outputFile ?? normalizePath(`${plugin.settings.historyFolder}/background-tasks/research-${Date.now()}.md`);

				const deepResearch = plugin.deepResearch;
				const label = params.topic.length > 40 ? params.topic.slice(0, 37) + '…' : params.topic;
				const taskId = plugin.backgroundTaskManager.submit('deep-research', label, async (isCancelled) => {
					if (isCancelled()) return undefined;
					const result = await deepResearch.conductResearch({
						topic: params.topic,
						scope: params.scope,
						outputFile: resolvedOutputFile,
					});
					return result.outputFile?.path;
				});

				return {
					success: true,
					data: { taskId, output_file: resolvedOutputFile },
				};
			}

			// ── Foreground mode (default) ────────────────────────────────────────
			const result = await plugin.deepResearch.conductResearch({
				topic: params.topic,
				scope: params.scope,
				outputFile: outputFile,
			});

			// Add to context if in agent session and file was created
			if (context.session && result.outputFile) {
				context.session.context.contextFiles.push(result.outputFile);
			}

			return {
				success: true,
				data: {
					topic: result.topic,
					report: result.report,
					sources: result.sourceCount,
					outputFile: result.outputFile?.path,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Deep research failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}

/**
 * Get Deep Research tool
 */
export function getDeepResearchTool(): Tool {
	return new DeepResearchTool();
}
