import { App, TFile, TFolder, setIcon, setTooltip } from 'obsidian';
import { InlineAttachment } from './inline-attachment';
import { classifyFile, FileCategory } from '../../utils/file-classification';

/**
 * Recursively collects all supported text files from a folder,
 * skipping paths that the caller marks as excluded (system/plugin state folders).
 * @param folder The folder to collect from
 * @param isExcluded Predicate that returns true for paths to skip
 */
export function getTextFilesFromFolder(folder: TFolder, isExcluded?: (path: string) => boolean): TFile[] {
	const files: TFile[] = [];
	const collect = (f: TFolder) => {
		for (const child of f.children) {
			if (child instanceof TFile) {
				if (isExcluded?.(child.path)) continue;
				const result = classifyFile(child.extension);
				if (result.category === FileCategory.TEXT) {
					files.push(child);
				}
			} else if (child instanceof TFolder) {
				if (isExcluded?.(child.path)) continue;
				collect(child);
			}
		}
	};
	collect(folder);
	return files;
}

/**
 * Represents an item in the unified file shelf.
 * Can be a persistent text file, an ephemeral binary attachment, or a folder.
 */
export interface ShelfItem {
	id: string;
	type: 'text' | 'binary' | 'folder';
	/** Display name */
	name: string;
	/** Vault path (for text files and folders) */
	path?: string;
	/** TFile reference (for text files) */
	file?: TFile;
	/** TFolder reference (for folders) */
	folder?: TFolder;
	/** Expanded files (for folders) */
	expandedFiles?: TFile[];
	/** Inline attachment data (for binary files) */
	attachment?: InlineAttachment;
	/** Whether this item has been sent in a message */
	sent?: boolean;
}

export interface ShelfCallbacks {
	onRemoveTextFile: (file: TFile) => void;
	onRemoveFolder: (files: TFile[]) => void;
	onRemoveAttachment: (id: string) => void;
}

/**
 * Unified file shelf component that displays all attached files
 * (text, binary, folders) in a single horizontal row above the input area.
 */
export class AgentViewShelf {
	private app: App;
	private container: HTMLElement;
	private items: ShelfItem[] = [];
	private callbacks: ShelfCallbacks;

	constructor(app: App, parent: HTMLElement, callbacks: ShelfCallbacks, insertBefore?: HTMLElement) {
		this.app = app;
		this.container = parent.createDiv({ cls: 'gemini-agent-shelf' });
		if (insertBefore) {
			parent.insertBefore(this.container, insertBefore);
		}
		this.callbacks = callbacks;
	}

	/**
	 * Add a persistent text file to the shelf
	 */
	addTextFile(file: TFile): ShelfItem | null {
		if (this.items.some((item) => item.type === 'text' && item.path === file.path)) {
			return null; // Already in shelf
		}
		const item: ShelfItem = {
			id: `shelf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			type: 'text',
			name: file.basename,
			path: file.path,
			file,
		};
		this.items.push(item);
		this.render();
		return item;
	}

	/**
	 * Add a folder to the shelf
	 */
	addFolder(folder: TFolder, expandedFiles: TFile[]): ShelfItem | null {
		if (this.items.some((item) => item.type === 'folder' && item.path === folder.path)) {
			return null;
		}
		const item: ShelfItem = {
			id: `shelf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			type: 'folder',
			name: `${folder.name}/`,
			path: folder.path,
			folder,
			expandedFiles,
		};
		this.items.push(item);
		this.render();
		return item;
	}

	/**
	 * Add a binary attachment to the shelf
	 */
	addBinaryAttachment(attachment: InlineAttachment): ShelfItem | null {
		if (this.items.some((item) => item.type === 'binary' && item.attachment?.id === attachment.id)) {
			return null;
		}
		const item: ShelfItem = {
			id: attachment.id,
			type: 'binary',
			name: attachment.fileName || 'Attachment',
			attachment,
		};
		this.items.push(item);
		this.render();
		return item;
	}

	/**
	 * Remove an item from the shelf by id
	 */
	removeItem(id: string): void {
		const index = this.items.findIndex((item) => item.id === id);
		if (index > -1) {
			this.items.splice(index, 1);
			this.render();
		}
	}

	/**
	 * Mark all binary items as sent
	 */
	markBinarySent(): void {
		for (const item of this.items) {
			if (item.type === 'binary') {
				item.sent = true;
			}
		}
		this.render();
	}

	/**
	 * Remove all binary items that have been sent (cleanup after message)
	 */
	clearSentBinary(): void {
		this.items = this.items.filter((item) => !(item.type === 'binary' && item.sent));
		this.render();
	}

	/**
	 * Get all current shelf items
	 */
	getItems(): ShelfItem[] {
		return [...this.items];
	}

	/**
	 * Get all persistent text files (for context building)
	 */
	getTextFiles(): TFile[] {
		const seen = new Map<string, TFile>();
		for (const item of this.items) {
			if (item.type === 'text' && item.file) {
				seen.set(item.file.path, item.file);
			} else if (item.type === 'folder' && item.expandedFiles) {
				for (const file of item.expandedFiles) {
					seen.set(file.path, file);
				}
			}
		}
		return [...seen.values()];
	}

	/**
	 * Get all pending (unsent) binary attachments
	 */
	getPendingAttachments(): InlineAttachment[] {
		return this.items
			.filter((item) => item.type === 'binary' && !item.sent && item.attachment)
			.map((item) => item.attachment!);
	}

	/**
	 * Clear all items
	 */
	clear(): void {
		this.items = [];
		this.render();
	}

