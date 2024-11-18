import ObsidianGemini from "../main";
import { MarkdownView, Editor } from "obsidian";
import { FileContextTree } from "./file-context";
import {
	forceableInlineSuggestion,
	Suggestion,
} from "codemirror-companion-extension";

export class GeminiCompletions {
    private plugin: ObsidianGemini;
    private force_fetch: () => void = () => {};

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }

    async setupCompletions() {
        const { extension, force_fetch } = forceableInlineSuggestion({
			fetchFn: () => this.complete(),
		});
        this.force_fetch = force_fetch;
        this.plugin.registerEditorExtension(extension);
        console.log("Gemini completions initialized.");
    }

    async setupSuggestionCommands() {
		this.plugin.addCommand({
			id: "accept",
			name: "Accept completion",
			editorCallback: (editor: Editor) => this.acceptCompletion(editor),
		});
        this.plugin.addCommand({
			id: "suggest",
			name: "Generate completion",
			editorCallback: () => this.force_fetch(),
		});
    }

    async acceptCompletion(editor: Editor) {
		const suggestion = "hi there from acceptCompletion";
		if (suggestion) {
			editor.replaceRange(suggestion, editor.getCursor());
			editor.setCursor({
				ch:
					suggestion.split("\n").length > 1
						? suggestion.split("\n")[
								suggestion.split("\n").length - 1
						  ].length
						: editor.getCursor().ch + suggestion.length,
				line:
					editor.getCursor().line + suggestion.split("\n").length - 1,
			});
            this.force_fetch();
		}
	}

    async *complete(): AsyncGenerator<Suggestion> {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		if ((view.editor as any)?.cm?.cm?.state?.keyMap === "vim") {
			// Don't complete if vim mode is enabled
			// (hehe I know more about the types than typescript does)
			// (thus I can use "as any" wooooo)
			return;
		}

		const cursor = view.editor.getCursor();
		const currentLine = view.editor.getLine(cursor.line);
		if (!currentLine.length) {
			yield {
				display_suggestion: "",
				complete_suggestion: "",
			};
			return;
		} // Don't complete on empty lines
		const prefix = view.editor.getRange({ line: 0, ch: 0 }, cursor);
		const suffix = view.editor.getRange(cursor, {
			line: view.editor.lastLine(),
			ch: view.editor.getLine(view.editor.lastLine()).length,
		});
        console.log("Completing...");
        yield* [{ text: "hello world" }];
    }
}