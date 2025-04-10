import * as Handlebars from 'handlebars';
import { ObsidianGeminiSettings } from '../main';

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
import datePromptContent from '../prompts/datePrompt.txt';
// @ts-ignore
import timePromptContent from '../prompts/timePrompt.txt';
// @ts-ignore
import contextPromptContent from '../prompts/contextPrompt.txt';

export const DEFAULT_PROMPTS = {
	system: systemPromptContent,
	completion: completionPromptContent,
	general: generalPromptContent,
	summary: summaryPromptContent,
	rewrite: rewritePromptContent,
	date: datePromptContent,
	time: timePromptContent,
	context: contextPromptContent,
};

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private generalPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private rewritePromptTemplate: Handlebars.TemplateDelegate;
	private datePromptTemplate: Handlebars.TemplateDelegate;
	private timePromptTemplate: Handlebars.TemplateDelegate;
	private contextPromptTemplate: Handlebars.TemplateDelegate;

	constructor(userSettings?: Partial<ObsidianGeminiSettings>) {
		const getPromptText = (customPrompt: string | undefined, defaultPrompt: string): string => {
			return userSettings?.promptMode === 'custom' && customPrompt
				? customPrompt
				: defaultPrompt;
		};

		const systemPromptText = getPromptText(
			userSettings?.customSystemPrompt,
			DEFAULT_PROMPTS.system
		);

		const completionPromptText = getPromptText(
			userSettings?.customCompletionPrompt, 
			DEFAULT_PROMPTS.completion
		);

		const generalPromptText = getPromptText(
			userSettings?.customGeneralPrompt,
			DEFAULT_PROMPTS.general
		);

		const summaryPromptText = getPromptText(
			userSettings?.customSummaryPrompt,
			DEFAULT_PROMPTS.summary
		);

		const rewritePromptText = getPromptText(
			userSettings?.customRewritePrompt,
			DEFAULT_PROMPTS.rewrite
		);

		const datePromptText = getPromptText(
			userSettings?.customDatePrompt,
			DEFAULT_PROMPTS.date
		);

		const timePromptText = getPromptText(
			userSettings?.customTimePrompt,
			DEFAULT_PROMPTS.time
		);

		const contextPromptText = getPromptText(
			userSettings?.customContextPrompt,
			DEFAULT_PROMPTS.context
		);

		this.systemPromptTemplate = Handlebars.compile(systemPromptText);
		this.completionsPromptTemplate = Handlebars.compile(completionPromptText);
		this.generalPromptTemplate = Handlebars.compile(generalPromptText);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptText);
		this.rewritePromptTemplate = Handlebars.compile(rewritePromptText);
		this.datePromptTemplate = Handlebars.compile(datePromptText);
		this.timePromptTemplate = Handlebars.compile(timePromptText);
		this.contextPromptTemplate = Handlebars.compile(contextPromptText);
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

	datePrompt(variables: { [key: string]: string }): string {
		return this.datePromptTemplate(variables);
	}

	timePrompt(variables: { [key: string]: string }): string {
		return this.timePromptTemplate(variables);
	}

	contextPrompt(variables: { [key: string]: string }): string {
		return this.contextPromptTemplate(variables);
	}
}
