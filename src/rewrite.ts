import ObsidianGemini from '../main';
import { GeminiApi, ExtendedModelRequest } from './api';
import { GeminiPrompts } from './prompts';

export class ModelRewriteMode {
	private plugin: ObsidianGemini;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(this.plugin.settings);
	}

	async generateRewriteResponse(userMessage: string, conversationHistory: any[]) {
		const prompt = this.prompts.rewritePrompt({ userMessage: userMessage });
		await this.plugin.history.appendHistory({
			role: 'user',
			message: userMessage,
		});
		let request: ExtendedModelRequest = {
			prompt: prompt,
			conversationHistory: conversationHistory,
			userMessage: userMessage,
		};
		const result = await this.plugin.geminiApi.generateModelResponse(request);
		await this.plugin.gfile.replaceTextInActiveFile(result.markdown);
	}
}
