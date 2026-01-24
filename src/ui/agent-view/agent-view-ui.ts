import { App, TFile, Notice, setIcon } from 'obsidian';
import type ObsidianGemini from '../../main';
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
import { FileMentionModal } from './file-mention-modal';
import { SessionSettingsModal } from './session-settings-modal';
import { ChatSession } from '../../types/agent';
import { insertTextAtCursor, moveCursorToEnd, execContextCommand } from '../../utils/dom-context';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import {
	ImageAttachment,
	generateAttachmentId,
	fileToBase64,
	getMimeType,
	isSupportedImageType,
} from './image-attachment';

/**
 * Callbacks interface for UI interactions
 */
export interface UICallbacks {
	showFilePicker: () => Promise<void>;
	showFileMention: () => Promise<void>;
	showSessionList: () => Promise<void>;
	showSessionSettings: () => Promise<void>;
	createNewSession: () => Promise<void>;
	sendMessage: () => Promise<void>;
	stopAgentLoop: () => void;
	removeContextFile: (file: TFile) => void;
	updateContextFilesList: (container: HTMLElement) => void;
	updateSessionHeader: () => void;
	updateSessionMetadata: () => Promise<void>;
	loadSession: (session: ChatSession) => Promise<void>;
	isCurrentSession: (session: ChatSession) => boolean;
	addImageAttachment: (attachment: ImageAttachment) => void;
	removeImageAttachment: (id: string) => void;
	getImageAttachments: () => ImageAttachment[];
}

/**
 * Return type for UI elements
 */
export interface AgentUIElements {
	sessionHeader: HTMLElement;
	contextPanel: HTMLElement;
	chatContainer: HTMLElement;
	userInput: HTMLDivElement;
	sendButton: HTMLButtonElement;
	imagePreviewContainer: HTMLElement;
	progressContainer: HTMLElement;
	progressBar: HTMLElement;
	progressFill: HTMLElement;
	progressStatus: HTMLElement;
	progressTimer: HTMLElement;
}

/**
 * AgentViewUI handles creation and management of UI elements for the Agent View
 */
export class AgentViewUI {
	constructor(
		private app: App,
		private plugin: ObsidianGemini
	) {}

	/**
	 * Creates the main agent interface
	 */
	createAgentInterface(
		container: HTMLElement,
		currentSession: ChatSession | null,
		callbacks: UICallbacks
	): AgentUIElements {
		// Add the main container class
		container.addClass('gemini-agent-container');

		// Compact header bar with title and primary controls
		const sessionHeader = container.createDiv({ cls: 'gemini-agent-header gemini-agent-header-compact' });

		// Collapsible context panel
		const contextPanel = container.createDiv({
			cls: 'gemini-agent-context-panel gemini-agent-context-panel-collapsed',
		});

		// Chat container (will expand to fill available space)
		const chatContainer = container.createDiv({ cls: 'gemini-agent-chat' });

		// Progress bar container (fixed position above input)
		const progressContainer = container.createDiv({ cls: 'gemini-agent-progress-container' });
		const progressElements = this.createProgressBar(progressContainer);

		// Input area
		const inputArea = container.createDiv({ cls: 'gemini-agent-input-area' });
		const { userInput, sendButton, imagePreviewContainer } = this.createInputArea(inputArea, callbacks);

		return {
			sessionHeader,
			contextPanel,
			chatContainer,
			userInput,
			sendButton,
			imagePreviewContainer,
			progressContainer,
			...progressElements,
		};
	}

