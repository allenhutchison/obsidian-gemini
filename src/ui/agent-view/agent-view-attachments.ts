import { TFile, TFolder, TAbstractFile, Notice, App } from 'obsidian';
import { ChatSession } from '../../types/agent';
import { InlineAttachment } from './inline-attachment';
import { AgentViewContext } from './agent-view-context';
import { AgentViewShelf, getTextFilesFromFolder } from './agent-view-shelf';
import { FileMentionModal } from './file-mention-modal';
import { getContextSelection, createContextRange } from '../../utils/dom-context';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import { classifyFile, FileCategory } from '../../utils/file-classification';
import { estimateAttachmentBytes } from './inline-attachment';
import { attachVaultBinaryFile } from './attach-vault-file';
import type { ObsidianGemini } from '../../types/plugin';
import { t } from '../../i18n';

/**
 * Context interface for the attachments module.
 * Provides access to shared state owned by the orchestrator.
 */
export interface AttachmentsContext {
	plugin: ObsidianGemini;
	app: App;
	getCurrentSession: () => ChatSession | null;
	getShelf: () => AgentViewShelf;
	getUserInput: () => HTMLDivElement;
	context: AgentViewContext;
	updateSessionHeader: () => void;
	updateSessionMetadata: () => Promise<void>;
}

/**
 * Handles the @ mention file picker and attachment persistence for the agent
 * view. Drag-and-drop and paste live in `AgentViewUI` (agent-view-ui.ts); both
 * paths share the vault-binary pipeline in `attach-vault-file.ts` (#1363).
 */
export class AgentViewAttachments {
	constructor(private ctx: AttachmentsContext) {}

	/**
	 * Show file mention modal for @ mentions
	 */
	async showFileMention(): Promise<void> {
		const modal = new FileMentionModal(
			this.ctx.app,
			(fileOrFolder: TAbstractFile) => {
				// FileMentionModal expects a void-returning callback; run the async
				// attachment handling as a fire-and-forget task.
				void (async () => {
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
						await this.ctx.updateSessionMetadata();
						return;
					}

					if (!(fileOrFolder instanceof TFile)) return;

					// Classify the file to determine text vs binary handling
					const classification = classifyFile(fileOrFolder.extension);

					if (classification.category === FileCategory.TEXT) {
						this.ctx.getShelf().addTextFile(fileOrFolder);
						this.ctx.context.addFileToContext(fileOrFolder, this.ctx.getCurrentSession());
						this.ctx.updateSessionHeader();
						await this.ctx.updateSessionMetadata();
					} else if (
						classification.category === FileCategory.GEMINI_BINARY ||
						classification.category === FileCategory.SVG
					) {
						// Handle binary/SVG file — create inline attachment (same as drag-drop),
						// via the shared vault-binary pipeline (#1363).
						try {
							const alreadyUsed = estimateAttachmentBytes(this.ctx.getShelf().getPendingAttachments());
							const result = await attachVaultBinaryFile(
								this.ctx.app,
								fileOrFolder,
								alreadyUsed,
								this.ctx.plugin.logger
							);
							switch (result.kind) {
								case 'too-large':
									new Notice(t('agent.attachments.fileTooLarge', { name: fileOrFolder.name }), 5000);
									return;
								case 'raster-failed':
									new Notice(t('agent.attachments.attachFailed', { name: fileOrFolder.name }));
									return;
								case 'read-failed':
									this.ctx.plugin.logger.error(`Failed to attach ${fileOrFolder.path}:`, result.error);
									new Notice(t('agent.attachments.attachFailed', { name: fileOrFolder.name }));
									return;
								case 'ok':
									this.addAttachment(result.attachment);
									new Notice(t('agent.attachments.attached', { name: fileOrFolder.name }), 2000);
									return;
							}
						} catch (err) {
							this.ctx.plugin.logger.error(`Failed to attach ${fileOrFolder.path}:`, err);
							new Notice(t('agent.attachments.attachFailed', { name: fileOrFolder.name }));
						}
					}
				})();
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
		// Fire-and-forget: persist session metadata in the background from this sync handler.
		void this.ctx.updateSessionMetadata();
	}

	/**
	 * Add an attachment to the shelf
	 */
	addAttachment(attachment: InlineAttachment): void {
		this.ctx.getShelf().addBinaryAttachment(attachment);
	}
}
