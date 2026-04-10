import { TFile, TFolder, TAbstractFile, Notice, App } from 'obsidian';
import { ChatSession } from '../../types/agent';
import { InlineAttachment } from './inline-attachment';
import { AgentViewContext } from './agent-view-context';
import { AgentViewShelf, getTextFilesFromFolder } from './agent-view-shelf';
import { FileMentionModal } from './file-mention-modal';
import { getContextSelection, createContextRange } from '../../utils/dom-context';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import type ObsidianGemini from '../../main';

/**
 * Context interface for the attachments module.
 * Provides access to shared state owned by the orchestrator.
 */
export interface AttachmentsContext {
	plugin: InstanceType<typeof ObsidianGemini>;
	app: App;
	getCurrentSession: () => ChatSession | null;
	getShelf: () => AgentViewShelf;
	getUserInput: () => HTMLDivElement;
	context: AgentViewContext;
	updateSessionHeader: () => void;
	updateSessionMetadata: () => Promise<void>;
}

/**
 * Handles file attachment operations for the agent view:
 * drag-and-drop, paste, @ mention file picker, and attachment persistence.
 */
export class AgentViewAttachments {
	constructor(private ctx: AttachmentsContext) {}

	/**
	 * Show file mention modal for @ mentions
	 */
	async showFileMention(): Promise<void> {
		const modal = new FileMentionModal(
			this.ctx.app,
			async (fileOrFolder: TAbstractFile) => {
				// Remove the @ character that triggered the picker
				this.removeTrailingTriggerChar('@');

				if (fileOrFolder instanceof TFolder) {
					this.ctx.getShelf().addFolder(fileOrFolder);
					// Seed session context with current folder contents. Subsequent turns
					// re-expand the folder via the shelf so new files are picked up (#127).
					const files = getTextFilesFromFolder(fileOrFolder, (path) =>
						shouldExcludePathForPlugin(path, this.ctx.plugin)
					);
					for (const file of files) {
						this.ctx.context.addFileToContext(file, this.ctx.getCurrentSession());
					}
					this.ctx.updateSessionHeader();
					this.ctx.updateSessionMetadata();
					return;
				}

				if (!(fileOrFolder instanceof TFile)) return;

				// Classify the file to determine text vs binary handling
				const { classifyFile, FileCategory, arrayBufferToBase64, detectWebmMimeType, GEMINI_INLINE_DATA_LIMIT } =
					await import('../../utils/file-classification');
				const classification = classifyFile(fileOrFolder.extension);

				if (classification.category === FileCategory.TEXT) {
					this.ctx.getShelf().addTextFile(fileOrFolder);
					this.ctx.context.addFileToContext(fileOrFolder, this.ctx.getCurrentSession());
					this.ctx.updateSessionHeader();
					this.ctx.updateSessionMetadata();
				} else if (classification.category === FileCategory.GEMINI_BINARY) {
					// Handle binary file — create inline attachment (same as drag-drop)
					try {
						const buffer = await this.ctx.app.vault.readBinary(fileOrFolder);
						const existing = this.ctx.getShelf().getPendingAttachments();
						const cumulativeSize =
							existing.reduce((sum, a) => sum + Math.ceil((a.base64.length * 3) / 4), 0) + buffer.byteLength;

						if (cumulativeSize > GEMINI_INLINE_DATA_LIMIT) {
							new Notice(`File too large: ${fileOrFolder.name} exceeds 20MB cumulative attachment limit`, 5000);
							return;
						}

						const base64 = arrayBufferToBase64(buffer);
						const mimeType =
							fileOrFolder.extension.toLowerCase() === 'webm' ? detectWebmMimeType(buffer) : classification.mimeType;
						const { generateAttachmentId } = await import('./inline-attachment');
						const attachment: InlineAttachment = {
							base64,
							mimeType,
							id: generateAttachmentId(),
							vaultPath: fileOrFolder.path,
							fileName: fileOrFolder.name,
						};
						this.addAttachment(attachment);
						new Notice(`Attached ${fileOrFolder.name}`, 2000);
					} catch (err) {
						this.ctx.plugin.logger.error(`Failed to attach ${fileOrFolder.path}:`, err);
						new Notice(`Failed to attach ${fileOrFolder.name}`);
					}
				}
			},
			this.ctx.plugin
		);
		modal.open();
	}

	/**
	 * Remove a trailing trigger character from the input, used when a picker
	 * (file mention or skill picker) replaces the trigger with content.
	 */
	removeTrailingTriggerChar(char: string): void {
		const input = this.ctx.getUserInput();
		if (!input) return;

		const selection = getContextSelection(input);
		if (!selection || selection.rangeCount === 0) return;

		const range = selection.getRangeAt(0);

		// Only proceed with a collapsed cursor (no text selected)
		if (!range.collapsed) return;

		const node = range.startContainer;

		// Only mutate text nodes within the input element
		if (!input.contains(node)) return;

		if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
			const text = node.textContent || '';
			const offset = range.startOffset;
			if (text[offset - 1] === char) {
				node.textContent = text.slice(0, offset - 1) + text.slice(offset);
				// Restore cursor position
				const newRange = createContextRange(input);
				newRange.setStart(node, offset - 1);
				newRange.collapse(true);
				selection.removeAllRanges();
				selection.addRange(newRange);
			}
		}
	}

	/**
	 * Handle dropped text files by adding to shelf
	 */
	handleDroppedFiles(files: TFile[]): void {
		for (const file of files) {
			this.ctx.getShelf().addTextFile(file);
			this.ctx.context.addFileToContext(file, this.ctx.getCurrentSession());
		}
		this.ctx.updateSessionHeader();
		this.ctx.updateSessionMetadata();
	}

	/**
	 * Add an attachment to the shelf
	 */
	addAttachment(attachment: InlineAttachment): void {
		this.ctx.getShelf().addBinaryAttachment(attachment);
	}

	/**
	 * Remove an attachment from the shelf
	 */
	removeAttachment(id: string): void {
		this.ctx.getShelf().removeItem(id);
	}
}
