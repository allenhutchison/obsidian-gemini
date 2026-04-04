import { App, Menu, TFile, TFolder, Notice, setIcon, setTooltip } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { insertTextAtCursor, moveCursorToEnd, execContextCommand } from '../../utils/dom-context';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import {
	InlineAttachment,
	generateAttachmentId,
	fileToBase64,
	getMimeType,
	isSupportedImageType,
} from './inline-attachment';
import {
	classifyFile,
	FileCategory,
	arrayBufferToBase64,
	detectWebmMimeType,
	GEMINI_INLINE_DATA_LIMIT,
} from '../../utils/file-classification';

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

	updateSessionHeader: () => void;
	updateSessionMetadata: () => Promise<void>;
	loadSession: (session: ChatSession) => Promise<void>;
	isCurrentSession: (session: ChatSession) => boolean;
	addAttachment: (attachment: InlineAttachment) => void;
	removeAttachment: (id: string) => void;
	getAttachments: () => InlineAttachment[];
	handleDroppedFiles: (files: TFile[]) => void;
	switchProject: () => void;
}

/**
 * Return type for UI elements
 */
export interface AgentUIElements {
	sessionHeader: HTMLElement;
	chatContainer: HTMLElement;
	userInput: HTMLDivElement;
	sendButton: HTMLButtonElement;
	imagePreviewContainer: HTMLElement;
	progressContainer: HTMLElement;
	tokenUsageContainer: HTMLElement;
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
		_currentSession: ChatSession | null,
		callbacks: UICallbacks
	): AgentUIElements {
		// Add the main container class
		container.addClass('gemini-agent-container');

		// Compact header bar with title and primary controls
		const sessionHeader = container.createDiv({ cls: 'gemini-agent-header gemini-agent-header-compact' });

		// Chat container (will expand to fill available space)
		const chatContainer = container.createDiv({ cls: 'gemini-agent-chat' });

		// Progress bar container (fixed position above input)
		// Note: Child elements are created by AgentViewProgress.createProgressBar()
		const progressContainer = container.createDiv({ cls: 'gemini-agent-progress-container' });

		// Input area
		const inputArea = container.createDiv({ cls: 'gemini-agent-input-area' });

		// Token usage indicator (hidden by default, shown when setting enabled)
		const tokenUsageContainer = inputArea.createDiv({ cls: 'gemini-agent-token-usage' });
		tokenUsageContainer.style.display = 'none';

		const { userInput, sendButton, imagePreviewContainer } = this.createInputArea(inputArea, callbacks);

		return {
			sessionHeader,
			chatContainer,
			userInput,
			sendButton,
			imagePreviewContainer,
			progressContainer,
			tokenUsageContainer,
		};
	}

	/**
	 * Creates the compact header with session controls
	 */
	createCompactHeader(sessionHeader: HTMLElement, currentSession: ChatSession | null, callbacks: UICallbacks): void {
		sessionHeader.empty();

		// Left section: Title and badges
		const leftSection = sessionHeader.createDiv({ cls: 'gemini-agent-header-left' });

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

		// Project badge (only shown when a project is linked)
		if (currentSession?.projectPath && this.plugin.projectManager) {
			const badge = leftSection.createEl('span', {
				cls: 'gemini-agent-project-badge',
			});
			const iconSpan = badge.createSpan();
			setIcon(iconSpan, 'folder-open');
			const nameSpan = badge.createSpan({ text: ' Loading...' });
			setTooltip(badge, 'Loading project...');

			const capturedPath = currentSession.projectPath;
			this.plugin.projectManager.getProject(capturedPath).then((project) => {
				if (!badge.isConnected) return;
				const projectName = project?.config.name || capturedPath;
				nameSpan.textContent = ' ' + projectName;
				setTooltip(badge, `Project: ${projectName}\n${capturedPath}`);
			});

			badge.addEventListener('click', (e) => {
				e.stopPropagation();
				callbacks.switchProject();
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

		// Right section: Hamburger menu
		const rightSection = sessionHeader.createDiv({ cls: 'gemini-agent-header-right' });

		const menuBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			attr: { 'aria-label': 'Session menu' },
		});
		setIcon(menuBtn, 'menu');

		menuBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const menu = new Menu();

			menu.addItem((item) => {
				item
					.setTitle('New Session')
					.setIcon('plus')
					.onClick(() => callbacks.createNewSession());
			});
			menu.addItem((item) => {
				item
					.setTitle('Browse Sessions')
					.setIcon('list')
					.onClick(() => callbacks.showSessionList());
			});
			menu.addSeparator();
			if (this.plugin.projectManager) {
				menu.addItem((item) => {
					item
						.setTitle(currentSession?.projectPath ? 'Switch Project' : 'Link Project')
						.setIcon('folder-open')
						.onClick(() => callbacks.switchProject());
				});
			}
			menu.addItem((item) => {
				item
					.setTitle('Session Settings')
					.setIcon('settings')
					.onClick(() => callbacks.showSessionSettings());
			});

			menu.showAtMouseEvent(e);
		});
	}

	/**
	 * Creates the session header (delegates to compact header)
	 */
	createSessionHeader(sessionHeader: HTMLElement, currentSession: ChatSession | null, callbacks: UICallbacks): void {
		this.createCompactHeader(sessionHeader, currentSession, callbacks);
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
				// Trigger file mention — don't preventDefault so @ is typed.
				// Defer to next microtask so the browser commits the @ character first.
				// If user selects a file, the @ will be removed before inserting the chip.
				// If user dismisses the picker, the @ stays as a literal character.
				setTimeout(() => callbacks.showFileMention(), 0);
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

		userInput.addEventListener('dragleave', (_e) => {
			userInput.removeClass('gemini-agent-input-dragover');
		});

		userInput.addEventListener('drop', async (e) => {
			userInput.removeClass('gemini-agent-input-dragover');

			// --- Handle Vault File Drops ---
			const droppedFiles: (TFile | TFolder)[] = [];

			// Debug: log all dataTransfer types and data
			if (e.dataTransfer) {
				this.plugin.logger.debug('[AgentViewUI] Drop event dataTransfer types:', Array.from(e.dataTransfer.types));
				for (const type of Array.from(e.dataTransfer.types)) {
					if (type !== 'Files') {
						this.plugin.logger.debug(`[AgentViewUI] dataTransfer[${type}]:`, e.dataTransfer.getData(type));
					}
				}
				if (e.dataTransfer.files?.length) {
					this.plugin.logger.debug(
						'[AgentViewUI] dataTransfer files:',
						Array.from(e.dataTransfer.files).map((f) => ({
							name: f.name,
							type: f.type,
							size: f.size,
							path: (f as any).path,
						}))
					);
				}
			}

			// Helper to resolve path to file/folder
			const resolvePath = (path: string): TFile | TFolder | null => {
				const abstractFile = this.app.vault.getAbstractFileByPath(path);
				if (abstractFile instanceof TFile || abstractFile instanceof TFolder) {
					return abstractFile;
				}
				// Try to resolve as a link (closest match)
				const resolved = this.app.metadataCache.getFirstLinkpathDest(path, '');
				return resolved;
			};

			// 1. Check for File objects (Electron drag from file system)
			if (e.dataTransfer?.files?.length) {
				const adapter = this.app.vault.adapter;
				if (adapter && 'basePath' in adapter) {
					const basePath = (adapter as any).basePath;
					// Normalize slashes for cross-platform consistency (Windows backslashes vs POSIX)
					// Using explicit replace instead of normalizePath which is intended for vault-relative paths
					const normalizedBase = basePath.replace(/\\/g, '/');

					for (const file of Array.from(e.dataTransfer.files)) {
						// (file as any).path is an Electron extension that provides the full filesystem path
						const rawPath = (file as any).path;

						if (rawPath && typeof rawPath === 'string') {
							const normalizedRaw = rawPath.replace(/\\/g, '/');

							if (normalizedRaw.startsWith(normalizedBase)) {
								let relPath = normalizedRaw.substring(normalizedBase.length);
								if (relPath.startsWith('/')) relPath = relPath.substring(1);

								const validFile = resolvePath(relPath);
								if (validFile) {
									droppedFiles.push(validFile);
								} else {
									this.plugin.logger.debug(`[AgentViewUI] Failed to resolve dropped file path: ${relPath}`);
								}
							}
						}
					}
				}
			}

			// 2. Check for Text links (Obsidian internal drag)
			// Skip internal link parsing if we already found filesystem files to prevent double-counting
			// (Obsidian sometimes puts both File objects and text links in the same drop)
			if (droppedFiles.length === 0 && e.dataTransfer) {
				const text = e.dataTransfer.getData('text/plain');
				if (text) {
					const lines = text.split('\n');
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed) continue;

						// Check Obsidian URI: obsidian://open?vault=...&file=...
						if (trimmed.startsWith('obsidian://')) {
							try {
								const url = new URL(trimmed);
								const filePath = url.searchParams.get('file');
								if (filePath) {
									const decoded = decodeURIComponent(filePath);
									const resolved = resolvePath(decoded);
									if (resolved) {
										droppedFiles.push(resolved);
									} else {
										this.plugin.logger.debug(`[AgentViewUI] Failed to resolve obsidian URI file param: ${decoded}`);
									}
								}
							} catch (err) {
								this.plugin.logger.debug(`[AgentViewUI] Failed to parse obsidian URI: ${trimmed}`);
							}
							continue;
						}

						// Check Wikilink: [[Path|Name]] or [[Path]]
						const wikiMatch = trimmed.match(/^\[\[(.*?)(\|.*)?\]\]$/);
						if (wikiMatch) {
							const resolved = resolvePath(wikiMatch[1]);
							// Note: getFirstLinkpathDest only resolves TFile, so folders linked this way won't be resolved
							if (resolved) {
								droppedFiles.push(resolved);
							} else {
								this.plugin.logger.debug(`[AgentViewUI] Failed to resolve wikilink: ${wikiMatch[1]}`);
							}
							continue;
						}

						// Check Markdown Link: [Name](Path)
						const mdMatch = trimmed.match(/^\[(.*?)\]\((.*?)\)$/);
						if (mdMatch) {
							try {
								const path = decodeURIComponent(mdMatch[2]);
								const resolved = resolvePath(path);
								// Note: getFirstLinkpathDest only resolves TFile, so folders linked this way won't be resolved
								if (resolved) {
									droppedFiles.push(resolved);
								} else {
									this.plugin.logger.debug(`[AgentViewUI] Failed to resolve markdown link: ${path}`);
								}
							} catch (err) {
								// Ignore decoding errors
								this.plugin.logger.debug(`[AgentViewUI] Failed to decode markdown link path: ${mdMatch[2]}`);
							}
							continue;
						}

						// Fallback: try resolving as a plain vault path
						const plainResolved = resolvePath(trimmed);
						if (plainResolved) {
							droppedFiles.push(plainResolved);
						} else {
							this.plugin.logger.debug(`[AgentViewUI] Could not resolve dropped text as vault path: ${trimmed}`);
						}
					}
				}
			}

			// If valid vault files were found, classify and route them
			if (droppedFiles.length > 0) {
				e.preventDefault();
				e.stopPropagation();

				// Deduplicate files
				const uniqueFiles = [...new Map(droppedFiles.map((f) => [f.path, f])).values()];

				// Filter out system folders and excluded files
				const filteredFiles = uniqueFiles.filter((f) => !shouldExcludePathForPlugin(f.path, this.plugin));

				if (filteredFiles.length === 0) {
					if (uniqueFiles.length > 0) {
						new Notice('Dropped files were excluded (system or plugin files)', 3000);
					}
					return;
				}

				// Expand folders → collect all child TFiles recursively
				const allTFiles: TFile[] = [];
				for (const file of filteredFiles) {
					if (file instanceof TFolder) {
						const children = this.collectFilesFromFolder(file);
						allTFiles.push(...children.filter((f) => !shouldExcludePathForPlugin(f.path, this.plugin)));
					} else if (file instanceof TFile) {
						allTFiles.push(file);
					}
				}

				// Deduplicate again after folder expansion
				const dedupedFiles = [...new Map(allTFiles.map((f) => [f.path, f])).values()];

				// Classify each file
				const textFiles: TFile[] = [];
				const binaryFiles: TFile[] = [];
				const unsupportedExts: string[] = [];

				for (const file of dedupedFiles) {
					const result = classifyFile(file.extension);
					switch (result.category) {
						case FileCategory.TEXT:
							textFiles.push(file);
							break;
						case FileCategory.GEMINI_BINARY:
							binaryFiles.push(file);
							break;
						case FileCategory.UNSUPPORTED:
							unsupportedExts.push(`.${file.extension}`);
							break;
					}
				}

				// Route text files → context chips
				if (textFiles.length > 0) {
					callbacks.handleDroppedFiles(textFiles);
				}

				// Route binary files → inline attachments
				let binaryCount = 0;
				let cumulativeSize = this.getCurrentAttachmentSize(callbacks);
				const sizeLimitExceeded: string[] = [];

				for (const file of binaryFiles) {
					try {
						const buffer = await this.app.vault.readBinary(file);
						cumulativeSize += buffer.byteLength;

						if (cumulativeSize > GEMINI_INLINE_DATA_LIMIT) {
							sizeLimitExceeded.push(file.name);
							cumulativeSize -= buffer.byteLength;
							continue;
						}

						const base64 = arrayBufferToBase64(buffer);
						const classification = classifyFile(file.extension);
						// For .webm files, detect audio vs video from container header
						const mimeType =
							file.extension.toLowerCase() === 'webm' ? detectWebmMimeType(buffer) : classification.mimeType;
						const attachment: InlineAttachment = {
							base64,
							mimeType,
							id: generateAttachmentId(),
							vaultPath: file.path,
							fileName: file.name,
						};
						callbacks.addAttachment(attachment);
						binaryCount++;
					} catch (err) {
						this.plugin.logger.error(`Failed to read binary file ${file.path}:`, err);
						new Notice(`Failed to attach ${file.name}`);
					}
				}

				// Show notices
				const parts: string[] = [];
				if (textFiles.length > 0) {
					parts.push(`${textFiles.length} text file${textFiles.length === 1 ? '' : 's'} added to context`);
				}
				if (binaryCount > 0) {
					parts.push(`${binaryCount} file${binaryCount === 1 ? '' : 's'} attached`);
				}
				if (parts.length > 0) {
					new Notice(parts.join(', '), 3000);
				}

				if (sizeLimitExceeded.length > 0) {
					new Notice(
						`Skipped ${sizeLimitExceeded.length} file${sizeLimitExceeded.length === 1 ? '' : 's'} (exceeds 20MB cumulative limit): ${sizeLimitExceeded.join(', ')}`,
						5000
					);
				}

				if (unsupportedExts.length > 0) {
					const uniqueExts = [...new Set(unsupportedExts)];
					new Notice(
						`Skipped unsupported file type${uniqueExts.length === 1 ? '' : 's'}: ${uniqueExts.join(', ')}`,
						4000
					);
				}

				return;
			}
			// --- End Vault File Drops ---

			// Non-vault drops: handle images from external sources (browser, desktop)
			const files = e.dataTransfer?.files;
			const fileArray = files?.length ? Array.from(files) : [];
			const hasImages = fileArray.some((file) => isSupportedImageType(file.type));

			// Only prevent default behavior if we have images to handle
			if (!hasImages) {
				const unsupportedImages = fileArray.filter(
					(file) => file.type?.startsWith('image/') && !isSupportedImageType(file.type)
				);
				if (unsupportedImages.length > 0) {
					new Notice('Unsupported image format. Please use PNG, JPEG, GIF, or WebP.');
				}
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			// Process all supported images from non-vault sources
			let imagesProcessed = 0;
			let unsupportedCount = 0;
			let cumulativeSize = this.getCurrentAttachmentSize(callbacks);
			for (const file of fileArray) {
				if (isSupportedImageType(file.type)) {
					if (cumulativeSize + file.size > GEMINI_INLINE_DATA_LIMIT) {
						new Notice('Attachment size limit (20 MB) reached. Some images were skipped.');
						break;
					}
					try {
						const base64 = await fileToBase64(file);
						const attachment: InlineAttachment = {
							base64,
							mimeType: getMimeType(file),
							id: generateAttachmentId(),
						};
						callbacks.addAttachment(attachment);
						cumulativeSize += file.size;
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
				let cumulativeSize = this.getCurrentAttachmentSize(callbacks);
				for (const file of Array.from(e.clipboardData.files)) {
					if (isSupportedImageType(file.type)) {
						if (cumulativeSize + file.size > GEMINI_INLINE_DATA_LIMIT) {
							new Notice('Attachment size limit (20 MB) reached. Some images were skipped.');
							break;
						}
						// Prevent default once when we find the first image
						if (imagesProcessed === 0) {
							e.preventDefault();
						}
						try {
							const base64 = await fileToBase64(file);
							const attachment: InlineAttachment = {
								base64,
								mimeType: getMimeType(file),
								id: generateAttachmentId(),
							};
							callbacks.addAttachment(attachment);
							cumulativeSize += file.size;
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

	/**
	 * Compute the cumulative base64 byte size of all existing attachments.
	 */
	private getCurrentAttachmentSize(callbacks: UICallbacks): number {
		return callbacks.getAttachments().reduce((sum, a) => sum + Math.ceil((a.base64.length * 3) / 4), 0);
	}

	/**
	 * Recursively collect all TFile children from a folder
	 */
	private collectFilesFromFolder(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile) {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectFilesFromFolder(child));
			}
		}
		return files;
	}
}
