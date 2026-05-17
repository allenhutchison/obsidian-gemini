import * as Handlebars from 'handlebars';
import { getLanguage } from 'obsidian';
import { CustomPrompt } from './types';
import { ToolDefinition } from '../api/interfaces/model-api';
import type ObsidianGemini from '../main';

import systemPromptContent from '../../prompts/systemPrompt.hbs';
import completionPromptContent from '../../prompts/completionPrompt.hbs';
import summaryPromptContent from '../../prompts/summaryPrompt.hbs';
import contextPromptContent from '../../prompts/contextPrompt.hbs';
import selectionRewritePromptContent from '../../prompts/selectionRewritePrompt.hbs';
import agentRulesPromptContent from '../../prompts/agentRulesPrompt.hbs';
import toolCatalogPromptContent from '../../prompts/toolCatalogPrompt.hbs';
import vaultAnalysisPromptContent from '../../prompts/vaultAnalysisPrompt.hbs';
import examplePromptsPromptContent from '../../prompts/examplePromptsPrompt.hbs';
import imagePromptGeneratorContent from '../../prompts/imagePromptGenerator.hbs';
import languageInstructionContent from '../../prompts/languageInstruction.hbs';

export class GeminiPrompts {
	private completionsPromptTemplate: Handlebars.TemplateDelegate;
	private systemPromptTemplate: Handlebars.TemplateDelegate;
	private summaryPromptTemplate: Handlebars.TemplateDelegate;
	private contextPromptTemplate: Handlebars.TemplateDelegate;
	private selectionRewritePromptTemplate: Handlebars.TemplateDelegate;
	private agentRulesPromptTemplate: Handlebars.TemplateDelegate;
	private toolCatalogPromptTemplate: Handlebars.TemplateDelegate;
	private vaultAnalysisPromptTemplate: Handlebars.TemplateDelegate;
	private examplePromptsPromptTemplate: Handlebars.TemplateDelegate;
	private imagePromptGeneratorTemplate: Handlebars.TemplateDelegate;

	constructor(private plugin?: ObsidianGemini) {
		this.completionsPromptTemplate = Handlebars.compile(completionPromptContent);
		this.systemPromptTemplate = Handlebars.compile(systemPromptContent);
		this.summaryPromptTemplate = Handlebars.compile(summaryPromptContent);
		this.contextPromptTemplate = Handlebars.compile(contextPromptContent);
		this.selectionRewritePromptTemplate = Handlebars.compile(selectionRewritePromptContent);
		this.agentRulesPromptTemplate = Handlebars.compile(agentRulesPromptContent);
		this.toolCatalogPromptTemplate = Handlebars.compile(toolCatalogPromptContent);
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
		return getLanguage() || 'en';
	}

	/**
	 * Shape raw tool definitions into the structure the tool catalog template
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
	 * Build the complete system prompt from layered sections.
	 *
	 * Layers (in order):
	 * 1. Identity — who you are, tone, date, language
	 * 2. Vault Context — AGENTS.md content
	 * 3. Project Instructions — project-scoped rules
	 * 4. Agent Rules — behavioral guidance (research, errors, YAML, etc.)
	 * 5. Tool Catalog — available tools and their parameters
	 * 6. Custom Instructions — user's custom prompt content
	 * 7. Turn Context — per-message context files and attachments
	 *
	 * All sections are composed via Handlebars template variables.
	 */
	getSystemPromptWithCustom(
		availableTools?: ToolDefinition[],
		customPrompt?: CustomPrompt,
		agentsMemory?: string | null,
		availableSkills?: { name: string; description: string }[],
		projectInstructions?: string,
		sessionStartedAt?: string
	): string {
		// If custom prompt with override is provided, return only that
		if (customPrompt?.overrideSystemPrompt) {
			this.plugin?.logger.warn('System prompt override enabled. Base functionality may be affected.');
			return customPrompt.content;
		}

		const ragEnabled = !!(this.plugin?.settings.ragIndexing.enabled && this.plugin?.ragIndexing?.isReady());

		// Render agent rules (static behavioral guidance) — only when tools are available
		let agentRulesSection = '';
		if (availableTools && availableTools.length > 0) {
			agentRulesSection = this.agentRulesPromptTemplate({ ragEnabled });
		}

		// Render tool catalog (dynamic per-session tool list)
		let toolCatalogSection = '';
		if (availableTools && availableTools.length > 0) {
			toolCatalogSection = this.toolCatalogPromptTemplate({
				availableTools: this.shapeToolsForTemplate(availableTools),
				ragEnabled,
				availableSkills: availableSkills || [],
			});
		}

		// Custom prompt content (if provided and not overriding) is passed as a
		// template variable — the systemPrompt.hbs template handles the heading.
		const additionalInstructions = customPrompt && !customPrompt.overrideSystemPrompt ? customPrompt.content : '';

		// sessionStartedAt must be a canonical, byte-stable string the caller
		// persisted once. Do NOT re-format via Date/toLocaleString here — doing so
		// would break Gemini's implicit prefix cache across resumes and across
		// tool-loop iterations.
		return this.systemPrompt({
			userName: this.plugin?.settings.userName || 'User',
			sessionStartedAt: sessionStartedAt || '',
			agentsMemory: agentsMemory || '',
			projectInstructions: projectInstructions || '',
			agentRulesSection,
			toolCatalogSection,
			additionalInstructions,
		});
	}
}
