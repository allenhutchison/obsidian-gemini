import { App, TFile, Notice, setIcon } from 'obsidian';
import type ObsidianGemini from '../../main';
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
import { FileMentionModal } from './file-mention-modal';
import { SessionSettingsModal } from './session-settings-modal';
import { ChatSession } from '../../types/agent';
import {
	insertTextAtCursor,
	moveCursorToEnd,
	execContextCommand
} from '../../utils/dom-context';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';

// Documentation and help content
const DOCS_BASE_URL = 'https://github.com/allenhutchison/obsidian-gemini/blob/master/docs';
const AGENT_MODE_GUIDE_URL = `${DOCS_BASE_URL}/agent-mode-guide.md`;

const AGENT_CAPABILITIES = [
	{ icon: 'search', text: 'Search and read files in your vault' },
	{ icon: 'file-edit', text: 'Create, modify, and organize notes' },
	{ icon: 'globe', text: 'Search the web and fetch information' },
	{ icon: 'workflow', text: 'Execute multi-step tasks autonomously' }
] as const;

const EXAMPLE_PROMPTS = [
	{ icon: 'search', text: 'Find all notes tagged with #important' },
	{ icon: 'file-plus', text: 'Create a weekly summary of my meeting notes' },
	{ icon: 'globe', text: 'Research productivity methods and create notes' },
	{ icon: 'folder-tree', text: 'Organize my research notes by topic' }
] as const;

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
		const contextPanel = container.createDiv({ cls: 'gemini-agent-context-panel gemini-agent-context-panel-collapsed' });

		// Chat container (will expand to fill available space)
		const chatContainer = container.createDiv({ cls: 'gemini-agent-chat' });

		// Progress bar container (fixed position above input)
		const progressContainer = container.createDiv({ cls: 'gemini-agent-progress-container' });
		const progressElements = this.createProgressBar(progressContainer);

		// Input area
		const inputArea = container.createDiv({ cls: 'gemini-agent-input-area' });
		const { userInput, sendButton } = this.createInputArea(inputArea, callbacks);

		return {
			sessionHeader,
			contextPanel,
			chatContainer,
			userInput,
			sendButton,
			progressContainer,
			...progressElements
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
			title: 'Toggle context panel'
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
			cls: 'gemini-agent-title-compact'
		});

		// Make title editable on double-click
		title.addEventListener('dblclick', () => {
			if (!currentSession) return;

			const input = titleContainer.createEl('input', {
				type: 'text',
				value: currentSession.title,
				cls: 'gemini-agent-title-input-compact'
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
				text: `${totalContextFiles} ${totalContextFiles === 1 ? 'file' : 'files'}`
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
							title: tooltipParts.join('\n')
						}
					});
				} else {
					// Show settings icon for other custom settings
					const settingsIndicator = leftSection.createEl('span', {
						cls: 'gemini-agent-settings-indicator',
						attr: {
							title: tooltipParts.join('\n')
						}
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
			title: 'Session Settings'
		});
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => callbacks.showSessionSettings());

		const newSessionBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'New Session'
		});
		setIcon(newSessionBtn, 'plus');
		newSessionBtn.addEventListener('click', () => callbacks.createNewSession());

		const listSessionsBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'Browse Sessions'
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
	createContextPanel(
		contextPanel: HTMLElement,
		currentSession: ChatSession | null,
		callbacks: UICallbacks
	): void {
		contextPanel.empty();

		// Compact context controls
		const controlsRow = contextPanel.createDiv({ cls: 'gemini-agent-context-controls' });

		// Add files button
		const addButton = controlsRow.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-sm',
			title: 'Add context files'
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
	): { userInput: HTMLDivElement; sendButton: HTMLButtonElement } {
		// Create contenteditable div for rich input
		const userInput = container.createDiv({
			cls: 'gemini-agent-input gemini-agent-input-rich',
			attr: {
				contenteditable: 'true',
				'data-placeholder': 'Message the agent... (@ to mention files)'
			}
		}) as HTMLDivElement;

		const sendButton = container.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-primary gemini-agent-send-btn',
			attr: { 'aria-label': 'Send message to agent' }
		});
		setIcon(sendButton, 'play');

		// Event listeners
		userInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				callbacks.sendMessage();
			} else if (e.key === '@') {
				// Trigger file mention
				e.preventDefault();
				callbacks.showFileMention();
			}
		});

		// Handle paste to strip formatting
		userInput.addEventListener('paste', async (e) => {
			// Try to prevent default first
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

		sendButton.addEventListener('click', () => callbacks.sendMessage());

		return { userInput, sendButton };
	}

	/**
	 * Creates the progress bar
	 */
	private createProgressBar(
		container: HTMLElement
	): {
		progressBar: HTMLElement;
		progressFill: HTMLElement;
		progressStatus: HTMLElement;
		progressTimer: HTMLElement;
	} {
		container.style.display = 'none'; // Hidden by default

		// Progress bar wrapper
		const barWrapper = container.createDiv({
			cls: 'gemini-agent-progress-bar-wrapper'
		});

		const progressBar = barWrapper.createDiv({
			cls: 'gemini-agent-progress-bar'
		});

		const progressFill = progressBar.createDiv({
			cls: 'gemini-agent-progress-fill'
		});

		// Status text container
		const statusContainer = container.createDiv({
			cls: 'gemini-agent-progress-status-container'
		});

		const progressStatus = statusContainer.createSpan({
			cls: 'gemini-agent-progress-status-text'
		});

		const progressTimer = statusContainer.createSpan({
			cls: 'gemini-agent-progress-timer',
			attr: {
				'aria-live': 'polite',
				'aria-label': 'Elapsed time'
			}
		});

		return { progressBar, progressFill, progressStatus, progressTimer };
	}

	/**
	 * Updates the context files list display
	 */
	updateContextFilesList(
		container: HTMLElement,
		currentSession: ChatSession | null,
		callbacks: UICallbacks
	): void {
		container.empty();

		const hasContextFiles = currentSession && currentSession.context.contextFiles.length > 0;

		if (!hasContextFiles) {
			container.createEl('p', {
				text: 'No context files',
				cls: 'gemini-agent-empty-state'
			});
			return;
		}

		// Get the currently active file to mark it with a badge
		const activeFile = this.app.workspace.getActiveFile();

		// Show all context files with remove buttons
		if (currentSession) {
			currentSession.context.contextFiles.forEach(file => {
				const isActiveFile = file === activeFile;

				const fileItem = container.createDiv({ cls: 'gemini-agent-file-item' });

				// Add file icon
				const fileIcon = fileItem.createEl('span', { cls: 'gemini-agent-file-icon' });
				setIcon(fileIcon, 'file-text');

				const fileName = fileItem.createEl('span', {
					text: file.basename,
					cls: 'gemini-agent-file-name',
					title: file.path // Show full path on hover
				});

				// Add "Active" badge if this is the currently open file
				if (isActiveFile) {
					const badge = fileItem.createEl('span', {
						text: 'Active',
						cls: 'gemini-agent-active-badge',
						title: 'This is the currently open file'
					});
				}

				const removeBtn = fileItem.createEl('button', {
					text: '×',
					cls: 'gemini-agent-remove-btn',
					title: 'Remove file'
				});

				removeBtn.addEventListener('click', () => {
					callbacks.removeContextFile(file);
				});
			});
		}
	}

	/**
	 * Creates and displays the empty state when no messages exist
	 */
	async showEmptyState(
		chatContainer: HTMLElement,
		userInput: HTMLDivElement,
		callbacks: UICallbacks
	): Promise<void> {
		if (chatContainer.children.length === 0) {
			const emptyState = chatContainer.createDiv({ cls: 'gemini-agent-empty-chat' });

			const icon = emptyState.createDiv({ cls: 'gemini-agent-empty-icon' });
			setIcon(icon, 'sparkles');

			emptyState.createEl('h3', {
				text: 'Start a conversation',
				cls: 'gemini-agent-empty-title'
			});

			emptyState.createEl('p', {
				text: 'Your AI assistant that can actively work with your vault.',
				cls: 'gemini-agent-empty-desc'
			});

			// What can the agent do section
			const capabilities = emptyState.createDiv({ cls: 'gemini-agent-capabilities' });

			capabilities.createEl('h4', {
				text: 'What can the Agent do?',
				cls: 'gemini-agent-capabilities-title'
			});

			const capList = capabilities.createEl('ul', { cls: 'gemini-agent-capabilities-list' });

			AGENT_CAPABILITIES.forEach(item => {
				const li = capList.createEl('li', { cls: 'gemini-agent-capability-item' });
				const iconEl = li.createSpan({ cls: 'gemini-agent-capability-icon' });
				setIcon(iconEl, item.icon);
				li.createSpan({ text: item.text, cls: 'gemini-agent-capability-text' });
			});

			// Documentation link
			const docsLink = capabilities.createDiv({ cls: 'gemini-agent-docs-link' });
			const linkEl = docsLink.createEl('a', {
				text: '📖 Learn more about Agent Mode',
				cls: 'gemini-agent-docs-link-text'
			});
			linkEl.href = AGENT_MODE_GUIDE_URL;
			linkEl.setAttribute('aria-label', 'Open Agent Mode documentation in new tab');
			linkEl.addEventListener('click', (e) => {
				e.preventDefault();
				// Validate URL before opening
				if (linkEl.href.startsWith(DOCS_BASE_URL)) {
					try {
						window.open(linkEl.href, '_blank');
					} catch (error) {
						this.plugin.logger.error('Failed to open documentation link:', error);
						new Notice('Failed to open documentation. Please check your browser settings.');
					}
				} else {
					this.plugin.logger.error('Invalid documentation URL');
				}
			});

			// Check if AGENTS.md exists and show appropriate button
			const agentsMemoryExists = await this.plugin.agentsMemory.exists();

			const initButton = emptyState.createDiv({
				cls: agentsMemoryExists
					? 'gemini-agent-init-context-button gemini-agent-init-context-button-update'
					: 'gemini-agent-init-context-button'
			});

			const buttonIcon = initButton.createDiv({ cls: 'gemini-agent-init-icon' });
			setIcon(buttonIcon, agentsMemoryExists ? 'refresh-cw' : 'sparkles');

			const buttonText = initButton.createDiv({ cls: 'gemini-agent-init-text' });

			if (agentsMemoryExists) {
				buttonText.createEl('strong', { text: 'Update Vault Context' });
				buttonText.createEl('span', {
					text: 'Refresh my understanding of your vault',
					cls: 'gemini-agent-init-desc'
				});
			} else {
				buttonText.createEl('strong', { text: 'Initialize Vault Context' });
				buttonText.createEl('span', {
					text: 'Help me understand your vault structure and organization',
					cls: 'gemini-agent-init-desc'
				});
			}

			initButton.addEventListener('click', async () => {
				// Run the vault analyzer
				if (this.plugin.vaultAnalyzer) {
					await this.plugin.vaultAnalyzer.initializeAgentsMemory();
					// Refresh the empty state to update the button
					await this.showEmptyState(chatContainer, userInput, callbacks);
				}
			});

			// Try to get recent sessions (excluding the current session)
			// Fetch 6 sessions since we might filter out the current one
			const allRecentSessions = await this.plugin.sessionManager.getRecentAgentSessions(6);
			const recentSessions = allRecentSessions
				.filter(session => !callbacks.isCurrentSession(session))
				.slice(0, 5); // Limit to 5 after filtering

			if (recentSessions.length > 0) {
				// Show recent sessions
				emptyState.createEl('p', {
					text: 'Recent sessions:',
					cls: 'gemini-agent-suggestions-header'
				});

				const sessionsContainer = emptyState.createDiv({ cls: 'gemini-agent-suggestions' });

				recentSessions.forEach(session => {
					const suggestion = sessionsContainer.createDiv({
						cls: 'gemini-agent-suggestion gemini-agent-suggestion-session'
					});

					suggestion.createEl('span', {
						text: session.title,
						cls: 'gemini-agent-suggestion-title'
					});

					suggestion.createEl('span', {
						text: new Date(session.lastActive).toLocaleDateString(),
						cls: 'gemini-agent-suggestion-date'
					});

					suggestion.addEventListener('click', async () => {
						await callbacks.loadSession(session);
					});
				});
			}

			// Always show example prompts
			emptyState.createEl('p', {
				text: 'Try these examples:',
				cls: 'gemini-agent-suggestions-header'
			});

			const examplesContainer = emptyState.createDiv({ cls: 'gemini-agent-suggestions gemini-agent-examples' });

			EXAMPLE_PROMPTS.forEach(example => {
				const suggestion = examplesContainer.createDiv({
					cls: 'gemini-agent-suggestion gemini-agent-suggestion-example'
				});

				const iconEl = suggestion.createSpan({ cls: 'gemini-agent-example-icon' });
				setIcon(iconEl, example.icon);

				suggestion.createSpan({
					text: example.text,
					cls: 'gemini-agent-example-text'
				});

				suggestion.addEventListener('click', () => {
					userInput.textContent = example.text;
					userInput.focus();
				});
			});
		}
	}
}
