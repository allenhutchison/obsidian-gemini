import { FuzzySuggestModal, TFile, TFolder, TAbstractFile } from 'obsidian';

export class FileMentionModal extends FuzzySuggestModal<TAbstractFile> {
	private onSelect: (file: TAbstractFile) => void;
	private excludeFolder: string;

	constructor(app: any, onSelect: (file: TAbstractFile) => void, excludeFolder?: string) {
		super(app);
		this.onSelect = onSelect;
		this.excludeFolder = excludeFolder || '';
		this.setPlaceholder('Select a file or folder to mention...');
	}

	getItems(): TAbstractFile[] {
		const items: TAbstractFile[] = [];

		// Add all markdown files except those in excluded folders
		const allFiles = this.app.vault.getMarkdownFiles();
		const filteredFiles = allFiles.filter((file: TFile) => {
			// Exclude files from the plugin state folder and .obsidian folder
			if (this.excludeFolder && (file.path === this.excludeFolder || file.path.startsWith(this.excludeFolder + '/'))) {
				return false;
			}
			if (file.path === '.obsidian' || file.path.startsWith('.obsidian/')) {
				return false;
			}
			return true;
		});
		items.push(...filteredFiles);

		// Add all folders except system folders
		const addFolders = (folder: TFolder) => {
			// Skip system folders
			if (folder.path === '.obsidian' || folder.path.startsWith('.obsidian/')) return;
			// Skip plugin state folder
			if (this.excludeFolder && (folder.path === this.excludeFolder || folder.path.startsWith(this.excludeFolder + '/'))) return;
			
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