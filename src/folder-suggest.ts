import { AbstractInputSuggest, TFolder, App } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private inputEl: HTMLInputElement;
	private folderSelectCallback: (folder: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onSelect: (folder: string) => void) {
		super(app, inputEl);
		this.inputEl = inputEl;
		this.folderSelectCallback = onSelect;
	}

	getSuggestions(inputStr: string): TFolder[] {
		const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder) as TFolder[];
		return folders.filter((folder) => folder.path.toLowerCase().contains(inputStr.toLowerCase()));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder, evt: MouseEvent | KeyboardEvent): void {
		this.inputEl.value = folder.path;
		this.inputEl.trigger('input');
		this.close();
		this.folderSelectCallback(folder.path);
	}
}