	/**
	 * Creates the compact header with session controls
	 */
	createCompactHeader(
		sessionHeader: HTMLElement,
		contextPanel: HTMLElement,
		currentSession: ChatSession | null,
		callbacks: UICallbacks
	): void {
		sessionHeader.empty();

		// Left section: Title and context toggle
		const leftSection = sessionHeader.createDiv({ cls: 'gemini-agent-header-left' });

		// Toggle button for context panel
		const toggleBtn = leftSection.createEl('button', {
			cls: 'gemini-agent-toggle-btn',
			title: 'Toggle context panel',
		});
		setIcon(toggleBtn, 'chevron-down');

		toggleBtn.addEventListener('click', () => {
			const isCollapsed = contextPanel.hasClass('gemini-agent-context-panel-collapsed');
			if (isCollapsed) {
				contextPanel.removeClass('gemini-agent-context-panel-collapsed');
				setIcon(toggleBtn, 'chevron-up');
			} else {
				contextPanel.addClass('gemini-agent-context-panel-collapsed');
				setIcon(toggleBtn, 'chevron-down');
			}
		});

		// Title container to maintain consistent layout
		const titleContainer = leftSection.createDiv({ cls: 'gemini-agent-title-container' });

		// Session title (inline, not as large)
		const title = titleContainer.createEl('span', {
			text: currentSession?.title || 'New Agent Session',
			cls: 'gemini-agent-title-compact',
		});

		// Make title editable on double-click
		title.addEventListener('dblclick', () => {
			if (!currentSession) return;

			const input = titleContainer.createEl('input', {
				type: 'text',
				value: currentSession.title,
				cls: 'gemini-agent-title-input-compact',
			});

			title.style.display = 'none';
			input.focus();
			input.select();

			const saveTitle = async () => {
				const newTitle = input.value.trim();
				if (newTitle && newTitle !== currentSession!.title) {
					// Update session title
					const oldPath = currentSession!.historyPath;
					const sanitizedTitle = (this.plugin.sessionManager as any).sanitizeFileName(newTitle);
					const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + sanitizedTitle + '.md';

					// Rename file if it exists
					const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile) {
						await this.plugin.app.fileManager.renameFile(oldFile, newPath);
						currentSession!.historyPath = newPath;
					}

					currentSession!.title = newTitle;
					await callbacks.updateSessionMetadata();
				}

				title.textContent = currentSession!.title;
				title.style.display = '';
				input.remove();
			};

			input.addEventListener('blur', saveTitle);
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					saveTitle();
				} else if (e.key === 'Escape') {
					title.style.display = '';
					input.remove();
				}
			});
		});

		// Context info badge - always in the same position
		if (currentSession) {
			const totalContextFiles = currentSession.context.contextFiles.length;

			const contextBadge = leftSection.createEl('span', {
				cls: 'gemini-agent-context-badge',
				text: `${totalContextFiles} ${totalContextFiles === 1 ? 'file' : 'files'}`,
			});
		}

		// Model config badge (if non-default settings)
		if (currentSession?.modelConfig) {
			const hasCustomSettings =
				currentSession.modelConfig.model ||
				currentSession.modelConfig.temperature !== undefined ||
				currentSession.modelConfig.topP !== undefined ||
				currentSession.modelConfig.promptTemplate;

			if (hasCustomSettings) {
				// Build detailed tooltip
				const tooltipParts: string[] = [];

				if (currentSession.modelConfig.model) {
					tooltipParts.push(`Model: ${currentSession.modelConfig.model}`);
				}
				if (currentSession.modelConfig.temperature !== undefined) {
					tooltipParts.push(`Temperature: ${currentSession.modelConfig.temperature}`);
				}
				if (currentSession.modelConfig.topP !== undefined) {
					tooltipParts.push(`Top-P: ${currentSession.modelConfig.topP}`);
				}
				if (currentSession.modelConfig.promptTemplate) {
					const promptName = currentSession.modelConfig.promptTemplate.split('/').pop()?.replace('.md', '') || 'custom';
					tooltipParts.push(`Prompt: ${promptName}`);
				}

				// Show just the prompt template name if present, otherwise show icon
				if (currentSession.modelConfig.promptTemplate) {
					const promptName = currentSession.modelConfig.promptTemplate.split('/').pop()?.replace('.md', '') || 'Custom';
					leftSection.createEl('span', {
						cls: 'gemini-agent-prompt-badge',
						text: promptName,
						attr: {
							title: tooltipParts.join('\n'),
						},
					});
				} else {
					// Show settings icon for other custom settings
					const settingsIndicator = leftSection.createEl('span', {
						cls: 'gemini-agent-settings-indicator',
						attr: {
							title: tooltipParts.join('\n'),
						},
					});
					setIcon(settingsIndicator, 'sliders-horizontal');
				}
			}
		}

		// Right section: Action buttons
		const rightSection = sessionHeader.createDiv({ cls: 'gemini-agent-header-right' });

		// Settings button
		const settingsBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'Session Settings',
		});
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => callbacks.showSessionSettings());

		const newSessionBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'New Session',
		});
		setIcon(newSessionBtn, 'plus');
		newSessionBtn.addEventListener('click', () => callbacks.createNewSession());

		const listSessionsBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'Browse Sessions',
		});
		setIcon(listSessionsBtn, 'list');
		listSessionsBtn.addEventListener('click', () => callbacks.showSessionList());
	}

	/**
	 * Creates the session header (delegates to compact header)
	 */
	createSessionHeader(
		sessionHeader: HTMLElement,
		contextPanel: HTMLElement,
		currentSession: ChatSession | null,
		callbacks: UICallbacks
	): void {
		// Just call the compact header method
		this.createCompactHeader(sessionHeader, contextPanel, currentSession, callbacks);
	}

	/**
	 * Creates the collapsible context panel
	 */
	createContextPanel(contextPanel: HTMLElement, currentSession: ChatSession | null, callbacks: UICallbacks): void {
		contextPanel.empty();

		// Compact context controls
		const controlsRow = contextPanel.createDiv({ cls: 'gemini-agent-context-controls' });

		// Add files button
		const addButton = controlsRow.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-sm',
			title: 'Add context files',
		});
		setIcon(addButton, 'plus');
		addButton.createSpan({ text: ' Add Files' });
		addButton.addEventListener('click', () => callbacks.showFilePicker());

		// Context files list (compact)
		const filesList = contextPanel.createDiv({ cls: 'gemini-agent-files-list gemini-agent-files-list-compact' });
		callbacks.updateContextFilesList(filesList);
	}

	/**
	 * Creates the input area with paste/keyboard handlers
	 */
	createInputArea(
		container: HTMLElement,
		callbacks: UICallbacks
	): { userInput: HTMLDivElement; sendButton: HTMLButtonElement; imagePreviewContainer: HTMLElement } {
		// Image preview container (shows thumbnails of attached images)
		const imagePreviewContainer = container.createDiv({ cls: 'gemini-agent-image-preview' });

		// Row container for input + send button
		const inputRow = container.createDiv({ cls: 'gemini-agent-input-row' });

		// Create contenteditable div for rich input
		const userInput = inputRow.createDiv({
			cls: 'gemini-agent-input gemini-agent-input-rich',
			attr: {
				contenteditable: 'true',
				'data-placeholder': 'Message the agent... (@ to mention files)',
			},
		}) as HTMLDivElement;

		const sendButton = inputRow.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-primary gemini-agent-send-btn',
			attr: { 'aria-label': 'Send message to agent' },
		});
		setIcon(sendButton, 'play');

		// Event listeners
		userInput.addEventListener('keydown', (e) => {
			// Prevent submission if IME composition is active (for Chinese/Japanese/etc)
			if (e.isComposing) {
				return;
			}

			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				callbacks.sendMessage();
			} else if (e.key === '@') {
				// Trigger file mention
				e.preventDefault();
				callbacks.showFileMention();
			}
		});

		// Handle drag and drop for images
		userInput.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.stopPropagation();
			userInput.addClass('gemini-agent-input-dragover');
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
		});

		userInput.addEventListener('dragleave', (e) => {
			userInput.removeClass('gemini-agent-input-dragover');
		});

		userInput.addEventListener('drop', async (e) => {
			userInput.removeClass('gemini-agent-input-dragover');

			// First check if there are any supported images in the drop
			const files = e.dataTransfer?.files;
			const fileArray = files?.length ? Array.from(files) : [];
			const hasImages = fileArray.some((file) => isSupportedImageType(file.type));

			// Only prevent default behavior if we have images to handle
			// This allows text/URL drops to work normally
			if (!hasImages) {
				// Check if there were unsupported image formats
				const unsupportedImages = fileArray.filter(
					(file) => file.type.startsWith('image/') && !isSupportedImageType(file.type)
				);
				if (unsupportedImages.length > 0) {
					new Notice('Unsupported image format. Please use PNG, JPEG, GIF, or WebP.');
				}
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			// Process all supported images
			let imagesProcessed = 0;
			let unsupportedCount = 0;
			for (const file of fileArray) {
				if (isSupportedImageType(file.type)) {
					try {
						const base64 = await fileToBase64(file);
						const attachment: ImageAttachment = {
							base64,
							mimeType: getMimeType(file),
							id: generateAttachmentId(),
						};
						callbacks.addImageAttachment(attachment);
						imagesProcessed++;
					} catch (err) {
						this.plugin.logger.error('Failed to process dropped image:', err);
						new Notice('Failed to attach image');
					}
				} else if (file.type.startsWith('image/')) {
					unsupportedCount++;
				}
			}

			if (imagesProcessed > 0) {
				new Notice(imagesProcessed === 1 ? 'Image attached' : `${imagesProcessed} images attached`);
			}
			if (unsupportedCount > 0) {
				new Notice(`${unsupportedCount} image(s) skipped: unsupported format. Use PNG, JPEG, GIF, or WebP.`);
			}
		});

		// Handle paste - check for images first, then text
		userInput.addEventListener('paste', async (e) => {
			// Check for image files in clipboard
			let imagesProcessed = 0;
			let unsupportedCount = 0;
			if (e.clipboardData?.files?.length) {
				for (const file of Array.from(e.clipboardData.files)) {
					if (isSupportedImageType(file.type)) {
						// Prevent default once when we find the first image
						if (imagesProcessed === 0) {
							e.preventDefault();
						}
						try {
							const base64 = await fileToBase64(file);
							const attachment: ImageAttachment = {
								base64,
								mimeType: getMimeType(file),
								id: generateAttachmentId(),
							};
							callbacks.addImageAttachment(attachment);
							imagesProcessed++;
						} catch (err) {
							this.plugin.logger.error('Failed to process pasted image:', err);
							new Notice('Failed to attach image');
						}
					} else if (file.type.startsWith('image/')) {
						unsupportedCount++;
					}
				}
			}

			// Notify about unsupported formats
			if (unsupportedCount > 0 && imagesProcessed === 0) {
				new Notice('Unsupported image format. Please use PNG, JPEG, GIF, or WebP.');
			} else if (unsupportedCount > 0) {
				new Notice(`${unsupportedCount} image(s) skipped: unsupported format.`);
			}

			// If images were processed, show notice and skip text handling
			if (imagesProcessed > 0) {
				new Notice(imagesProcessed === 1 ? 'Image attached' : `${imagesProcessed} images attached`);
				return;
			}

			// No images found, handle as text paste
			e.preventDefault();

			let text = '';

			// Method 1: Try standard clipboardData (works in main window)
			if (e.clipboardData && e.clipboardData.getData) {
				try {
					text = e.clipboardData.getData('text/plain') || '';
				} catch (err) {
					// Clipboard access might fail in popout
					this.plugin.logger.debug('Standard clipboard access failed:', err);
				}
			}

			// Method 2: If no text yet, try the async Clipboard API
			// This might work better in popout windows
			if (!text && navigator.clipboard && navigator.clipboard.readText) {
				try {
					text = await navigator.clipboard.readText();
				} catch (err) {
					this.plugin.logger.debug('Async clipboard access failed:', err);

					// Method 3: As last resort, get the selection and use execCommand
					// This is a fallback that might help in some browsers
					try {
						// Focus the input first
						userInput.focus();

						// Try using execCommand as absolute fallback
						// This will paste with formatting, but we'll clean it up after
						execContextCommand(userInput, 'paste');

						// Give it a moment to paste, then clean up formatting
						setTimeout(() => {
							// Get just the text content, removing all HTML
							const plainText = userInput.innerText || userInput.textContent || '';

							// Clear and set plain text
							userInput.textContent = plainText;

							// Move cursor to end
							moveCursorToEnd(userInput);
						}, 10);

						return; // Exit early since we handled it with the timeout
					} catch (execErr) {
						this.plugin.logger.warn('All paste methods failed:', execErr);
						// If all else fails, we can't paste
						new Notice('Unable to paste in popout window. Try pasting in the main window.');
						return;
					}
				}
			}

			// If we got text, insert it
			if (text) {
				insertTextAtCursor(userInput, text);
			}
		});

		sendButton.addEventListener('click', () => {
			if (sendButton.hasClass('gemini-agent-stop-btn')) {
				callbacks.stopAgentLoop();
			} else {
				callbacks.sendMessage();
			}
		});

		return { userInput, sendButton, imagePreviewContainer };
	}

	/**
	 * Creates the progress bar
	 */
	private createProgressBar(container: HTMLElement): {
		progressBar: HTMLElement;
		progressFill: HTMLElement;
		progressStatus: HTMLElement;
		progressTimer: HTMLElement;
	} {
		container.style.display = 'none'; // Hidden by default

		// Progress bar wrapper
		const barWrapper = container.createDiv({
			cls: 'gemini-agent-progress-bar-wrapper',
		});

		const progressBar = barWrapper.createDiv({
			cls: 'gemini-agent-progress-bar',
		});

		const progressFill = progressBar.createDiv({
			cls: 'gemini-agent-progress-fill',
		});

		// Status text container
		const statusContainer = container.createDiv({
			cls: 'gemini-agent-progress-status-container',
		});

		const progressStatus = statusContainer.createSpan({
			cls: 'gemini-agent-progress-status-text',
		});

		const progressTimer = statusContainer.createSpan({
			cls: 'gemini-agent-progress-timer',
			attr: {
				'aria-live': 'polite',
				'aria-label': 'Elapsed time',
			},
		});

		return { progressBar, progressFill, progressStatus, progressTimer };
	}

	/**
	 * Updates the context files list display
	 */
	updateContextFilesList(container: HTMLElement, currentSession: ChatSession | null, callbacks: UICallbacks): void {
		container.empty();

		const hasContextFiles = currentSession && currentSession.context.contextFiles.length > 0;

		if (!hasContextFiles) {
			container.createEl('p', {
				text: 'No context files',
				cls: 'gemini-agent-empty-state',
			});
			return;
		}

		// Get the currently active file to mark it with a badge
		const activeFile = this.app.workspace.getActiveFile();

		// Show all context files with remove buttons
		if (currentSession) {
			currentSession.context.contextFiles.forEach((file) => {
				const isActiveFile = file === activeFile;

				const fileItem = container.createDiv({ cls: 'gemini-agent-file-item' });

				// Add file icon
				const fileIcon = fileItem.createEl('span', { cls: 'gemini-agent-file-icon' });
				setIcon(fileIcon, 'file-text');

				const fileName = fileItem.createEl('span', {
					text: file.basename,
					cls: 'gemini-agent-file-name',
					title: file.path, // Show full path on hover
				});

				// Add "Active" badge if this is the currently open file
				if (isActiveFile) {
					const badge = fileItem.createEl('span', {
						text: 'Active',
						cls: 'gemini-agent-active-badge',
						title: 'This is the currently open file',
					});
				}

				const removeBtn = fileItem.createEl('button', {
					text: '×',
					cls: 'gemini-agent-remove-btn',
					title: 'Remove file',
				});

				removeBtn.addEventListener('click', () => {
					callbacks.removeContextFile(file);
				});
			});
		}
	}

	/**
	 * Updates the image preview container with thumbnails
	 */
	updateImagePreview(container: HTMLElement, attachments: ImageAttachment[], onRemove: (id: string) => void): void {
		container.empty();

		if (attachments.length === 0) {
			container.style.display = 'none';
			return;
		}

		container.style.display = 'flex';

		for (const attachment of attachments) {
			const thumbWrapper = container.createDiv({ cls: 'gemini-agent-image-thumb' });

			// Create image element
			const img = thumbWrapper.createEl('img', {
				attr: {
					src: `data:${attachment.mimeType};base64,${attachment.base64}`,
					alt: 'Attached image',
				},
			});

			// Create remove button
			const removeBtn = thumbWrapper.createEl('button', {
				text: '×',
				cls: 'gemini-agent-image-remove',
				attr: { title: 'Remove image', 'aria-label': 'Remove image' },
			});

			removeBtn.addEventListener('click', () => {
				onRemove(attachment.id);
			});
		}
	}
}
