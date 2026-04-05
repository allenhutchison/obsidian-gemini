import * as Handlebars from 'handlebars';
import { CustomPrompt } from './types';
import { ToolDefinition } from '../api/interfaces/model-api';
import ObsidianGemini from '../main';

import systemPromptContent from '../../prompts/systemPrompt.hbs';
import completionPromptContent from '../../prompts/completionPrompt.hbs';
import generalPromptContent from '../../prompts/generalPrompt.hbs';
import summaryPromptContent from '../../prompts/summaryPrompt.hbs';
import contextPromptContent from '../../prompts/contextPrompt.hbs';
import selectionRewritePromptContent from '../../prompts/selectionRewritePrompt.hbs';
import agentToolsPromptContent from '../../prompts/agentToolsPrompt.hbs';
import vaultAnalysisPromptContent from '../../prompts/vaultAnalysisPrompt.hbs';
import examplePromptsPromptContent from '../../prompts/examplePromptsPrompt.hbs';
import imagePromptGeneratorContent from '../../prompts/imagePromptGenerator.hbs';
import languageInstructionContent from '../../prompts/languageInstruction.hbs';

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
	 * Shape raw tool definitions into the structure the agentToolsPrompt template
	 * expects. This is data pre-processing only — all string formatting happens
	 * inside the Handlebars template via {{#each}} loops.
	 */
	private shapeToolsForTemplate(tools: ToolDefinition[]): Array<{
		name: string;
		description: string;
		parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
	}> {
		return tools.map((tool) => {
			const properties = (tool.parameters?.properties ?? {}) as Record<string, { type: string; description?: string }>;
			const requiredParams = tool.parameters?.required ?? [];
			return {
				name: tool.name,
				description: tool.description,
				parameters: Object.entries(properties).map(([name, schema]) => ({
					name,
					type: schema.type,
					description: schema.description || '',
					required: requiredParams.includes(name),
				})),
			};
		});
	}

	/**
	 * Unified method to build complete system prompt with tools and optional custom prompt.
	 *
	 * All sections (base prompt, vault context, project instructions, tools, custom
	 * instructions) are composed via Handlebars template variables rather than TS
	 * string concatenation.
	 *
	 * @param availableTools - Optional array of tool definitions
	 * @param customPrompt - Optional custom prompt to append or override
	 * @param agentsMemory - Optional AGENTS.md content to include
	 * @returns Complete system prompt
	 */
	getSystemPromptWithCustom(
		availableTools?: ToolDefinition[],
		customPrompt?: CustomPrompt,
		agentsMemory?: string | null,
		availableSkills?: { name: string; description: string }[],
		projectInstructions?: string
	): string {
		// If custom prompt with override is provided, return only that
		if (customPrompt?.overrideSystemPrompt) {
			this.plugin?.logger.warn('System prompt override enabled. Base functionality may be affected.');
			return customPrompt.content;
		}

		// Render the agent tools section (if tools are provided) via its template
		let agentToolsSection = '';
		if (availableTools && availableTools.length > 0) {
			const ragEnabled = !!(this.plugin?.settings.ragIndexing.enabled && this.plugin?.ragIndexing?.isReady());
			agentToolsSection = this.agentToolsPromptTemplate({
				availableTools: this.shapeToolsForTemplate(availableTools),
				ragEnabled,
				availableSkills: availableSkills || [],
			});
		}

		// Custom prompt content (if provided and not overriding) is passed as a
		// template variable — the systemPrompt.hbs template handles the heading.
		const additionalInstructions = customPrompt && !customPrompt.overrideSystemPrompt ? customPrompt.content : '';

		// Capture a single timestamp so the date and time fields in the system
		// prompt are always derived from the same instant (avoids split around
		// midnight boundaries).
		const now = new Date();

		return this.systemPrompt({
			userName: this.plugin?.settings.userName || 'User',
			language: this.getLanguageCode(),
			date: now.toLocaleDateString(),
			time: now.toLocaleTimeString(),
			agentsMemory: agentsMemory || '',
			projectInstructions: projectInstructions || '',
			agentToolsSection,
			additionalInstructions,
		});
	}
}
