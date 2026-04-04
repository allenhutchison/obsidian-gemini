import { FuzzySuggestModal, TFile, TFolder, TAbstractFile } from 'obsidian';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import { classifyFile, FileCategory } from '../../utils/file-classification';
import type ObsidianGemini from '../../main';

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

		// Add all supported files (text + Gemini-supported binary), excluding unsupported types
		const allFiles = this.app.vault.getFiles();
		const filteredFiles = allFiles.filter((file: TFile) => {
			if (shouldExcludePathForPlugin(file.path, this.plugin)) return false;
			const result = classifyFile(file.extension);
			return result.category !== FileCategory.UNSUPPORTED;
		});
		items.push(...filteredFiles);

		// Add all folders except system and plugin folders
		const addFolders = (folder: TFolder) => {
			if (shouldExcludePathForPlugin(folder.path, this.plugin)) return;

			if (folder.path) {
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
		if (item instanceof TFile) {
			const result = classifyFile(item.extension);
			if (result.category === FileCategory.GEMINI_BINARY) {
				const icon = this.getIconForMime(result.mimeType);
				return `${icon} ${item.path}`;
			}
		}
		return item.path;
	}

	onChooseItem(item: TAbstractFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}

	private getIconForMime(mimeType: string): string {
		if (mimeType.startsWith('image/')) return '🖼';
		if (mimeType === 'application/pdf') return '📄';
		if (mimeType.startsWith('audio/')) return '🎵';
		if (mimeType.startsWith('video/')) return '🎬';
		return '📎';
	}
}
