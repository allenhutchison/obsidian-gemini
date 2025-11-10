import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';

/**
 * Deep Research Tool that conducts comprehensive research with multiple searches
 * and generates a well-cited report
 */
export class DeepResearchTool implements Tool {
	name = 'deep_research';
	displayName = 'Deep Research';
	category = ToolCategory.READ_ONLY;
	description =
		'Conduct comprehensive, multi-phase research on a complex topic using iterative Google searches and AI synthesis. Performs multiple rounds of targeted searches (1-5 iterations), analyzes information gaps, generates follow-up queries, and compiles findings into a well-structured markdown report with inline citations. Returns a professional research document with sections, summaries, and a complete sources bibliography. Optionally saves the report to a vault file. Use this for in-depth research projects, literature reviews, or when you need a thorough analysis with proper academic-style citations. WARNING: This tool performs many API calls and may take several minutes to complete.';
	requiresConfirmation = true;

	parameters = {
		type: 'object' as const,
		properties: {
			topic: {
				type: 'string' as const,
				description: 'The research topic or question'
			},
			depth: {
				type: 'number' as const,
				description: 'Number of search iterations (1-5, default: 3)'
			},
			outputFile: {
				type: 'string' as const,
				description: 'Path for the output report file (optional)'
			}
		},
		required: ['topic']
	};

	confirmationMessage = (params: { topic: string; depth?: number }) => {
		return `Conduct deep research on: "${params.topic}" with ${params.depth || 3} search iterations`;
	};

	getProgressDescription(params: { topic: string }): string {
		if (params.topic) {
			const topic = params.topic.length > 30
				? params.topic.substring(0, 27) + '...'
				: params.topic;
			return `Researching "${topic}"`;
		}
		return 'Conducting research';
	}

	async execute(
		params: { topic: string; depth?: number; outputFile?: string },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			// Validate parameters
			if (!params.topic || typeof params.topic !== 'string' || params.topic.trim().length === 0) {
				return {
					success: false,
					error: 'Topic is required and must be a non-empty string'
				};
			}

			// Check if deep research service is available
			if (!plugin.deepResearch) {
				return {
					success: false,
					error: 'Deep research service not available'
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
				depth: params.depth,
				outputFile: outputFile
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
					searches: result.searchCount,
					sources: result.sourceCount,
					sections: result.sectionCount,
					outputFile: result.outputFile?.path
				}
			};
		} catch (error) {
			return {
				success: false,
				error: `Deep research failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
