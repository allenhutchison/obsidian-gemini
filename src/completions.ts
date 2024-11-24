import ObsidianGemini from "../main";
import { MarkdownView, Editor, debounce } from "obsidian";
import { FileContextTree } from "./file-context";
import { forceableInlineSuggestion, Suggestion } from "codemirror-companion-extension";

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
        
        // Check if last character before cursor is a space
        const needsSpace = prefix.length > 0 && !prefix.endsWith(' ');
        
        const content = editor.getRange({ line: 0, ch: 0 }, cursor);
        const suggestion = await this.plugin.geminiApi.generateNextSentence(content);
        
        // Add space to suggestion if needed
        const finalSuggestion = needsSpace ? ' ' + suggestion : suggestion;
        
        yield {
            display_suggestion: finalSuggestion,
            complete_suggestion: finalSuggestion,
        };
    }

    async setupCompletions() {
        const { extension, force_fetch } = forceableInlineSuggestion({
            fetchFn: () => this.complete(),
        });
        this.force_fetch = force_fetch;
        this.plugin.registerEditorExtension(extension);
        console.debug("Gemini completions initialized.");
    }

    async setupSuggestionCommands() {

        this.plugin.addCommand({
            id: "suggest", 
            name: "Generate completion",
            editorCallback: () => this.force_fetch(),
        });
    }
}