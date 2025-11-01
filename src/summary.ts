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

	async summarizeActiveFile() {
		// Check if there's an active file first
		const activeFile = this.plugin.gfile.getActiveFile();
		if (!activeFile) {
			const errorMsg = 'No active file to summarize. Please open a markdown file first.';
			console.error(errorMsg);
			new Notice(errorMsg);
			return;
		}

		try {
			// Get file content
			const fileContent = await this.plugin.gfile.getCurrentFileContent(true);

			if (!fileContent) {
				const errorMsg = 'Failed to read file content. Please try again.';
				console.error(errorMsg);
				new Notice(errorMsg);
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
			const errorMsg = `Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`;
			console.error(errorMsg, error);
			new Notice(errorMsg);
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
