import { FuzzySuggestModal, TFile, TFolder, TAbstractFile } from 'obsidian';

export class FileMentionModal extends FuzzySuggestModal<TAbstractFile> {
	private onSelect: (file: TAbstractFile) => void;

	constructor(app: any, onSelect: (file: TAbstractFile) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder('Select a file or folder to mention...');
	}

	getItems(): TAbstractFile[] {
		const items: TAbstractFile[] = [];
		
		// Add all markdown files
		items.push(...this.app.vault.getMarkdownFiles());
		
		// Add all folders except system folders
		const addFolders = (folder: TFolder) => {
			// Skip system folders
			if (folder.path === '.obsidian' || folder.path.startsWith('.obsidian/')) return;
			if (folder.path === 'gemini-scribe' || folder.path.startsWith('gemini-scribe/')) return;
			
			if (folder.path) { // Don't add root folder
				items.push(folder);
			}
			
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					addFolders(child);
				}
			}
		};
		
		addFolders(this.app.vault.getRoot());
		
		return items;
	}

	getItemText(item: TAbstractFile): string {
		if (item instanceof TFolder) {
			return `📁 ${item.path}/`;
		}
		return item.path;
	}

	onChooseItem(item: TAbstractFile, evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}
}