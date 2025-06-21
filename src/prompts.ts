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
import rewritePromptContent from '../prompts/rewritePrompt.txt';
// @ts-ignore
import contextPromptContent from '../prompts/contextPrompt.txt';

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private generalPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private rewritePromptTemplate: Handlebars.TemplateDelegate;
	private contextPromptTemplate: Handlebars.TemplateDelegate;

	constructor(private plugin?: ObsidianGemini) {
		this.completionsPromptTemplate = Handlebars.compile(completionPromptContent);
		this.systemPromptTemplate = Handlebars.compile(systemPromptContent);
		this.generalPromptTemplate = Handlebars.compile(generalPromptContent);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptContent);
		this.rewritePromptTemplate = Handlebars.compile(rewritePromptContent);
		this.contextPromptTemplate = Handlebars.compile(contextPromptContent);
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

	rewritePrompt(variables: { [key: string]: string }): string {
		return this.rewritePromptTemplate(variables);
	}

	contextPrompt(variables: { [key: string]: string }): string {
		return this.contextPromptTemplate(variables);
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
			time: new Date().toLocaleTimeString()
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
}
