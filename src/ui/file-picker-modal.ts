import { App, Modal, TFile, Setting } from 'obsidian';
import { shouldExcludePath } from '../utils/file-utils';

export class FilePickerModal extends Modal {
	private onSelect: (files: TFile[]) => void;
	private selectedFiles: Set<TFile> = new Set();
	private excludeFolder: string;

	constructor(app: App, onSelect: (files: TFile[]) => void, excludeFolder?: string) {
		super(app);
		this.onSelect = onSelect;
		this.excludeFolder = excludeFolder || '';
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Add Context Files' });

		// Get all markdown files in the vault, excluding system and plugin folders
		const allFiles = this.app.vault.getMarkdownFiles();
		const markdownFiles = allFiles.filter(file =>
			!shouldExcludePath(file.path, this.excludeFolder)
		);

		// Create a container for the file list
		const fileListContainer = contentEl.createDiv({ cls: 'gemini-file-picker-list' });

		// Add each file as a checkbox option
		markdownFiles.forEach(file => {
			const fileItem = fileListContainer.createDiv({ cls: 'gemini-file-picker-item' });
			
			const checkbox = fileItem.createEl('input', {
				type: 'checkbox',
				value: file.path
			});
			
			const label = fileItem.createEl('label', {
				text: file.path,
				cls: 'gemini-file-picker-label'
			});
			
			label.addEventListener('click', () => {
				checkbox.checked = !checkbox.checked;
				this.updateSelection(file, checkbox.checked);
			});
			
			checkbox.addEventListener('change', () => {
				this.updateSelection(file, checkbox.checked);
			});
		});

		// Add buttons
		const buttonContainer = contentEl.createDiv({ cls: 'gemini-file-picker-buttons' });
		
		const selectButton = buttonContainer.createEl('button', {
			text: 'Add Selected Files',
			cls: 'mod-cta'
		});
		
		selectButton.addEventListener('click', () => {
			this.onSelect(Array.from(this.selectedFiles));
			this.close();
		});
		
		const cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel'
		});
		
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	private updateSelection(file: TFile, selected: boolean) {
		if (selected) {
			this.selectedFiles.add(file);
		} else {
			this.selectedFiles.delete(file);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}