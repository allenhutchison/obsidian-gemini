import type ObsidianGemini from './main';
import { Editor, Notice, TFile } from 'obsidian';
import { ExtendedModelRequest } from './api/index';
import { GeminiPrompts } from './prompts';
import { ModelClientFactory } from './api';
import { getErrorMessage } from './utils/error-utils';

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
			documentWithMarkers: documentWithMarkers,
		});
	}

	async rewriteSelection(editor: Editor, selectedText: string, instructions: string): Promise<void> {
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
			selectionEnd,
		});

		// Send request without conversation history
		// The file context will be added automatically by the API layer
		const request: ExtendedModelRequest = {
			prompt: '', // Unused in ExtendedModelRequest path
			perTurnContext: prompt, // The rewrite template is per-turn context
			conversationHistory: [], // Empty history for rewrite operations
			userMessage: instructions,
		};

		try {
			// Show loading notice
			new Notice('Rewriting selected text...');

			// Create a rewrite-specific model API
			const modelApi = ModelClientFactory.createRewriteModel(this.plugin);

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

	private buildFullFilePrompt(params: { fileContent: string; instructions: string }): string {
		return `You are rewriting an entire markdown document based on user instructions.

# Current Document Content

${params.fileContent}

# User Instructions

${params.instructions}

# Your Task

Rewrite the entire document according to the user's instructions. Maintain the markdown formatting and structure unless the instructions specifically ask you to change it. Return ONLY the rewritten document content, no explanations or metadata.`;
	}

	async rewriteFullFile(editor: Editor, instructions: string): Promise<void> {
		const fileContent = editor.getValue();

		const prompt = this.buildFullFilePrompt({
			fileContent,
			instructions,
		});

		const request: ExtendedModelRequest = {
			prompt: '', // Unused in ExtendedModelRequest path
			perTurnContext: prompt, // Full-file rewrite template as per-turn context
			conversationHistory: [],
			userMessage: instructions,
		};

		try {
			// Show loading notice
			new Notice('Rewriting entire file...');

			// Create a rewrite-specific model API
			const modelApi = ModelClientFactory.createRewriteModel(this.plugin);

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

	/**
	 * Rewrite an arbitrary file in the vault without going through an editor.
	 * Reads via `vault.read`, sends the same full-file rewrite prompt the
	 * editor path uses, and writes the result back via `vault.modify`. Used
	 * by lifecycle hook runners and other non-interactive callers that don't
	 * have a focused editor on the target file.
	 *
	 * Mid-request edit safety: model calls take seconds, and the user can
	 * keep editing while the request is in flight. Capture the file's
	 * `stat.mtime` before the model call and refuse to write if the file
	 * has changed on disk meanwhile — better to fail loud than overwrite a
	 * newer save with a rewrite based on stale text.
	 *
	 * Throws on read/model/write failures so callers can record the error
	 * their own way; no Notice is shown.
	 */
	async rewriteFile(file: TFile, instructions: string): Promise<string> {
		const fileContent = await this.plugin.app.vault.read(file);
		const baselineMtime = file.stat?.mtime;

		const prompt = this.buildFullFilePrompt({
			fileContent,
			instructions,
		});

		const request: ExtendedModelRequest = {
			prompt: '',
			perTurnContext: prompt,
			conversationHistory: [],
			userMessage: instructions,
		};

		const modelApi = ModelClientFactory.createRewriteModel(this.plugin);
		const result = await modelApi.generateModelResponse(request);
		const rewritten = result.markdown.trim();

		// Re-fetch the live file reference so we see writes that landed
		// during the model call. If the file is gone, abort cleanly. If the
		// mtime advanced past our baseline, abort to preserve the newer
		// version — the alternative is silently clobbering the user.
		const live = this.plugin.app.vault.getAbstractFileByPath(file.path);
		if (!(live instanceof TFile)) {
			throw new Error(`[SelectionRewriter] File "${file.path}" was removed during rewrite — discarding result`);
		}
		const liveMtime = live.stat?.mtime;
		if (baselineMtime !== undefined && liveMtime !== undefined && liveMtime > baselineMtime) {
			throw new Error(
				`[SelectionRewriter] File "${file.path}" was modified during rewrite (mtime ${baselineMtime} → ${liveMtime}); aborting to avoid clobbering newer content`
			);
		}

		await this.plugin.app.vault.modify(live, rewritten);
		return rewritten;
	}
}
