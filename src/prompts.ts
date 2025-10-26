import * as Handlebars from 'handlebars';
import { CustomPrompt } from './prompts/types';
import ObsidianGemini from './main';

// @ts-ignore
import systemPromptContent from '../prompts/systemPrompt.txt';
// @ts-ignore
import completionPromptContent from '../prompts/completionPrompt.txt';
// @ts-ignore
import generalPromptContent from '../prompts/generalPrompt.txt';
// @ts-ignore
import summaryPromptContent from '../prompts/summaryPrompt.txt';
// @ts-ignore
import contextPromptContent from '../prompts/contextPrompt.txt';
// @ts-ignore
import selectionRewritePromptContent from '../prompts/selectionRewritePrompt.txt';
// @ts-ignore
import agentToolsPromptContent from '../prompts/agentToolsPrompt.txt';

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private generalPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private contextPromptTemplate: Handlebars.TemplateDelegate;
	private selectionRewritePromptTemplate: Handlebars.TemplateDelegate;
	private agentToolsPromptTemplate: Handlebars.TemplateDelegate;

	constructor(private plugin?: InstanceType<typeof ObsidianGemini>) {
		this.completionsPromptTemplate = Handlebars.compile(completionPromptContent);
		this.systemPromptTemplate = Handlebars.compile(systemPromptContent);
		this.generalPromptTemplate = Handlebars.compile(generalPromptContent);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptContent);
		this.contextPromptTemplate = Handlebars.compile(contextPromptContent);
		this.selectionRewritePromptTemplate = Handlebars.compile(selectionRewritePromptContent);
		this.agentToolsPromptTemplate = Handlebars.compile(agentToolsPromptContent);
	}

	completionsPrompt(variables: { [key: string]: string }): string {
		return this.completionsPromptTemplate(variables);
	}

	systemPrompt(variables: { [key: string]: string }): string {
		return this.systemPromptTemplate(variables);
	}

	generalPrompt(variables: { [key: string]: string }): string {
		return this.generalPromptTemplate(variables);
	}

	summaryPrompt(variables: { [key: string]: string }): string {
		return this.summaryPromptTemplate(variables);
	}

	contextPrompt(variables: { [key: string]: string }): string {
		return this.contextPromptTemplate(variables);
	}

	selectionRewritePrompt(variables: { [key: string]: string }): string {
		return this.selectionRewritePromptTemplate(variables);
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
	 * @returns Complete system prompt
	 */
	getSystemPromptWithCustom(availableTools?: any[], customPrompt?: CustomPrompt): string {
		console.log('[GeminiPrompts] getSystemPromptWithCustom called with customPrompt:', customPrompt ? `${customPrompt.name} (override: ${customPrompt.overrideSystemPrompt})` : 'none');

		// If custom prompt with override is provided, return only that
		if (customPrompt?.overrideSystemPrompt) {
			console.warn('[GeminiPrompts] System prompt override enabled. Base functionality may be affected.');
			console.log('[GeminiPrompts] Returning custom prompt content only:', customPrompt.content.substring(0, 100));
			return customPrompt.content;
		}

		// Build base system prompt
		const baseSystemPrompt = this.systemPrompt({
			userName: this.plugin?.settings.userName || 'User',
			language: this.getLanguageCode(),
			date: new Date().toLocaleDateString(),
			time: new Date().toLocaleTimeString(),
		});

		console.log('[GeminiPrompts] Base system prompt length:', baseSystemPrompt.length);

		let fullPrompt = baseSystemPrompt;

		// Add tool instructions if tools are provided
		if (availableTools && availableTools.length > 0) {
			const toolsList = this.formatToolsList(availableTools);
			const toolsPrompt = this.agentToolsPromptTemplate({ toolsList });
			fullPrompt += '\n\n' + toolsPrompt;
			console.log('[GeminiPrompts] Added tool instructions, new length:', fullPrompt.length);
		}

		// Add custom prompt if provided (and not overriding)
		if (customPrompt && !customPrompt.overrideSystemPrompt) {
			fullPrompt += '\n\n## Additional Instructions\n\n' + customPrompt.content;
			console.log('[GeminiPrompts] Added custom prompt, new length:', fullPrompt.length);
			console.log('[GeminiPrompts] Custom prompt content:', customPrompt.content.substring(0, 100));
		}

		console.log('[GeminiPrompts] Returning full prompt, length:', fullPrompt.length);
		return fullPrompt;
	}
}
