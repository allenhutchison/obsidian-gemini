import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";

export class GeminiSuggest extends EditorSuggest<string> {

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        console.log("onTrigger", cursor, editor, file);
        const currentLine = editor.getLine(cursor.line);
        const match = currentLine.substring(0, cursor.ch).match(/(\w+)$/);
        if (match) {
            return {
                start: { line: cursor.line, ch: cursor.ch - match[0].length },
                end: cursor,
                query: match[0]
            };
        }
        return null;
    }

    getSuggestions(context: EditorSuggestContext): string[] | Promise<string[]> {
        console.log("getSuggestions", context);
        return ["Hello", "From", "getSuggestions"]
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        console.log("renderSuggestion", value, el);
        el.setText(value);
    }
    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        console.log("selectSuggestion", value, evt);
    }
    
    constructor(app: any) {
        super(app);
    }
}