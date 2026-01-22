import { TFile, TFolder, App, setIcon } from 'obsidian';
import {
	getDOMContext,
	createContextElement,
	createContextTextNode,
	insertNodeAtCursor
} from '../../utils/dom-context';

/**
 * Manages file and folder chips in the agent input area
 * Handles @ mentions, chip creation, and message extraction
 */
export class AgentViewFileChips {
	private app: App;
	private userInput: HTMLDivElement;
	private mentionedFiles: TFile[];

	constructor(app: App, userInput: HTMLDivElement) {
		this.app = app;
		this.userInput = userInput;
		this.mentionedFiles = [];
	}

	/**
	 * Gets the current list of mentioned files
	 */
	getMentionedFiles(): TFile[] {
		return this.mentionedFiles;
	}

	/**
	 * Clears the mentioned files list
	 */
	clearMentionedFiles(): void {
		this.mentionedFiles = [];
	}

	/**
	 * Adds a file to the mentioned files list
	 */
	addMentionedFile(file: TFile): void {
		if (!this.mentionedFiles.includes(file)) {
			this.mentionedFiles.push(file);
		}
	}

	/**
	 * Removes a file from the mentioned files list
	 */
	removeMentionedFile(file: TFile): void {
		const index = this.mentionedFiles.indexOf(file);
		if (index > -1) {
			this.mentionedFiles.splice(index, 1);
		}
	}

	/**
	 * Recursively collects all markdown files from a folder
	 */
	getFilesFromFolder(folder: TFolder): TFile[] {
		const files: TFile[] = [];

		const collectFiles = (f: TFolder) => {
			for (const child of f.children) {
				if (child instanceof TFile && child.extension === 'md') {
					files.push(child);
				} else if (child instanceof TFolder) {
					collectFiles(child);
				}
			}
		};

		collectFiles(folder);
		return files;
	}

	/**
	 * Creates a file chip HTML element
	 */
	createFileChip(file: TFile, onRemove: (file: TFile) => void): HTMLElement {
		// Use the correct document context
		const chip = createContextElement(this.userInput, 'span');
		chip.className = 'gemini-agent-file-chip';
		chip.contentEditable = 'false';
		chip.setAttribute('data-file-path', file.path);

		// File icon
		const icon = chip.createSpan({ cls: 'gemini-agent-file-chip-icon' });
		setIcon(icon, 'file-text');

		// File name
		chip.createSpan({
			text: file.basename,
			cls: 'gemini-agent-file-chip-name'
		});

		// Remove button
		const removeBtn = chip.createSpan({
			text: '×',
			cls: 'gemini-agent-file-chip-remove'
		});

		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			chip.remove();
			this.removeMentionedFile(file);
			onRemove(file);
		});

		return chip;
	}

	/**
	 * Creates a folder chip HTML element
	 */
	createFolderChip(folder: TFolder, fileCount: number, onRemove: (files: TFile[]) => void): HTMLElement {
		// Use the correct document context
		const chip = createContextElement(this.userInput, 'span');
		chip.className = 'gemini-agent-folder-chip';
		chip.contentEditable = 'false';
		chip.setAttribute('data-folder-path', folder.path);
		chip.setAttribute('data-file-count', fileCount.toString());

		// Folder icon
		const icon = chip.createSpan({ cls: 'gemini-agent-folder-chip-icon' });
		setIcon(icon, 'folder');

		// Folder name with file count
		chip.createSpan({
			text: `${folder.name}/ (${fileCount} files)`,
			cls: 'gemini-agent-folder-chip-name'
		});

		// Remove button
		const removeBtn = chip.createSpan({
			text: '×',
			cls: 'gemini-agent-folder-chip-remove'
		});

		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			chip.remove();
			// Remove all files from this folder from mentioned files
			const folderFiles = this.getFilesFromFolder(folder);
			for (const file of folderFiles) {
				this.removeMentionedFile(file);
			}
			onRemove(folderFiles);
		});

		return chip;
	}

	/**
	 * Inserts a chip at the current cursor position
	 */
	insertChipAtCursor(chip: HTMLElement): void {
		// Insert the chip at cursor position
		insertNodeAtCursor(this.userInput, chip);

		// Add a non-breaking space after the chip to ensure it's preserved
		const space = createContextTextNode(this.userInput, '\u00A0'); // Non-breaking space
		chip.after(space);

		// Move cursor after the space
		const { doc, win } = getDOMContext(this.userInput);
		const selection = win.getSelection();
		if (selection) {
			const range = doc.createRange();
			range.setStartAfter(space);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		}

		// Focus back on input
		this.userInput.focus();
	}

	/**
	 * Extracts message content from the user input
	 * Returns plain text, file list, and formatted message with markdown links
	 */
	extractMessageContent(): { text: string; files: TFile[]; formattedMessage: string } {
		// Clone the input to process
		const clone = this.userInput.cloneNode(true) as HTMLElement;

		// Replace file and folder chips with markdown links in the clone
		const fileChips = clone.querySelectorAll('.gemini-agent-file-chip');
		fileChips.forEach((chip: Element) => {
			const filePath = chip.getAttribute('data-file-path');
			if (filePath) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					// Create wikilink with full path and basename alias
					// Format: [[full/path/to/file.md|DisplayName]]
					const wikilink = `[[${file.path}|${file.basename}]]`;
					const link = document.createTextNode(wikilink);
					chip.replaceWith(link);
				}
			}
		});

		const folderChips = clone.querySelectorAll('.gemini-agent-folder-chip');
		folderChips.forEach((chip: Element) => {
			const folderPath = chip.getAttribute('data-folder-path');
			const fileCount = chip.getAttribute('data-file-count');
			if (folderPath) {
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (folder instanceof TFolder) {
					// Create wikilink-style representation for folder
					// Shows full path to be clear about location
					const folderLink = `[[${folderPath}/|${folder.name}/]] (${fileCount} files)`;
					const text = document.createTextNode(folderLink);
					chip.replaceWith(text);
				}
			}
		});

		// Get the formatted message with markdown links
		const formattedMessage = clone.textContent?.trim() || '';

		// Now replace chips with file/folder names to get plain text
		const plainClone = this.userInput.cloneNode(true) as HTMLElement;
		const plainFileChips = plainClone.querySelectorAll('.gemini-agent-file-chip');
		plainFileChips.forEach((chip: Element) => {
			const filePath = chip.getAttribute('data-file-path');
			if (filePath) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					// Replace chip with plain file name
					const textNode = document.createTextNode(file.basename);
					chip.replaceWith(textNode);
				}
			}
		});

		const plainFolderChips = plainClone.querySelectorAll('.gemini-agent-folder-chip');
		plainFolderChips.forEach((chip: Element) => {
			const folderPath = chip.getAttribute('data-folder-path');
			if (folderPath) {
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (folder instanceof TFolder) {
					// Replace chip with folder name
					const textNode = document.createTextNode(folder.name);
					chip.replaceWith(textNode);
				}
			}
		});
		const text = plainClone.textContent?.trim() || '';

		return {
			text,
			files: [...this.mentionedFiles],
			formattedMessage
		};
	}
}
