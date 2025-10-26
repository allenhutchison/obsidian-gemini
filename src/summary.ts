import ObsidianGemini from './main';
import { GeminiPrompts } from './prompts';
import { BaseModelRequest } from './api/index';
import { GeminiClientFactory } from './api/simple-factory';

export class GeminiSummary {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private prompts: GeminiPrompts;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
	}

	async summarizeActiveFile() {
		const fileContent = await this.plugin.gfile.getCurrentFileContent(true);
		if (fileContent) {
			// Create a summary-specific model API
			const modelApi = GeminiClientFactory.createSummaryModel(this.plugin);
			
			let request: BaseModelRequest = {
				prompt: this.prompts.summaryPrompt({ content: fileContent }),
			};
			const summary = await modelApi.generateModelResponse(request);
			this.plugin.gfile.addToFrontMatter(this.plugin.settings.summaryFrontmatterKey, summary.markdown);
		} else {
			console.error('Failed to get file content for summary.');
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
