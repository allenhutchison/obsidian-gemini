import ObsidianGemini from '../main';
import { Editor, Notice } from 'obsidian';
import { ExtendedModelRequest } from './api/index';
import { GeminiPrompts } from './prompts';

export class SelectionRewriter {
	private plugin: ObsidianGemini;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
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
			
			const result = await this.plugin.geminiApi.generateModelResponse(request);
			
			// Replace the selected text with the result
			editor.replaceSelection(result.markdown.trim());
			
			new Notice('Text rewritten successfully');
		} catch (error) {
			console.error('Failed to rewrite text:', error);
			new Notice('Failed to rewrite text: ' + error.message);
		}
	}
}