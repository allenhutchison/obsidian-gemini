import { App, prepareFuzzySearch, setIcon, SuggestModal, TAbstractFile, TFile, TFolder } from 'obsidian';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import type ObsidianGemini from '../../main';

export class FilePickerModal extends SuggestModal<TAbstractFile> {
	private onSelect: (files: TFile[]) => void;
	private selectedFiles: Set<TFile>;
	private plugin: InstanceType<typeof ObsidianGemini>;
	private allItems: TAbstractFile[] = [];

	constructor(
		app: App,
		onSelect: (files: TFile[]) => void,
		plugin: InstanceType<typeof ObsidianGemini>,
		initialSelection: TFile[] = []
	) {
		super(app);
		this.modalEl.addClass('gemini-context-file-picker');
		this.onSelect = onSelect;
		this.plugin = plugin;
		this.selectedFiles = new Set(initialSelection);
		this.setPlaceholder('Search files to add as context...');
		this.setInstructions([
			{ command: '↵', purpose: 'toggle selection' },
			{ command: 'esc', purpose: 'confirm and close' },
		]);

		const files = this.app.vault.getMarkdownFiles().filter((f) => !shouldExcludePathForPlugin(f.path, this.plugin));

		const folders: TFolder[] = [];
		const collectFolders = (folder: TFolder) => {
			if (shouldExcludePathForPlugin(folder.path, this.plugin)) return;
			if (folder.path) folders.push(folder); // skip root
			for (const child of folder.children) {
				if (child instanceof TFolder) collectFolders(child);
			}
		};
		collectFolders(this.app.vault.getRoot());

		// Only include folders that contain at least one markdown file
		const nonEmptyFolders = folders.filter((folder) => files.some((file) => file.path.startsWith(folder.path + '/')));

		this.allItems = [...files, ...nonEmptyFolders].sort((a, b) =>
			a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })
		);
	}

	getSuggestions(query: string): TAbstractFile[] {
		if (!query.trim()) {
			return this.allItems;
		}
		const search = prepareFuzzySearch(query);
		return this.allItems
			.map((item) => ({ item, result: search(item.path) }))
			.filter(({ result }) => result !== null)
			.sort((a, b) => b.result!.score - a.result!.score)
			.map(({ item }) => item);
	}

	renderSuggestion(item: TAbstractFile, el: HTMLElement): void {
		const isFolder = item instanceof TFolder;
		const container = el.createDiv({ cls: 'suggestion-content' });
		const aux = container.createDiv({ cls: 'suggestion-aux' });

		if (isFolder) {
			const folderFiles = this.getFilesInFolder(item as TFolder);
			const selectedCount = folderFiles.filter((f) => this.selectedFiles.has(f)).length;
			const icon =
				selectedCount === 0 ? 'square' : selectedCount === folderFiles.length ? 'check-square' : 'minus-square';
			setIcon(aux, icon);
		} else {
			setIcon(aux, this.selectedFiles.has(item as TFile) ? 'check-square' : 'square');
		}

		const titleEl = container.createDiv({ cls: 'suggestion-title' });
		// Always render the folder-icon span so paths align; hide it for plain files
		const folderIconEl = titleEl.createSpan();
		setIcon(folderIconEl, 'folder');
		if (!isFolder) folderIconEl.style.visibility = 'hidden';
		titleEl.createSpan({ text: ' ' + item.path + (isFolder ? '/' : '') });
	}

	// Override to toggle selection without closing the modal
	selectSuggestion(item: TAbstractFile, evt: MouseEvent | KeyboardEvent): void {
		if (item instanceof TFolder) {
			const folderFiles = this.getFilesInFolder(item);
			const allSelected = folderFiles.length > 0 && folderFiles.every((f) => this.selectedFiles.has(f));
			folderFiles.forEach((f) => {
				if (allSelected) {
					this.selectedFiles.delete(f);
				} else {
					this.selectedFiles.add(f);
				}
			});
		} else {
			const file = item as TFile;
			this.selectedFiles.has(file) ? this.selectedFiles.delete(file) : this.selectedFiles.add(file);
		}
		// Re-render checkboxes in-place; preserve scroll position
		const scrollTop = this.resultContainerEl.scrollTop;
		this.inputEl.dispatchEvent(new Event('input'));
		requestAnimationFrame(() => {
			this.resultContainerEl.scrollTop = scrollTop;
		});
	}

	// Required by abstract interface; selection is handled in selectSuggestion
	onChooseSuggestion(_item: TAbstractFile, _evt: MouseEvent | KeyboardEvent): void {}

	private getFilesInFolder(folder: TFolder): TFile[] {
		const prefix = folder.path + '/';
		return this.allItems.filter((item): item is TFile => item instanceof TFile && item.path.startsWith(prefix));
	}

	onClose(): void {
		this.onSelect(Array.from(this.selectedFiles));
		this.contentEl.empty();
	}
}
