import ObsidianGemini from '../main';
import { MarkdownView, debounce, Notice } from 'obsidian';
import { forceableInlineSuggestion, Suggestion } from 'codemirror-companion-extension';
import { BaseModelRequest } from './api/index';
import { GeminiPrompts } from './prompts';

export class GeminiCompletions {
	private plugin: ObsidianGemini;
	private prompts: GeminiPrompts;
	private force_fetch: () => void = () => {};
	private readonly TYPING_DELAY = 750; // ms to wait after typing stops
	private debouncedComplete: () => void;
	private completionsOn: boolean = false;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
		this.debouncedComplete = debounce(() => this.force_fetch(), this.TYPING_DELAY, true);
	}

	async *complete(): AsyncGenerator<Suggestion> {
		if (!this.completionsOn) return;
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const editor = view.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const prefix = line.substring(0, cursor.ch);

		// Check if last character before cursor is a space
		const needsSpace = prefix.length > 0 && !prefix.endsWith(' ');

		const contentBeforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
		const contentAfterCursor = editor.getRange(cursor, {
			line: editor.lastLine(),
			ch: editor.getLine(editor.lastLine()).length,
		});
		const suggestion = await this.generateNextSentence(contentBeforeCursor, contentAfterCursor);

		// Add space to suggestion if needed
		const finalSuggestion = needsSpace ? ' ' + suggestion : suggestion;

		yield {
			display_suggestion: finalSuggestion,
			complete_suggestion: finalSuggestion,
		};
	}

	async generateNextSentence(contentBeforeCursor: string, contentAfterCursor: string): Promise<string> {
		let request: BaseModelRequest = {
			model: this.plugin.settings.completionsModelName,
			prompt: this.prompts.completionsPrompt({
				contentBeforeCursor: contentBeforeCursor,
				contentAfterCursor: contentAfterCursor,
			}),
		};
		const result = await this.plugin.geminiApi.generateModelResponse(request);
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
				id: 'gemini-scribe-toggle-completions', // Add plugin prefix
				name: 'Toggle completions',
				callback: () => {
					// Use callback instead of editorCallback
					this.completionsOn = !this.completionsOn;
					new Notice(`Gemini Scribe Completions are now ${this.completionsOn ? 'enabled' : 'disabled'}.`);
					if (this.completionsOn) {
						this.force_fetch();
					}
				},
			});
		} catch (error) {
			console.error('Error setting up completion commands:', error);
		}
	}
}
