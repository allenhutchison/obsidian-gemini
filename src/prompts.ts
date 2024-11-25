import * as Handlebars from 'handlebars';

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

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private generalPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private rewritePromptTemplate: Handlebars.TemplateDelegate;
	private datePromptTemplate: Handlebars.TemplateDelegate;
	private timePromptTemplate: Handlebars.TemplateDelegate;

	constructor() {
		this.completionsPromptTemplate = Handlebars.compile(
			completionPromptContent
		);
		this.systemPromptTemplate = Handlebars.compile(systemPromptContent);
		this.generalPromptTemplate = Handlebars.compile(generalPromptContent);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptContent);
		this.rewritePromptTemplate = Handlebars.compile(rewritePromptContent);
		this.datePromptTemplate = Handlebars.compile(datePromptContent);
		this.timePromptTemplate = Handlebars.compile(timePromptContent);
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
}
