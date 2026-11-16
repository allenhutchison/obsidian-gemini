import type { ObsidianGemini } from './types/plugin';
import { MarkdownView, Notice } from 'obsidian';
import { forceableInlineSuggestion, Suggestion } from 'codemirror-companion-extension';
import { BaseModelRequest } from './api/index';
import { GeminiPrompts } from './prompts';
import { ModelClientFactory } from './api';
import { t } from './i18n';

/**
 * Decide the whitespace between the text before the cursor and the model's
 * continuation (#1739).
 *
 * The prompt asks the model to begin with a single space when it starts a new
 * word, and with no space when it finishes the word the cursor is in. So when
 * the prefix ends in a letter and the suggestion starts with one, the model has
 * told us it is continuing the word, and inserting a space would split it.
 * A space is still added after punctuation (`end.` + `Next`), where the model
 * cannot be continuing a word.
 */
function joinCompletion(prefix: string, suggestion: string): string {
	if (prefix.length === 0 || /\s$/.test(prefix)) {
		// Already at a boundary: never stack a second space.
		return suggestion.replace(/^[ \t]+/, '');
	}
	if (suggestion.length === 0 || /^\s/.test(suggestion)) {
		// The model supplied its own leading whitespace (a new word), or nothing.
		return suggestion;
	}
	if (/^[\p{P}]/u.test(suggestion)) {
		// Punctuation attaches to what came before: `word` + `, and` -> `word, and`.
		return suggestion;
	}
	if (/[\p{L}\p{N}_'’-]$/u.test(prefix)) {
		// Mid-word: the model is finishing the current word (`y` + `ou whisk`).
		return suggestion;
	}
	// After punctuation such as `.` or `,`, the next word needs a space.
	return ' ' + suggestion;
}

export class GeminiCompletions {
	private plugin: ObsidianGemini;
	private prompts: GeminiPrompts;
	private force_fetch: () => void = () => {};
	private completionsOn: boolean = false;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
	}

	async *complete(): AsyncGenerator<Suggestion> {
		if (!this.completionsOn) return;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const editor = view.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const prefix = line.substring(0, cursor.ch);

		const contentBeforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
		const contentAfterCursor = editor.getRange(cursor, {
			line: editor.lastLine(),
			ch: editor.getLine(editor.lastLine()).length,
		});
		const suggestion = await this.generateNextSentence(contentBeforeCursor, contentAfterCursor);

		const finalSuggestion = joinCompletion(prefix, suggestion);

		yield {
			display_suggestion: finalSuggestion,
			complete_suggestion: finalSuggestion,
		};
	}

	async generateNextSentence(contentBeforeCursor: string, contentAfterCursor: string): Promise<string> {
		// Create a completions-specific model API
		const modelApi = ModelClientFactory.createCompletionsModel(this.plugin);

		let request: BaseModelRequest = {
			kind: 'base',
			prompt: this.prompts.completionsPrompt({
				contentBeforeCursor: contentBeforeCursor,
				contentAfterCursor: contentAfterCursor,
			}),
		};
		const result = await modelApi.generateModelResponse(request);
		return result.markdown.replace(/\n$/, ''); // Remove trailing newline if it exists
	}

	async setupCompletions() {
		const { extension, force_fetch } = forceableInlineSuggestion({
			fetchFn: () => this.complete(),
		});
		this.force_fetch = force_fetch;
		// registerEditorExtension will handle unloading the extension when the plugin is disabled
		this.plugin.registerEditorExtension(extension);
	}

	async setupCompletionsCommands() {
		try {
			this.plugin.addCommand({
				id: 'toggle-completions',
				name: t('command.toggleCompletions'),
				callback: () => {
					// Use callback instead of editorCallback
					this.completionsOn = !this.completionsOn;
					new Notice(this.completionsOn ? t('notice.completions.enabled') : t('notice.completions.disabled'));
					if (this.completionsOn) {
						this.force_fetch();
					}
				},
			});
		} catch (error) {
			this.plugin.logger.error('Error setting up completion commands:', error);
		}
	}
}
