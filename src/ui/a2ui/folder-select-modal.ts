import { App, Modal, Setting, TFolder, normalizePath } from 'obsidian';

/**
 * Modal to select a folder for saving A2UI content
 */
export class A2UIFolderSelectModal extends Modal {
	private selectedFolder: string = '';
	private onSelect: (folder: string, remember: boolean) => void;
	private folders: TFolder[];

	constructor(app: App, onSelect: (folder: string, remember: boolean) => void) {
		super(app);
		this.onSelect = onSelect;
		this.folders = app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('a2ui-folder-select-modal');

		contentEl.createEl('h2', { text: 'Select Save Location' });
		contentEl.createEl('p', {
			text: 'Choose where to save A2UI content in your vault.',
			cls: 'setting-item-description',
		});

		// Folder dropdown
		new Setting(contentEl)
			.setName('Folder')
			.setDesc('Select a folder or create "Inbox" as default')
			.addDropdown((dropdown) => {
				// Add common options
				dropdown.addOption('Inbox', 'Inbox (recommended)');
				dropdown.addOption('', '— Vault root —');

				// Add existing folders
				for (const folder of this.folders) {
					if (folder.path && folder.path !== '/') {
						dropdown.addOption(folder.path, folder.path);
					}
				}

				dropdown.setValue('Inbox');
				this.selectedFolder = 'Inbox';

				dropdown.onChange((value) => {
					this.selectedFolder = value;
				});
			});

		// Remember checkbox
		let rememberChoice = true;
		new Setting(contentEl)
			.setName('Remember this choice')
			.setDesc('Save this folder as the default for future saves')
			.addToggle((toggle) => {
				toggle.setValue(true);
				toggle.onChange((value) => {
					rememberChoice = value;
				});
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		buttonContainer.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
			this.close();
		});

		const saveButton = buttonContainer.createEl('button', {
			text: 'Save Here',
			cls: 'mod-cta',
		});
		saveButton.addEventListener('click', () => {
			this.onSelect(this.selectedFolder, rememberChoice);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
