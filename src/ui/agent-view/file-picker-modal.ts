import { App, prepareFuzzySearch, setIcon, SuggestModal, TAbstractFile, TFile, TFolder } from 'obsidian';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import type ObsidianGemini from '../../main';

/** Undocumented internal SuggestModal API for programmatic highlight control. */
interface SuggestModalChooser {
	selectedItem: number;
	setSelectedItem(index: number, scrollIntoView: boolean): void;
	suggestions: HTMLElement[];
}

export class FilePickerModal extends SuggestModal<TAbstractFile> {
	private onSelect: (files: TFile[]) => void;
	private selectedFiles: Set<TFile>;
	private plugin: InstanceType<typeof ObsidianGemini>;
	private allItems: TAbstractFile[] = [];
	private folderFilesCache: Map<TFolder, TFile[]> = new Map();
	private lastSuggestions: TAbstractFile[] = [];

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

		const allFiles = this.allItems.filter((item): item is TFile => item instanceof TFile);
		for (const item of this.allItems) {
			if (item instanceof TFolder) {
				const prefix = item.path + '/';
				this.folderFilesCache.set(
					item,
					allFiles.filter((f) => f.path.startsWith(prefix))
				);
			}
		}
	}

	getSuggestions(query: string): TAbstractFile[] {
		const trimmed = query.trim();
		if (!trimmed) {
			this.lastSuggestions = this.allItems;
			return this.lastSuggestions;
		}
		const search = prepareFuzzySearch(trimmed);
		this.lastSuggestions = this.allItems
			.map((item) => ({ item, result: search(item.path) }))
			.filter(({ result }) => result !== null)
			.sort((a, b) => b.result!.score - a.result!.score)
			.map(({ item }) => item);
		return this.lastSuggestions;
	}

	renderSuggestion(item: TAbstractFile, el: HTMLElement): void {
		const isFolder = item instanceof TFolder;
		const container = el.createDiv({ cls: 'suggestion-content' });
		const aux = container.createDiv({ cls: 'suggestion-aux' });
		setIcon(aux, this.getIconForItem(item));

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

		// In-place checkbox update: touch only affected DOM elements
		const chooser = (this as any).chooser as SuggestModalChooser | undefined;
		const suggestions = chooser?.suggestions;

		if (suggestions && suggestions.length === this.lastSuggestions.length && this.lastSuggestions.length > 0) {
			const affectedFiles: Set<TFile> = new Set(
				item instanceof TFolder ? this.getFilesInFolder(item) : [item as TFile]
			);

			for (let i = 0; i < this.lastSuggestions.length; i++) {
				const suggestion = this.lastSuggestions[i];
				if (suggestion instanceof TFolder) {
					if (this.getFilesInFolder(suggestion).some((f) => affectedFiles.has(f))) {
						this.updateCheckboxAt(suggestions, i);
					}
				} else if (affectedFiles.has(suggestion as TFile)) {
					this.updateCheckboxAt(suggestions, i);
				}
			}
		} else {
			// Fallback: full re-render when chooser internals are unavailable or out of sync
			const scrollTop = this.resultContainerEl.scrollTop;
			const selectedIndex = chooser?.selectedItem ?? 0;
			this.inputEl.dispatchEvent(new Event('input'));
			requestAnimationFrame(() => {
				this.resultContainerEl.scrollTop = scrollTop;
				chooser?.setSelectedItem(selectedIndex, false);
			});
		}
	}

	// Required by abstract interface; selection is handled in selectSuggestion
	onChooseSuggestion(_item: TAbstractFile, _evt: MouseEvent | KeyboardEvent): void {}

	private getFilesInFolder(folder: TFolder): TFile[] {
		return this.folderFilesCache.get(folder) ?? [];
	}

	private getIconForItem(item: TAbstractFile): string {
		if (item instanceof TFolder) {
			const folderFiles = this.getFilesInFolder(item);
			const selectedCount = folderFiles.filter((f) => this.selectedFiles.has(f)).length;
			return selectedCount === 0 ? 'square' : selectedCount === folderFiles.length ? 'check-square' : 'minus-square';
		}
		return this.selectedFiles.has(item as TFile) ? 'check-square' : 'square';
	}

	private updateCheckboxAt(chooserSuggestions: HTMLElement[], index: number): void {
		const el = chooserSuggestions[index];
		if (!el) return;
		const aux = el.querySelector('.suggestion-aux') as HTMLElement | null;
		if (!aux) return;
		setIcon(aux, this.getIconForItem(this.lastSuggestions[index]));
	}

	onClose(): void {
		this.onSelect(Array.from(this.selectedFiles));
		this.contentEl.empty();
	}
}
