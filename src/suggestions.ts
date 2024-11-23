import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import ObsidianGemini from "../main";

interface Suggestion {
    text: string;
}

export class GeminiSuggest extends EditorSuggest<Suggestion> {
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        super(plugin.app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        const currentLine = editor.getLine(cursor.line);
        // Trigger after typing 3 or more characters
        const match = currentLine.substring(0, cursor.ch).match(/(\w{3,})$/);
        
        if (match) {
            return {
                start: { line: cursor.line, ch: cursor.ch - match[0].length },
                end: cursor,
                query: match[0]
            };
        }
        return null;
    }

    async getSuggestions(context: EditorSuggestContext): Promise<Suggestion[]> {
        // Return array of suggestion objects
        return [
            { text: "Hello" },
            { text: "World" },
            { text: context.query }
        ];
    }

    renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
        // Render each suggestion in dropdown
        el.createDiv({ text: suggestion.text });
    }

    selectSuggestion(suggestion: Suggestion, evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) return;

        // Replace text in editor when suggestion selected
        const editor = this.context.editor;
        editor.replaceRange(
            suggestion.text,
            this.context.start,
            this.context.end
        );
    }
}