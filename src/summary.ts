import ObsidianGemini from './main';
import { GeminiPrompts } from './prompts';
import { BaseModelRequest } from './api/index';
import { GeminiClientFactory } from './api/simple-factory';
import { Notice } from 'obsidian';

export class GeminiSummary {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private prompts: GeminiPrompts;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
	}

	/**
	 * Display an error message to the user and log to console
	 * @param message - The error message to display
	 * @param error - Optional error object for detailed logging
	 */
	private showError(message: string, error?: unknown): void {
		this.plugin.logger.error(message, error);
		new Notice(message);
	}

	async summarizeActiveFile() {
		// Check if there's an active file first
		const activeFile = this.plugin.gfile.getActiveFile();
		if (!activeFile) {
			this.showError('No active file to summarize. Please open a markdown file first.');
			return;
		}

		try {
			// Get file content
			const fileContent = await this.plugin.gfile.getCurrentFileContent(true);

			if (!fileContent) {
				this.showError('Failed to read file content. Please try again.');
				return;
			}

			// Create a summary-specific model API
			const modelApi = GeminiClientFactory.createSummaryModel(this.plugin);

			const request: BaseModelRequest = {
				prompt: this.prompts.summaryPrompt({ content: fileContent }),
			};

			// Generate summary with API error handling
			const summary = await modelApi.generateModelResponse(request);

			// Add summary to frontmatter
			this.plugin.gfile.addToFrontMatter(this.plugin.settings.summaryFrontmatterKey, summary.markdown);

			// Show success message
			new Notice('Summary added to frontmatter successfully!');
		} catch (error) {
			const errorMsg = `Failed to generate summary: ${error instanceof Error ? error.message : String(error)}`;
			this.showError(errorMsg, error);
		}
	}

	async setupSummarizationCommand() {
		this.plugin.addCommand({
			id: 'gemini-scribe-summarize-active-file',
			name: 'Summarize Active File',
			callback: () => this.summarizeActiveFile(),
		});
	}
}
