import { App, SuggestModal } from 'obsidian';
import { PromptInfo, CustomPrompt } from '../prompts/types';
import type { ObsidianGemini } from '../types/plugin';
import { t } from '../i18n';

/**
 * Modal for selecting an explain prompt from available selection-action prompts.
 * Used by the "Explain Selection" context menu feature.
 */
export class ExplainPromptSelectionModal extends SuggestModal<PromptInfo> {
	private plugin: ObsidianGemini;
	private prompts: PromptInfo[];
	private onSelect: (prompt: CustomPrompt) => void | Promise<void>;

	constructor(
		app: App,
		plugin: ObsidianGemini,
		prompts: PromptInfo[],
		onSelect: (prompt: CustomPrompt) => void | Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.prompts = prompts;
		this.onSelect = onSelect;
		this.setPlaceholder(t('explainPrompt.placeholder'));
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

	onChooseSuggestion(promptInfo: PromptInfo): void {
		// SuggestModal.onChooseSuggestion expects a void return; run the async
		// prompt load as a fire-and-forget task.
		void this.chooseSuggestion(promptInfo);
	}

	private async chooseSuggestion(promptInfo: PromptInfo): Promise<void> {
		// Invoked via `void this.chooseSuggestion(...)`, so a rejection here would be
		// an unhandled promise rejection — guard loadPrompt/onSelect with try/catch.
		try {
			// Load the full prompt content
			const prompt = await this.plugin.promptManager.loadPrompt(promptInfo.path);
			if (prompt) {
				await this.onSelect(prompt);
			} else {
				this.plugin.logger.error('Failed to load prompt:', promptInfo.path);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to load or apply prompt:', promptInfo.path, error);
		}
	}
}
