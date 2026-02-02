import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
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
	description =
		"Conduct comprehensive research on a topic using Google's Deep Research model. " +
		'Can search your vault notes (via RAG), the web, or both. ' +
		'Generates a well-structured markdown report with citations. ' +
		'Use scope="vault_only" to synthesize existing notes, ' +
		'scope="web_only" for internet research, or scope="both" (default) for comprehensive research. ' +
		'WARNING: This tool may take several minutes to complete as it performs deep analysis.';
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
				description: 'Path for the output report file (optional)',
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
		params: { topic: string; scope?: ResearchScope; outputFile?: string },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

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

			// Conduct the research using the service
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
