import * as Handlebars from 'handlebars';
import completionPromptContent from '../prompts/completionPrompt.txt';

export class GeminiPrompts {
    private completionsPromptTemplate: Handlebars.TemplateDelegate;

    constructor() {
        this.completionsPromptTemplate = Handlebars.compile(completionPromptContent);
    }

    completionsPrompt(variables: { [key: string]: string }): string {
        return this.completionsPromptTemplate(variables);
    }
}