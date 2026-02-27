import * as Handlebars from 'handlebars';
import { CustomPrompt } from './types';
import ObsidianGemini from '../main';

import systemPromptContent from '../../prompts/systemPrompt.txt';
import completionPromptContent from '../../prompts/completionPrompt.txt';
import generalPromptContent from '../../prompts/generalPrompt.txt';
import summaryPromptContent from '../../prompts/summaryPrompt.txt';
import contextPromptContent from '../../prompts/contextPrompt.txt';
import selectionRewritePromptContent from '../../prompts/selectionRewritePrompt.txt';
import agentToolsPromptContent from '../../prompts/agentToolsPrompt.txt';
import vaultAnalysisPromptContent from '../../prompts/vaultAnalysisPrompt.txt';
import examplePromptsPromptContent from '../../prompts/examplePromptsPrompt.txt';
import imagePromptGeneratorContent from '../../prompts/imagePromptGenerator.txt';
import languageInstructionContent from '../../prompts/languageInstruction.txt';

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private generalPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private contextPromptTemplate: Handlebars.TemplateDelegate;
	private selectionRewritePromptTemplate: Handlebars.TemplateDelegate;
	private agentToolsPromptTemplate: Handlebars.TemplateDelegate;
	private vaultAnalysisPromptTemplate: Handlebars.TemplateDelegate;
	private examplePromptsPromptTemplate: Handlebars.TemplateDelegate;
	private imagePromptGeneratorTemplate: Handlebars.TemplateDelegate;

	constructor(private plugin?: InstanceType<typeof ObsidianGemini>) {
		this.completionsPromptTemplate = Handlebars.compile(completionPromptContent);
		this.systemPromptTemplate = Handlebars.compile(systemPromptContent);
		this.generalPromptTemplate = Handlebars.compile(generalPromptContent);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptContent);
		this.contextPromptTemplate = Handlebars.compile(contextPromptContent);
		this.selectionRewritePromptTemplate = Handlebars.compile(selectionRewritePromptContent);
		this.agentToolsPromptTemplate = Handlebars.compile(agentToolsPromptContent);
		this.vaultAnalysisPromptTemplate = Handlebars.compile(vaultAnalysisPromptContent);
		this.examplePromptsPromptTemplate = Handlebars.compile(examplePromptsPromptContent);
		this.imagePromptGeneratorTemplate = Handlebars.compile(imagePromptGeneratorContent);
		Handlebars.registerPartial('languageInstruction', languageInstructionContent);
	}

	completionsPrompt(variables: { [key: string]: string }): string {
		return this.completionsPromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	systemPrompt(variables: { [key: string]: string }): string {
		return this.systemPromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	generalPrompt(variables: { [key: string]: string }): string {
		return this.generalPromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	summaryPrompt(variables: { [key: string]: string }): string {
		return this.summaryPromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	contextPrompt(variables: { [key: string]: string }): string {
		return this.contextPromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	selectionRewritePrompt(variables: { [key: string]: string }): string {
		return this.selectionRewritePromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	vaultAnalysisPrompt(variables: { [key: string]: string }): string {
		return this.vaultAnalysisPromptTemplate({ ...variables, language: this.getLanguageCode() });
	}

	examplePromptsPrompt(vaultInfo: string, existingPrompts?: string): string {
		return (
			this.examplePromptsPromptTemplate({
				existingPrompts: existingPrompts || '',
				language: this.getLanguageCode(),
			}) +
			'\n\n' +
			vaultInfo
		);
	}

	imagePromptGenerator(variables: { [key: string]: string }): string {
		return this.imagePromptGeneratorTemplate({ ...variables, language: this.getLanguageCode() });
	}

	// Get language code helper
	private getLanguageCode(): string {
		return window.localStorage.getItem('language') || 'en';
	}

	/**
	 * Format tools list for template
	 */
	private formatToolsList(tools: any[]): string {
		let toolsList = '';

		for (const tool of tools) {
			toolsList += `### ${tool.name}\n`;
			toolsList += `${tool.description}\n`;

			if (tool.parameters && tool.parameters.properties) {
				toolsList += 'Parameters:\n';
				for (const [param, schema] of Object.entries(tool.parameters.properties as Record<string, any>)) {
					const required = tool.parameters.required?.includes(param) ? ' (required)' : '';
					toolsList += `- ${param}: ${schema.type}${required} - ${schema.description || ''}\n`;
				}
			}
			toolsList += '\n';
		}

		return toolsList;
	}

	/**
	 * Unified method to build complete system prompt with tools and optional custom prompt
	 *
	 * @param availableTools - Optional array of tool definitions
	 * @param customPrompt - Optional custom prompt to append or override
	 * @param agentsMemory - Optional AGENTS.md content to include
	 * @returns Complete system prompt
	 */
	getSystemPromptWithCustom(
		availableTools?: any[],
		customPrompt?: CustomPrompt,
		agentsMemory?: string | null,
		availableSkills?: { name: string; description: string }[]
	): string {
		// If custom prompt with override is provided, return only that
		if (customPrompt?.overrideSystemPrompt) {
			this.plugin?.logger.warn('System prompt override enabled. Base functionality may be affected.');
			return customPrompt.content;
		}

		// Build base system prompt with agentsMemory as a template variable
		const baseSystemPrompt = this.systemPrompt({
			userName: this.plugin?.settings.userName || 'User',
			language: this.getLanguageCode(),
			date: new Date().toLocaleDateString(),
			time: new Date().toLocaleTimeString(),
			agentsMemory: agentsMemory || '', // Pass as template variable
		});

		let fullPrompt = baseSystemPrompt;

		// Add tool instructions if tools are provided
		if (availableTools && availableTools.length > 0) {
			const toolsList = this.formatToolsList(availableTools);
			// Check if RAG indexing is enabled and ready
			const ragEnabled = !!(this.plugin?.settings.ragIndexing.enabled && this.plugin?.ragIndexing?.isReady());
			const toolsPrompt = this.agentToolsPromptTemplate({
				toolsList,
				ragEnabled,
				availableSkills: availableSkills || [],
			});
			fullPrompt += '\n\n' + toolsPrompt;
		}

		// Add custom prompt if provided (and not overriding)
		if (customPrompt && !customPrompt.overrideSystemPrompt) {
			fullPrompt += '\n\n## Additional Instructions\n\n' + customPrompt.content;
		}

		return fullPrompt;
	}
}