	/**
	 * Populate shelf from session context files (for loading existing sessions)
	 */
	loadFromSession(contextFiles: TFile[]): void {
		this.items = [];
		for (const file of contextFiles) {
			this.items.push({
				id: `shelf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
				type: 'text',
				name: file.basename,
				path: file.path,
				file,
			});
		}
		this.render();
	}

	/**
	 * Render the shelf
	 */
	private render(): void {
		this.container.empty();

		if (this.items.length === 0) {
			this.container.style.display = 'none';
			return;
		}

		this.container.style.display = 'flex';

		for (const item of this.items) {
			const el = this.container.createDiv({ cls: 'gemini-shelf-item' });

			if (item.sent) {
				el.addClass('gemini-shelf-item-sent');
			}

			this.renderItemContent(el, item);

			// Tooltip with full path
			const tooltipText = item.path || item.attachment?.vaultPath || item.attachment?.fileName || item.name;
			setTooltip(el, tooltipText);

			// Click or keyboard-activate to open file in Obsidian
			const openPath = item.path || item.attachment?.vaultPath;
			if (openPath) {
				el.style.cursor = 'pointer';
				el.tabIndex = 0;
				el.setAttribute('role', 'button');
				el.addEventListener('click', (e) => {
					if ((e.target as HTMLElement).closest('.gemini-shelf-remove')) return;
					this.app.workspace.openLinkText(openPath, '', false);
				});
			}

			// Keyboard navigation: Enter/Space to open, Delete/Backspace to remove,
			// Arrow Left/Right to move focus between items
			el.tabIndex = 0;
			el.addEventListener('keydown', (e) => {
				if ((e.target as HTMLElement).closest('.gemini-shelf-remove')) return;
				if ((e.key === 'Enter' || e.key === ' ') && openPath) {
					e.preventDefault();
					this.app.workspace.openLinkText(openPath, '', false);
				} else if (e.key === 'Delete' || e.key === 'Backspace') {
					e.preventDefault();
					const next = el.nextElementSibling as HTMLElement | null;
					const prev = el.previousElementSibling as HTMLElement | null;
					this.handleRemove(item);
					(next || prev)?.focus();
				} else if (e.key === 'ArrowRight') {
					e.preventDefault();
					(el.nextElementSibling as HTMLElement | null)?.focus();
				} else if (e.key === 'ArrowLeft') {
					e.preventDefault();
					(el.previousElementSibling as HTMLElement | null)?.focus();
				}
			});

			// Persistent badge for text files and folders
			if (item.type === 'text' || item.type === 'folder') {
				const badge = el.createSpan({ cls: 'gemini-shelf-badge' });
				setIcon(badge, 'pin');
				badge.setAttribute('aria-label', 'Included in every message');
			}

			// Remove button (tabindex=-1 so keyboard nav stays on shelf items; use Delete key instead)
			const removeBtn = el.createEl('button', {
				text: '×',
				cls: 'gemini-shelf-remove',
				attr: { title: 'Remove', 'aria-label': 'Remove', tabindex: '-1' },
			});
			removeBtn.addEventListener('click', () => this.handleRemove(item));
		}
	}

	private renderItemContent(el: HTMLElement, item: ShelfItem): void {
		switch (item.type) {
			case 'binary': {
				if (item.attachment?.mimeType.startsWith('image/')) {
					el.addClass('gemini-shelf-item-image');
					el.createEl('img', {
						attr: {
							src: `data:${item.attachment.mimeType};base64,${item.attachment.base64}`,
							alt: item.name,
						},
					});
				} else {
					el.addClass('gemini-shelf-item-file');
					const iconEl = el.createDiv({ cls: 'gemini-shelf-icon' });
					setIcon(iconEl, this.getIconForItem(item));
					el.createSpan({ text: item.name, cls: 'gemini-shelf-name' });
				}
				break;
			}
			case 'folder': {
				el.addClass('gemini-shelf-item-file');
				const iconEl = el.createDiv({ cls: 'gemini-shelf-icon' });
				setIcon(iconEl, 'folder');
				const fileCount = item.expandedFiles?.length ?? 0;
				el.createSpan({
					text: `${item.name} (${fileCount})`,
					cls: 'gemini-shelf-name',
				});
				break;
			}
			case 'text': {
				el.addClass('gemini-shelf-item-file');
				const iconEl = el.createDiv({ cls: 'gemini-shelf-icon' });
				const ext = item.file?.extension || 'md';
				const classification = classifyFile(ext);
				const iconName =
					classification.category === FileCategory.TEXT ? 'file-text' : this.getIconForMime(classification.mimeType);
				setIcon(iconEl, iconName);
				el.createSpan({ text: item.name, cls: 'gemini-shelf-name' });
				break;
			}
		}
	}

	private getIconForItem(item: ShelfItem): string {
		if (item.attachment?.mimeType) {
			return this.getIconForMime(item.attachment.mimeType);
		}
		return 'file';
	}

	private getIconForMime(mimeType: string): string {
		if (mimeType === 'application/pdf') return 'file-text';
		if (mimeType.startsWith('audio/')) return 'music';
		if (mimeType.startsWith('video/')) return 'video';
		if (mimeType.startsWith('image/')) return 'image';
		return 'file';
	}

	private handleRemove(item: ShelfItem): void {
		this.removeItem(item.id);
		switch (item.type) {
			case 'text':
				if (item.file) this.callbacks.onRemoveTextFile(item.file);
				break;
			case 'folder':
				if (item.expandedFiles) this.callbacks.onRemoveFolder(item.expandedFiles);
				break;
			case 'binary':
				if (item.attachment) this.callbacks.onRemoveAttachment(item.attachment.id);
				break;
		}
	}
}
