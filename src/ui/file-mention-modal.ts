import { FuzzySuggestModal, TFile, TFolder, TAbstractFile } from 'obsidian';
import { shouldExcludePathForPlugin } from '../utils/file-utils';
import type ObsidianGemini from '../main';

export class FileMentionModal extends FuzzySuggestModal<TAbstractFile> {
	private onSelect: (file: TAbstractFile) => void;
	private plugin: InstanceType<typeof ObsidianGemini>;

	constructor(app: any, onSelect: (file: TAbstractFile) => void, plugin: InstanceType<typeof ObsidianGemini>) {
		super(app);
		this.onSelect = onSelect;
		this.plugin = plugin;
		this.setPlaceholder('Select a file or folder to mention...');
	}

	getItems(): TAbstractFile[] {
		const items: TAbstractFile[] = [];

		// Add all markdown files except those in excluded folders
		const allFiles = this.app.vault.getMarkdownFiles();
		const filteredFiles = allFiles.filter((file: TFile) =>
			!shouldExcludePathForPlugin(file.path, this.plugin)
		);
		items.push(...filteredFiles);

		// Add all folders except system and plugin folders
		const addFolders = (folder: TFolder) => {
			// Skip excluded folders
			if (shouldExcludePathForPlugin(folder.path, this.plugin)) return;
			
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