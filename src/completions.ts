import ObsidianGemini from "../main";
import { MarkdownView, Editor, debounce } from "obsidian";
import { FileContextTree } from "./file-context";
import {
    forceableInlineSuggestion,
    Suggestion,
} from "codemirror-companion-extension";

export class GeminiCompletions {
    private plugin: ObsidianGemini;
    private force_fetch: () => void = () => {};
    private readonly TYPING_DELAY = 750; // ms to wait after typing stops
    private debouncedComplete: () => void;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
        this.debouncedComplete = debounce(
            () => this.force_fetch(),
            this.TYPING_DELAY,
            true
        );
    }

    async *complete(): AsyncGenerator<Suggestion> {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        
        const editor = view.editor;
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const prefix = line.substring(0, cursor.ch);
        
        // Only trigger after 3+ characters
        const match = prefix.match(/(\w{3,})$/);
        if (match) {
            const suggestion = " world"; // Replace with real completion logic
            yield {
                display_suggestion: suggestion,
                complete_suggestion: suggestion,
            };
        }
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
        // Accept current ghost text suggestion
        // Implementation depends on how suggestions are stored
    }
}