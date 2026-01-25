import { App, SuggestModal } from 'obsidian';
import { PromptInfo, CustomPrompt } from '../prompts/types';
import type ObsidianGemini from '../main';

/**
 * Modal for selecting an explain prompt from available selection-action prompts.
 * Used by the "Explain Selection" context menu feature.
 */
export class ExplainPromptSelectionModal extends SuggestModal<PromptInfo> {
	private plugin: ObsidianGemini;
	private prompts: PromptInfo[];
	private onSelect: (prompt: CustomPrompt) => void;

	constructor(app: App, plugin: ObsidianGemini, prompts: PromptInfo[], onSelect: (prompt: CustomPrompt) => void) {
		super(app);
		this.plugin = plugin;
		this.prompts = prompts;
		this.onSelect = onSelect;
		this.setPlaceholder('Select a prompt to explain the selection...');
	}

	getSuggestions(query: string): PromptInfo[] {
		const lowerQuery = query.toLowerCase();
		if (!query) {
			return this.prompts;
		}
		return this.prompts.filter(
			(prompt) =>
				prompt.name.toLowerCase().includes(lowerQuery) ||
				prompt.description.toLowerCase().includes(lowerQuery) ||
				prompt.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
		);
	}

	renderSuggestion(prompt: PromptInfo, el: HTMLElement): void {
		const container = el.createDiv({ cls: 'suggestion-content' });
		container.createDiv({ text: prompt.name, cls: 'suggestion-title' });
		if (prompt.description) {
			container.createDiv({ text: prompt.description, cls: 'suggestion-note' });
		}
	}

	async onChooseSuggestion(promptInfo: PromptInfo): Promise<void> {
		// Load the full prompt content
		const prompt = await this.plugin.promptManager.loadPromptFromFile(promptInfo.path);
		if (prompt) {
			this.onSelect(prompt);
		} else {
			this.plugin.logger.error('Failed to load prompt:', promptInfo.path);
		}
	}
}
