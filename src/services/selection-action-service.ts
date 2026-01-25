import { Editor, TFile, Notice } from 'obsidian';
import type ObsidianGemini from '../main';
import { ExplainPromptSelectionModal } from '../ui/explain-prompt-modal';
import { SelectionResponseModal, AskQuestionModal } from '../ui/selection-response-modal';
import { CustomPrompt } from '../prompts/types';
import { GeminiClientFactory } from '../api/simple-factory';

/**
 * Service to coordinate selection-based actions.
 * Handles "Explain Selection" and "Ask about Selection" features.
 */
export class SelectionActionService {
	constructor(private plugin: ObsidianGemini) {}

	/**
	 * Handle "Explain Selection" action:
	 * 1. Gets the selected text from editor
	 * 2. Shows prompt selection modal (filtered by selection-action tag)
	 * 3. Calls AI with selection + prompt
	 * 4. Shows response in modal with option to insert as callout
	 */
	async handleExplainSelection(editor: Editor, sourceFile: TFile | null): Promise<void> {
		const selection = editor.getSelection();
		if (!selection || selection.trim().length === 0) {
			new Notice('Please select some text first');
			return;
		}

		// Capture selection end position now (before modal opens and potentially clears selection)
		const selectionEnd = editor.getCursor('to');

		// Ensure default selection prompts exist
		await this.plugin.promptManager.createDefaultSelectionPrompts();

		// Get prompts tagged with 'selection-action'
		const prompts = await this.plugin.promptManager.listPromptsByTag('selection-action');

		if (prompts.length === 0) {
			new Notice('No selection action prompts found. Create prompts with the "selection-action" tag.');
			return;
		}

		// Show prompt selection modal
		const modal = new ExplainPromptSelectionModal(
			this.plugin.app,
			this.plugin,
			prompts,
			async (prompt: CustomPrompt) => {
				// Use the captured selection and position from before the modal opened
				await this.generateAndShowResponseWithPosition(editor, selection, prompt.content, sourceFile, selectionEnd);
			}
		);
		modal.open();
	}

	/**
	 * Handle "Ask about Selection" action:
	 * 1. Gets the selected text from editor
	 * 2. Shows modal for user to enter their question
	 * 3. Calls AI with selection + question
	 * 4. Shows response in modal with option to insert as callout
	 */
	async handleAskAboutSelection(editor: Editor, sourceFile: TFile | null): Promise<void> {
		const selection = editor.getSelection();
		if (!selection || selection.trim().length === 0) {
			new Notice('Please select some text first');
			return;
		}

		// Show question input modal
		const questionModal = new AskQuestionModal(this.plugin.app, selection, async (question: string) => {
			const prompt = `Please answer the following question about the text below:\n\nQuestion: ${question}`;
			await this.generateAndShowResponse(editor, selection, prompt, sourceFile);
		});
		questionModal.open();
	}

	/**
	 * Generate AI response and show in modal
	 */
	private async generateAndShowResponse(
		editor: Editor,
		selection: string,
		promptContent: string,
		sourceFile: TFile | null
	): Promise<void> {
		// Get selection end position for inserting callout later
		const selectionEnd = editor.getCursor('to');
		await this.generateAndShowResponseWithPosition(editor, selection, promptContent, sourceFile, selectionEnd);
	}

	/**
	 * Generate AI response and show in modal with pre-captured position
	 */
	private async generateAndShowResponseWithPosition(
		editor: Editor,
		selection: string,
		promptContent: string,
		sourceFile: TFile | null,
		selectionEnd: { line: number; ch: number }
	): Promise<void> {
		// Show response modal with loading state
		const responseModal = new SelectionResponseModal(this.plugin.app, this.plugin, editor, selection, selectionEnd);
		responseModal.open();

		try {
			// Build the user message with the selection
			const userMessage = `${promptContent}\n\n---\n\n${selection}`;

			// Add source file context if available
			let contextInfo = '';
			if (sourceFile) {
				contextInfo = `Source file: ${sourceFile.path}`;
			}

			// Call the Gemini API
			// Note: GeminiClientFactory.createChatModel wraps the client with RetryDecorator
			// which provides automatic retry with exponential backoff for transient failures
			const modelApi = GeminiClientFactory.createChatModel(this.plugin);

			// Add timeout protection (60 seconds) to prevent indefinite hanging
			const timeoutMs = 60000;
			const responsePromise = modelApi.generateModelResponse({
				userMessage: userMessage,
				conversationHistory: [],
				model: this.plugin.settings.chatModelName,
				prompt: contextInfo,
				temperature: this.plugin.settings.temperature,
				topP: this.plugin.settings.topP,
				renderContent: false,
			});

			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error('Request timed out after 60 seconds')), timeoutMs);
			});

			const response = await Promise.race([responsePromise, timeoutPromise]);

			// Show the response
			if (response.markdown && response.markdown.trim()) {
				await responseModal.showResponse(response.markdown);
			} else {
				responseModal.showError('The AI returned an empty response. Please try again.');
			}
		} catch (error) {
			this.plugin.logger.error('Error generating response:', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			responseModal.showError(errorMessage);
		}
	}
}
