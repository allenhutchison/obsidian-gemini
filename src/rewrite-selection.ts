import ObsidianGemini from './main';
import { Editor, Notice } from 'obsidian';
import { ExtendedModelRequest } from './api/index';
import { GeminiPrompts } from './prompts';
import { GeminiClientFactory } from './api/simple-factory';
import { getErrorMessage } from './utils/error-utils';

export class SelectionRewriter {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private prompts: GeminiPrompts;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
	}

	private buildSelectionPrompt(params: {
		selectedText: string;
		instructions: string;
		fullContent: string;
		selectionStart: number;
		selectionEnd: number;
	}): string {
		// Insert markers to show where selection is in the document
		const documentWithMarkers = 
			params.fullContent.substring(0, params.selectionStart) +
			'[SELECTION_START]' +
			params.selectedText +
			'[SELECTION_END]' +
			params.fullContent.substring(params.selectionEnd);

		return this.prompts.selectionRewritePrompt({
			selectedText: params.selectedText,
			instructions: params.instructions,
			documentWithMarkers: documentWithMarkers
		});
	}

	async rewriteSelection(
		editor: Editor,
		selectedText: string,
		instructions: string
	): Promise<void> {
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');

		// Calculate selection positions
		const selectionStart = editor.posToOffset(from);
		const selectionEnd = editor.posToOffset(to);

		const prompt = this.buildSelectionPrompt({
			selectedText,
			instructions,
			fullContent: editor.getValue(),
			selectionStart,
			selectionEnd
		});

		// Send request without conversation history
		// The file context will be added automatically by the API layer
		const request: ExtendedModelRequest = {
			prompt,
			conversationHistory: [], // Empty history for rewrite operations
			userMessage: instructions
		};

		try {
			// Show loading notice
			new Notice('Rewriting selected text...');

			// Create a rewrite-specific model API
			const modelApi = GeminiClientFactory.createRewriteModel(this.plugin);

			const result = await modelApi.generateModelResponse(request);

			// Replace the selected text with the result
			editor.replaceSelection(result.markdown.trim());

			new Notice('Text rewritten successfully');
		} catch (error) {
			this.plugin.logger.error('Failed to rewrite text:', error);
			const errorMessage = getErrorMessage(error);
			new Notice(errorMessage, 8000);
		}
	}

	private buildFullFilePrompt(params: {
		fileContent: string;
		instructions: string;
	}): string {
		return `You are rewriting an entire markdown document based on user instructions.

# Current Document Content

${params.fileContent}

# User Instructions

${params.instructions}

# Your Task

Rewrite the entire document according to the user's instructions. Maintain the markdown formatting and structure unless the instructions specifically ask you to change it. Return ONLY the rewritten document content, no explanations or metadata.`;
	}

	async rewriteFullFile(
		editor: Editor,
		instructions: string
	): Promise<void> {
		const fileContent = editor.getValue();

		const prompt = this.buildFullFilePrompt({
			fileContent,
			instructions
		});

		const request: ExtendedModelRequest = {
			prompt,
			conversationHistory: [],
			userMessage: instructions
		};

		try {
			// Show loading notice
			new Notice('Rewriting entire file...');

			// Create a rewrite-specific model API
			const modelApi = GeminiClientFactory.createRewriteModel(this.plugin);

			const result = await modelApi.generateModelResponse(request);

			// Replace the entire file content with the result
			editor.setValue(result.markdown.trim());

			new Notice('File rewritten successfully');
		} catch (error) {
			this.plugin.logger.error('Failed to rewrite file:', error);
			const errorMessage = getErrorMessage(error);
			new Notice(errorMessage, 8000);
		}
	}
}