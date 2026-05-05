import type ObsidianGemini from './main';
import { GeminiPrompts } from './prompts';
import { BaseModelRequest } from './api/index';
import { GeminiClientFactory } from './api/simple-factory';
import { Notice, TFile } from 'obsidian';
import { getErrorMessage } from './utils/error-utils';

export class GeminiSummary {
	private plugin: ObsidianGemini;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
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
		const activeFile = this.plugin.gfile.getActiveFile();
		if (!activeFile) {
			this.showError('No active file to summarize. Please open a markdown file first.');
			return;
		}
		try {
			await this.summarizeFile(activeFile);
			new Notice('Summary added to frontmatter successfully!');
		} catch (error) {
			this.showError(`Failed to generate summary: ${getErrorMessage(error)}`, error);
		}
	}

	/**
	 * Summarize an arbitrary markdown file and write the result into its
	 * frontmatter. Unlike `summarizeActiveFile`, this never reaches into
	 * `workspace.getActiveFile()` — callers that don't have an active file
	 * (lifecycle hook runners, scheduled tasks, etc.) can pass any TFile.
	 *
	 * Throws on read/model failures rather than swallowing them so
	 * non-interactive callers can surface the error their own way.
	 */
	async summarizeFile(file: TFile): Promise<string> {
		const fileContent = await this.plugin.app.vault.read(file);
		if (!fileContent) {
			throw new Error(`File "${file.path}" is empty or unreadable`);
		}

		const modelApi = GeminiClientFactory.createSummaryModel(this.plugin);
		const request: BaseModelRequest = {
			prompt: this.prompts.summaryPrompt({ content: fileContent }),
		};
		const summary = await modelApi.generateModelResponse(request);

		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[this.plugin.settings.summaryFrontmatterKey] = summary.markdown;
		});

		return summary.markdown;
	}

	async setupSummarizationCommand() {
		this.plugin.addCommand({
			id: 'gemini-scribe-summarize-active-file',
			name: 'Summarize Active File',
			callback: () => this.summarizeActiveFile(),
		});
	}
}
