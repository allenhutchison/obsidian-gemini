import * as Handlebars from 'handlebars';
import { CustomPrompt } from './prompts/types';
import ObsidianGemini from '../main';

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

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private generalPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private contextPromptTemplate: Handlebars.TemplateDelegate;
	private selectionRewritePromptTemplate: Handlebars.TemplateDelegate;

	constructor(private plugin?: InstanceType<typeof ObsidianGemini>) {
		this.completionsPromptTemplate = Handlebars.compile(completionPromptContent);
		this.systemPromptTemplate = Handlebars.compile(systemPromptContent);
		this.generalPromptTemplate = Handlebars.compile(generalPromptContent);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptContent);
		this.contextPromptTemplate = Handlebars.compile(contextPromptContent);
		this.selectionRewritePromptTemplate = Handlebars.compile(selectionRewritePromptContent);
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

	// New method to merge custom prompt with system prompt
	async getSystemPromptWithCustom(customPrompt?: CustomPrompt): Promise<string> {
		const baseSystemPrompt = this.systemPrompt({
			userName: this.plugin?.settings.userName || 'User',
			language: this.getLanguageCode(),
			date: new Date().toLocaleDateString(),
			time: new Date().toLocaleTimeString(),
		});

		if (!customPrompt) {
			return baseSystemPrompt;
		}

		if (customPrompt.overrideSystemPrompt) {
			// User has explicitly chosen to override - add warning in logs
			console.warn('System prompt override enabled. Base functionality may be affected.');
			return customPrompt.content;
		}

		// Default behavior: append custom prompt to system prompt
		return `${baseSystemPrompt}\n\n## Additional Instructions\n\n${customPrompt.content}`;
	}

	// Method to create system prompt with tools information
	getSystemPromptWithTools(availableTools: any[]): string {
		const baseSystemPrompt = this.systemPrompt({
			userName: this.plugin?.settings.userName || 'User',
			language: this.getLanguageCode(),
			date: new Date().toLocaleDateString(),
			time: new Date().toLocaleTimeString(),
		});

		if (!availableTools || availableTools.length === 0) {
			return baseSystemPrompt;
		}

		// Add tools information to the system prompt
		let toolsSection = '\n\n## Available Tools\n\n';
		toolsSection += 'You have access to the following tools that you can use to help answer questions:\n\n';
		
		for (const tool of availableTools) {
			toolsSection += `### ${tool.name}\n`;
			toolsSection += `${tool.description}\n`;
			
			if (tool.parameters && tool.parameters.properties) {
				toolsSection += 'Parameters:\n';
				for (const [param, schema] of Object.entries(tool.parameters.properties as Record<string, any>)) {
					const required = tool.parameters.required?.includes(param) ? ' (required)' : '';
					toolsSection += `- ${param}: ${schema.type}${required} - ${schema.description || ''}\n`;
				}
			}
			toolsSection += '\n';
		}

		toolsSection += 'To use a tool, you MUST make a function call. The system will execute the tool and provide the results.\n\n';
		toolsSection += '**IMPORTANT**: When the user asks you to:\n';
		toolsSection += '- Create, write, or save content → USE the write_file tool\n';
		toolsSection += '- List files → USE the list_files tool\n';
		toolsSection += '- Read files → USE the read_file tool\n';
		toolsSection += '- Search files → USE the search_files tool\n\n';
		toolsSection += 'DO NOT just describe what you would do. ALWAYS use the appropriate tool to complete the task.\n';
		toolsSection += 'Example: If asked to "create a file", you must call write_file with the path and content.\n\n';
		toolsSection += '**CONTEXT FILES**: Files may be included in the context or mentioned by the user with @ symbols.\n';
		toolsSection += 'When asked to modify or add data to these files:\n';
		toolsSection += '1. First READ the file with read_file to understand its current content\n';
		toolsSection += '2. Then WRITE the updated content with write_file, preserving existing data\n';
		toolsSection += '3. DO NOT create new files unless explicitly asked - modify existing ones\n';

		return baseSystemPrompt + toolsSection;
	}
}
