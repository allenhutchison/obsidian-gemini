import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ChatSession, SessionType } from '../types/agent';
import { GeminiConversationEntry } from '../types/conversation';
import type ObsidianGemini from '../main';
import { GeminiClientFactory } from '../api/simple-factory';
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
import { FileMentionModal } from './file-mention-modal';
import { SessionSettingsModal } from './session-settings-modal';
import { TFolder, TAbstractFile } from 'obsidian';
import {
	getDOMContext,
	getContextSelection,
	createContextRange,
	createContextElement,
	createContextTextNode,
	insertTextAtCursor,
	insertNodeAtCursor,
	moveCursorToEnd,
	execContextCommand
} from '../utils/dom-context';
import { ToolConverter } from '../tools/tool-converter';
import { ToolExecutionContext } from '../tools/types';
import { ExtendedModelRequest } from '../api/interfaces/model-api';
import { CustomPrompt } from '../prompts/types';
import * as Handlebars from 'handlebars';
import { AgentFactory } from '../agent/agent-factory';
import { ChatTimer } from '../utils/timer-utils';
import { shouldExcludePathForPlugin } from '../utils/file-utils';
import { generateToolDescription } from '../utils/text-generation';

export const VIEW_TYPE_AGENT = 'gemini-agent-view';

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

// Progress bar text truncation constants
const PROGRESS_THOUGHT_MAX_LENGTH = 150;
const PROGRESS_THOUGHT_DISPLAY_LENGTH = 147; // Leave room for "..."

export class AgentView extends ItemView {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private currentSession: ChatSession | null = null;
	private chatContainer: HTMLElement;
	private userInput: HTMLDivElement;
	private sendButton: HTMLButtonElement;
	private contextPanel: HTMLElement;
	private sessionHeader: HTMLElement;
	private currentStreamingResponse: { cancel: () => void } | null = null;
	private mentionedFiles: TFile[] = [];
	private allowedWithoutConfirmation: Set<string> = new Set(); // Session-level allowed tools
	private scrollTimeout: NodeJS.Timeout | null = null;
	private chatTimer: ChatTimer = new ChatTimer();
	private activeFileChangeHandler: () => void;
	private autoAddedActiveFile: TFile | null = null; // Track the auto-added active file
	private progressBarContainer: HTMLElement;
	private progressBar: HTMLElement;
	private progressFill: HTMLElement;
	private progressStatus: HTMLElement;
	private progressTimer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: InstanceType<typeof ObsidianGemini>) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT;
	}

	getDisplayText(): string {
		return 'Agent Mode';
	}

	getIcon(): string {
		return 'sparkles';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('gemini-agent-container');

		await this.createAgentInterface(container as HTMLElement);

		// Register link click handler for internal links
		this.registerLinkClickHandler();

		// Register active file change listener to update context panel and header
		this.activeFileChangeHandler = async () => {
			// Add active file to session context
			await this.addActiveFileToContext();

			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			this.updateSessionHeader();
		};
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', this.activeFileChangeHandler)
		);

		// Create default agent session
		await this.createNewSession();
	}

	private async createAgentInterface(container: HTMLElement) {
		// Add the main container class
		container.addClass('gemini-agent-container');
		
		// Compact header bar with title and primary controls
		this.sessionHeader = container.createDiv({ cls: 'gemini-agent-header gemini-agent-header-compact' });
		this.createCompactHeader();

		// Collapsible context panel
		this.contextPanel = container.createDiv({ cls: 'gemini-agent-context-panel gemini-agent-context-panel-collapsed' });
		this.createContextPanel();

		// Chat container (will expand to fill available space)
		this.chatContainer = container.createDiv({ cls: 'gemini-agent-chat' });
		await this.showEmptyState();

		// Progress bar container (fixed position above input)
		const progressContainer = container.createDiv({ cls: 'gemini-agent-progress-container' });
		this.createProgressBar(progressContainer);

		// Input area
		const inputArea = container.createDiv({ cls: 'gemini-agent-input-area' });
		this.createInputArea(inputArea);
	}

	private createCompactHeader() {
		this.sessionHeader.empty();
		
		// Left section: Title and context toggle
		const leftSection = this.sessionHeader.createDiv({ cls: 'gemini-agent-header-left' });
		
		// Toggle button for context panel
		const toggleBtn = leftSection.createEl('button', {
			cls: 'gemini-agent-toggle-btn',
			title: 'Toggle context panel'
		});
		setIcon(toggleBtn, 'chevron-down');
		
		toggleBtn.addEventListener('click', () => {
			const isCollapsed = this.contextPanel.hasClass('gemini-agent-context-panel-collapsed');
			if (isCollapsed) {
				this.contextPanel.removeClass('gemini-agent-context-panel-collapsed');
				setIcon(toggleBtn, 'chevron-up');
			} else {
				this.contextPanel.addClass('gemini-agent-context-panel-collapsed');
				setIcon(toggleBtn, 'chevron-down');
			}
		});
		
		// Title container to maintain consistent layout
		const titleContainer = leftSection.createDiv({ cls: 'gemini-agent-title-container' });
		
		// Session title (inline, not as large)
		const title = titleContainer.createEl('span', { 
			text: this.currentSession?.title || 'New Agent Session',
			cls: 'gemini-agent-title-compact'
		});
		
		// Make title editable on double-click
		title.addEventListener('dblclick', () => {
			if (!this.currentSession) return;
			
			const input = titleContainer.createEl('input', {
				type: 'text',
				value: this.currentSession.title,
				cls: 'gemini-agent-title-input-compact'
			});
			
			title.style.display = 'none';
			input.focus();
			input.select();
			
			const saveTitle = async () => {
				const newTitle = input.value.trim();
				if (newTitle && newTitle !== this.currentSession!.title) {
					// Update session title
					const oldPath = this.currentSession!.historyPath;
					const sanitizedTitle = (this.plugin.sessionManager as any).sanitizeFileName(newTitle);
					const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + sanitizedTitle + '.md';
					
					// Rename file if it exists
					const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile) {
						await this.plugin.app.fileManager.renameFile(oldFile, newPath);
						this.currentSession!.historyPath = newPath;
					}
					
					this.currentSession!.title = newTitle;
					await this.updateSessionMetadata();
				}
				
				title.textContent = this.currentSession!.title;
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
		if (this.currentSession) {
			const totalContextFiles = this.currentSession.context.contextFiles.length;

			const contextBadge = leftSection.createEl('span', {
				cls: 'gemini-agent-context-badge',
				text: `${totalContextFiles} ${totalContextFiles === 1 ? 'file' : 'files'}`
			});
		}
		
		// Model config badge (if non-default settings)
		if (this.currentSession?.modelConfig) {
			const hasCustomSettings = 
				this.currentSession.modelConfig.model ||
				this.currentSession.modelConfig.temperature !== undefined ||
				this.currentSession.modelConfig.topP !== undefined ||
				this.currentSession.modelConfig.promptTemplate;
			
			if (hasCustomSettings) {
				// Build detailed tooltip
				const tooltipParts: string[] = [];
				
				if (this.currentSession.modelConfig.model) {
					tooltipParts.push(`Model: ${this.currentSession.modelConfig.model}`);
				}
				if (this.currentSession.modelConfig.temperature !== undefined) {
					tooltipParts.push(`Temperature: ${this.currentSession.modelConfig.temperature}`);
				}
				if (this.currentSession.modelConfig.topP !== undefined) {
					tooltipParts.push(`Top-P: ${this.currentSession.modelConfig.topP}`);
				}
				if (this.currentSession.modelConfig.promptTemplate) {
					const promptName = this.currentSession.modelConfig.promptTemplate.split('/').pop()?.replace('.md', '') || 'custom';
					tooltipParts.push(`Prompt: ${promptName}`);
				}
				
				// Show just the prompt template name if present, otherwise show icon
				if (this.currentSession.modelConfig.promptTemplate) {
					const promptName = this.currentSession.modelConfig.promptTemplate.split('/').pop()?.replace('.md', '') || 'Custom';
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
		const rightSection = this.sessionHeader.createDiv({ cls: 'gemini-agent-header-right' });
		
		// Settings button
		const settingsBtn = rightSection.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'Session Settings'
		});
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => this.showSessionSettings());
		
		const newSessionBtn = rightSection.createEl('button', { 
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'New Session'
		});
		setIcon(newSessionBtn, 'plus');
		newSessionBtn.addEventListener('click', () => this.createNewSession());
		
		const listSessionsBtn = rightSection.createEl('button', { 
			cls: 'gemini-agent-btn gemini-agent-btn-icon',
			title: 'Browse Sessions'
		});
		setIcon(listSessionsBtn, 'list');
		listSessionsBtn.addEventListener('click', () => this.showSessionList());
	}

	private createSessionHeader() {
		// Just call the compact header method
		this.createCompactHeader();
	}

	private createContextPanel() {
		this.contextPanel.empty();

		// Compact context controls
		const controlsRow = this.contextPanel.createDiv({ cls: 'gemini-agent-context-controls' });
		
		// Add files button
		const addButton = controlsRow.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-sm',
			title: 'Add context files'
		});
		setIcon(addButton, 'plus');
		addButton.createSpan({ text: ' Add Files' });
		addButton.addEventListener('click', () => this.showFilePicker());

		// Context files list (compact)
		const filesList = this.contextPanel.createDiv({ cls: 'gemini-agent-files-list gemini-agent-files-list-compact' });
		this.updateContextFilesList(filesList);
	}


	private createInputArea(container: HTMLElement) {
		// Create contenteditable div for rich input
		this.userInput = container.createDiv({
			cls: 'gemini-agent-input gemini-agent-input-rich',
			attr: {
				contenteditable: 'true',
				'data-placeholder': 'Message the agent... (@ to mention files)'
			}
		});

		this.sendButton = container.createEl('button', {
			text: 'Send',
			cls: 'gemini-agent-btn gemini-agent-btn-primary gemini-agent-send-btn'
		});

		// Event listeners
		this.userInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			} else if (e.key === '@') {
				// Trigger file mention
				e.preventDefault();
				this.showFileMention();
			}
		});
		
		// Handle paste to strip formatting
		this.userInput.addEventListener('paste', async (e) => {
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
						this.userInput.focus();

						// Try using execCommand as absolute fallback
						// This will paste with formatting, but we'll clean it up after
						execContextCommand(this.userInput, 'paste');

						// Give it a moment to paste, then clean up formatting
						setTimeout(() => {
							// Get just the text content, removing all HTML
							const plainText = this.userInput.innerText || this.userInput.textContent || '';

							// Clear and set plain text
							this.userInput.textContent = plainText;

							// Move cursor to end
							moveCursorToEnd(this.userInput);
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
				insertTextAtCursor(this.userInput, text);
			}
		});

		this.sendButton.addEventListener('click', () => this.sendMessage());
	}

	private createProgressBar(container: HTMLElement) {
		this.progressBarContainer = container;
		this.progressBarContainer.style.display = 'none'; // Hidden by default

		// Progress bar wrapper
		const barWrapper = this.progressBarContainer.createDiv({
			cls: 'gemini-agent-progress-bar-wrapper'
		});

		this.progressBar = barWrapper.createDiv({
			cls: 'gemini-agent-progress-bar'
		});

		this.progressFill = this.progressBar.createDiv({
			cls: 'gemini-agent-progress-fill'
		});

		// Status text container
		const statusContainer = this.progressBarContainer.createDiv({
			cls: 'gemini-agent-progress-status-container'
		});

		this.progressStatus = statusContainer.createSpan({
			cls: 'gemini-agent-progress-status-text'
		});

		this.progressTimer = statusContainer.createSpan({
			cls: 'gemini-agent-progress-timer',
			attr: {
				'aria-live': 'polite',
				'aria-label': 'Elapsed time'
			}
		});
	}

	/**
	 * Escape HTML entities to prevent XSS
	 */
	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * Convert simple markdown formatting to HTML for progress status
	 * Handles **bold** and basic text
	 * Note: Input is sanitized before markdown conversion to prevent XSS
	 */
	private formatProgressText(text: string): string {
		if (!text) return '';

		// First, escape HTML entities to prevent XSS
		let formatted = this.escapeHtml(text);

		// Then convert **text** to <strong>text</strong>
		formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

		// Replace newlines with spaces for single-line display
		formatted = formatted.replace(/\n+/g, ' ');

		// Trim extra spaces
		formatted = formatted.replace(/\s+/g, ' ').trim();

		return formatted;
	}

	private showProgress(statusText: string, state: 'thinking' | 'tool' | 'waiting' | 'streaming') {
		if (!this.progressBarContainer) return;

		this.progressBarContainer.style.display = 'block';
		this.progressStatus.innerHTML = this.formatProgressText(statusText);

		// Update state class for color coding
		this.progressFill.className = 'gemini-agent-progress-fill';
		this.progressFill.addClass(`gemini-agent-progress-${state}`);

		// Start timer if not already running
		if (!this.chatTimer.isRunning()) {
			this.chatTimer.start(this.progressTimer);
		}
	}

	private updateProgress(statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming') {
		if (!this.progressBarContainer || this.progressBarContainer.style.display === 'none') return;

		this.progressStatus.innerHTML = this.formatProgressText(statusText);

		if (state) {
			this.progressFill.className = 'gemini-agent-progress-fill';
			this.progressFill.addClass(`gemini-agent-progress-${state}`);
		}
	}

	private hideProgress() {
		if (!this.progressBarContainer) return;

		this.progressBarContainer.style.display = 'none';
		this.chatTimer.stop();
	}

	private updateContextFilesList(container: HTMLElement) {
		container.empty();

		const hasContextFiles = this.currentSession && this.currentSession.context.contextFiles.length > 0;

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
		if (this.currentSession) {
			this.currentSession.context.contextFiles.forEach(file => {
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
					this.removeContextFile(file);
				});
			});
		}
	}

	private async showFilePicker() {
		if (!this.currentSession) return;

		const modal = new FilePickerModal(
			this.app,
			(selectedFiles) => {
				selectedFiles.forEach(file => {
					if (!this.currentSession!.context.contextFiles.includes(file)) {
						this.currentSession!.context.contextFiles.push(file);
					}
				});
				this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
				this.updateSessionHeader();
				this.updateSessionMetadata();
			},
			this.plugin // Plugin instance for automatic exclusion
		);

		modal.open();
	}

	private removeContextFile(file: TFile) {
		if (!this.currentSession) return;

		const index = this.currentSession.context.contextFiles.indexOf(file);
		if (index > -1) {
			this.currentSession.context.contextFiles.splice(index, 1);

			// If this was the auto-added active file, clear tracking
			if (this.autoAddedActiveFile === file) {
				this.autoAddedActiveFile = null;
			}

			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			this.updateSessionHeader();
			this.updateSessionMetadata();
		}
	}

	/**
	 * Add the currently active markdown file to session context
	 * Auto-replaces the previous auto-added file to avoid accumulation
	 */
	private async addActiveFileToContext() {
		if (!this.currentSession) return;

		const activeFile = this.app.workspace.getActiveFile();

		// Only add markdown files
		if (!activeFile || activeFile.extension !== 'md') return;

		// Check if file should be excluded (history files, system folders, etc.)
		if (shouldExcludePathForPlugin(activeFile.path, this.plugin)) return;

		// If this file is already the auto-added active file, nothing to do
		if (this.autoAddedActiveFile === activeFile) return;

		// If the new active file was manually added, don't modify the context
		// Keep tracking the existing auto-added file so it can be removed later
		if (this.currentSession.context.contextFiles.includes(activeFile)) {
			return;
		}

		// Remove previous auto-added file (if exists and still in context)
		if (this.autoAddedActiveFile) {
			const index = this.currentSession.context.contextFiles.indexOf(this.autoAddedActiveFile);
			if (index > -1) {
				this.currentSession.context.contextFiles.splice(index, 1);
			}
		}

		// Add new active file and track it
		this.currentSession.context.contextFiles.push(activeFile);
		this.autoAddedActiveFile = activeFile;

		// Save to frontmatter
		await this.updateSessionMetadata();
	}

	private async createNewSession() {
		try {
			// Clear current session and UI state
			this.currentSession = null;
			this.chatContainer.empty();
			this.mentionedFiles = []; // Clear any mentioned files from previous session
			this.allowedWithoutConfirmation.clear(); // Clear session-level permissions
			this.autoAddedActiveFile = null; // Clear auto-added file tracking
			
			// Clear input if it has content
			if (this.userInput) {
				this.userInput.innerHTML = '';
			}
			
			// Create new session with default context (no initial files)
			this.currentSession = await this.plugin.sessionManager.createAgentSession();

			// Add active file to context if there is one
			await this.addActiveFileToContext();

			// Update UI (no history to load for new session)
			this.createSessionHeader();
			this.createContextPanel();
			await this.showEmptyState();
			
			// Focus on input
			this.userInput.focus();
		} catch (error) {
			this.plugin.logger.error('Failed to create agent session:', error);
			new Notice('Failed to create agent session');
		}
	}

	/**
	 * Check if a session is the current session
	 * Compares both session ID and history path for robustness
	 */
	private isCurrentSession(session: ChatSession): boolean {
		if (!this.currentSession) return false;
		return session.id === this.currentSession.id ||
		       session.historyPath === this.currentSession.historyPath;
	}

	private async loadSessionHistory() {
		if (!this.currentSession) return;

		try {
			const history = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			this.chatContainer.empty();

			for (const entry of history) {
				await this.displayMessage(entry);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to load session history:', error);
		}
	}

	private async displayMessage(entry: GeminiConversationEntry) {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}
		
		const messageDiv = this.chatContainer.createDiv({ 
			cls: `gemini-agent-message gemini-agent-message-${entry.role}`
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', { 
			text: entry.role === 'user' ? 'You' : entry.role === 'system' ? 'System' : 'Agent',
			cls: 'gemini-agent-message-role'
		});
		header.createEl('span', { 
			text: entry.created_at.toLocaleTimeString(),
			cls: 'gemini-agent-message-time'
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });
		
		// Check if this is a tool execution message from history
		const isToolExecution = entry.metadata?.toolName || entry.message.includes('Tool Execution Results:');
		
		// Preserve line breaks in the message
		// Convert single newlines to double newlines for proper markdown rendering
		// But preserve existing double newlines and table formatting
		let formattedMessage = entry.message;
		if (entry.role === 'model') {
			// Split by lines to handle tables specially
			const lines = entry.message.split('\n');
			const formattedLines: string[] = [];
			let inTable = false;
			let previousLineWasEmpty = true;
			
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const nextLine = lines[i + 1];
				const trimmedLine = line.trim();
				
				// Improved table detection
				// A table row must have at least one pipe that's not escaped
				const hasUnescapedPipe = line.split('\\|').join('').includes('|');
				const isTableDivider = /^\s*\|?\s*[:?\-]+\s*\|/.test(line);
				const isTableRow = hasUnescapedPipe && !isTableDivider && trimmedLine !== '|';
				
				// Check if we're starting a table
				if ((isTableRow || isTableDivider) && !inTable) {
					inTable = true;
					// Add empty line before table if needed
					if (!previousLineWasEmpty && formattedLines.length > 0) {
						formattedLines.push('');
					}
				}
				
				// Add the current line
				formattedLines.push(line);
				
				// Check if we're ending a table
				if (inTable && !hasUnescapedPipe && trimmedLine !== '') {
					inTable = false;
					// Add empty line after table
					formattedLines.push('');
				} else if (inTable && trimmedLine === '') {
					// Empty line also ends a table
					inTable = false;
				}
				
				// For non-table content, add empty line between paragraphs
				if (!inTable && !hasUnescapedPipe && trimmedLine !== '' && 
					nextLine && nextLine.trim() !== '' && !nextLine.includes('|')) {
					formattedLines.push('');
				}
				
				previousLineWasEmpty = trimmedLine === '';
			}
			
			formattedMessage = formattedLines.join('\n');
			
			// Debug logging for table formatting
			if (formattedMessage.includes('|')) {
				this.plugin.logger.log('Table formatting debug:');
				this.plugin.logger.log('Original message:', entry.message);
				this.plugin.logger.log('Formatted message:', formattedMessage);
			}
		}
		
		// Get source path for proper link resolution
		const sourcePath = this.currentSession?.historyPath || '';
		
		// Special handling for tool execution messages
		if (isToolExecution && entry.message.includes('Tool Execution Results:')) {
			// Extract tool execution sections and make them collapsible
			const toolSections = formattedMessage.split(/### ([^\n]+)/);
			
			if (toolSections.length > 1) {
				// First part before any tool sections
				const intro = toolSections[0].trim();
				if (intro) {
					const introDiv = content.createDiv();
					await MarkdownRenderer.render(this.app, intro, introDiv, sourcePath, this);
				}
				
				// Process each tool section
				for (let i = 1; i < toolSections.length; i += 2) {
					const toolName = toolSections[i];
					const toolContent = toolSections[i + 1]?.trim() || '';
					
					if (toolName && toolContent) {
						// Create collapsible tool execution block
						const toolDiv = content.createDiv({ cls: 'gemini-agent-tool-execution' });
						const toolHeader = toolDiv.createDiv({ cls: 'gemini-agent-tool-header' });
						
						// Add expand/collapse icon
						const icon = toolHeader.createEl('span', { cls: 'gemini-agent-tool-icon' });
						setIcon(icon, 'chevron-right');
						
						// Tool name
						toolHeader.createEl('span', { 
							text: `Tool: ${toolName}`,
							cls: 'gemini-agent-tool-name'
						});
						
						// Tool status (if available)
						if (toolContent.includes('✅')) {
							toolHeader.createEl('span', { 
								text: 'Success',
								cls: 'gemini-agent-tool-status gemini-agent-tool-status-success'
							});
						} else if (toolContent.includes('❌')) {
							toolHeader.createEl('span', { 
								text: 'Failed',
								cls: 'gemini-agent-tool-status gemini-agent-tool-status-error'
							});
						}
						
						// Tool content (initially hidden)
						const toolContentDiv = toolDiv.createDiv({ 
							cls: 'gemini-agent-tool-content gemini-agent-tool-content-collapsed'
						});
						
						// Render the tool content
						await MarkdownRenderer.render(this.app, toolContent, toolContentDiv, sourcePath, this);
						
						// Toggle handler
						toolHeader.addEventListener('click', () => {
							const isCollapsed = toolContentDiv.hasClass('gemini-agent-tool-content-collapsed');
							if (isCollapsed) {
								toolContentDiv.removeClass('gemini-agent-tool-content-collapsed');
								setIcon(icon, 'chevron-down');
							} else {
								toolContentDiv.addClass('gemini-agent-tool-content-collapsed');
								setIcon(icon, 'chevron-right');
							}
						});
					}
				}
			} else {
				// No tool sections found, render normally
				await MarkdownRenderer.render(this.app, formattedMessage, content, sourcePath, this);
			}
		} else {
			// Use markdown rendering like the regular chat view
			await MarkdownRenderer.render(this.app, formattedMessage, content, sourcePath, this);
		}
		
		// Scroll to bottom after displaying message
		this.scrollToBottom();

		// Add a copy button for both user and model messages
		if (entry.role === 'model' || entry.role === 'user') {
			const copyButton = content.createEl('button', {
				cls: 'gemini-agent-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Use the original message text to preserve formatting
				navigator.clipboard
					.writeText(entry.message)
					.then(() => {
						new Notice('Message copied to clipboard.');
					})
					.catch((err) => {
						new Notice('Could not copy message to clipboard. Try selecting and copying manually.');
						this.plugin.logger.error(err);
					});
			});
		}

		// Auto-scroll to bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	private async showFileMention() {
		const modal = new FileMentionModal(
			this.app,
			(item: TAbstractFile) => {
				if (item instanceof TFolder) {
					this.insertFolderChip(item);
				} else if (item instanceof TFile) {
					this.insertFileChip(item);
				}
			},
			this.plugin // Plugin instance for automatic exclusion
		);
		modal.open();
	}
	
	private insertFolderChip(folder: TFolder) {
		// Get all markdown files in the folder recursively
		const files = this.getFilesFromFolder(folder);
		
		// Add files to mentioned files list
		for (const file of files) {
			if (!this.mentionedFiles.includes(file)) {
				this.mentionedFiles.push(file);
			}
			
			// Also add to session context files if not already there
			if (this.currentSession && !this.currentSession.context.contextFiles.includes(file)) {
				this.currentSession.context.contextFiles.push(file);
			}
		}
		
		// Update UI
		if (this.currentSession) {
			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			this.updateSessionHeader();
			this.updateSessionMetadata();
		}
		
		// Create folder chip element
		const chip = this.createFolderChip(folder, files.length);
		
		// Insert at current cursor position
		this.insertChipAtCursor(chip);
	}
	
	private getFilesFromFolder(folder: TFolder): TFile[] {
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
	
	private insertFileChip(file: TFile) {
		// Add file to mentioned files list
		if (!this.mentionedFiles.includes(file)) {
			this.mentionedFiles.push(file);
		}
		
		// Also add to session context files if not already there
		if (this.currentSession && !this.currentSession.context.contextFiles.includes(file)) {
			this.currentSession.context.contextFiles.push(file);
			// Update the UI to reflect the new context file
			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			this.updateSessionHeader();
			this.updateSessionMetadata();
		}
		
		// Create chip element
		const chip = this.createFileChip(file);
		
		// Insert at current cursor position
		this.insertChipAtCursor(chip);
	}
	
	private insertChipAtCursor(chip: HTMLElement) {
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
	
	private createFileChip(file: TFile): HTMLElement {
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
			// Remove from mentioned files
			const index = this.mentionedFiles.indexOf(file);
			if (index > -1) {
				this.mentionedFiles.splice(index, 1);
			}
			// Also remove from session context if it was added via mention
			if (this.currentSession) {
				const contextIndex = this.currentSession.context.contextFiles.indexOf(file);
				if (contextIndex > -1) {
					this.currentSession.context.contextFiles.splice(contextIndex, 1);
					this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
					this.updateSessionHeader();
					this.updateSessionMetadata();
				}
			}
		});
		
		return chip;
	}
	
	private createFolderChip(folder: TFolder, fileCount: number): HTMLElement {
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
				const index = this.mentionedFiles.indexOf(file);
				if (index > -1) {
					this.mentionedFiles.splice(index, 1);
				}
				// Also remove from session context
				if (this.currentSession) {
					const contextIndex = this.currentSession.context.contextFiles.indexOf(file);
					if (contextIndex > -1) {
						this.currentSession.context.contextFiles.splice(contextIndex, 1);
					}
				}
			}
			// Update UI
			if (this.currentSession) {
				this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
				this.updateSessionHeader();
				this.updateSessionMetadata();
			}
		});
		
		return chip;
	}
	
	private extractMessageContent(): { text: string; files: TFile[]; formattedMessage: string } {
		// Clone the input to process
		const clone = this.userInput.cloneNode(true) as HTMLElement;
		
		// Replace file and folder chips with markdown links in the clone
		const fileChips = clone.querySelectorAll('.gemini-agent-file-chip');
		fileChips.forEach((chip: Element) => {
			const filePath = chip.getAttribute('data-file-path');
			if (filePath) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile) {
					// Create markdown link
					const link = document.createTextNode(`[[${file.basename}]]`);
					chip.replaceWith(link);
				}
			}
		});
		
		const folderChips = clone.querySelectorAll('.gemini-agent-folder-chip');
		folderChips.forEach((chip: Element) => {
			const folderPath = chip.getAttribute('data-folder-path');
			const fileCount = chip.getAttribute('data-file-count');
			if (folderPath) {
				// Create text representation of folder
				const text = document.createTextNode(`📁 ${folderPath}/ (${fileCount} files)`);
				chip.replaceWith(text);
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

	private async sendMessage() {
		if (!this.currentSession) {
			new Notice('No active session');
			return;
		}

		const { text: message, files, formattedMessage } = this.extractMessageContent();
		if (!message && files.length === 0) return;

		// Clear input and mentioned files
		this.userInput.innerHTML = '';
		this.mentionedFiles = [];
		this.sendButton.disabled = true;

		// Show progress bar
		this.showProgress('Thinking...', 'thinking');

		// Display user message with formatted version (includes markdown links)
		const userEntry: GeminiConversationEntry = {
			role: 'user',
			message: formattedMessage, // Use formatted message for display/history
			notePath: '',
			created_at: new Date()
		};
		await this.displayMessage(userEntry);

		try {
			// Start with session context files (active file is already included if present)
			const allContextFiles = [...this.currentSession.context.contextFiles];

			// Add mentioned files to context temporarily
			files.forEach(file => {
				if (!allContextFiles.includes(file)) {
					allContextFiles.push(file);
				}
			});
			
			// Get conversation history
			const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			
			// Build context for AI request including mentioned files
			const contextInfo = await this.plugin.gfile.buildFileContext(
				allContextFiles,
				true // renderContent
			);
			
			// Load custom prompt if session has one configured
			let customPrompt: CustomPrompt | undefined;
			if (this.currentSession?.modelConfig?.promptTemplate) {
				try {
					// Use the promptManager to robustly load the custom prompt
					const loadedPrompt = await this.plugin.promptManager.loadPromptFromFile(
						this.currentSession.modelConfig.promptTemplate
					);
					if (loadedPrompt) {
						customPrompt = loadedPrompt;
					} else {
						this.plugin.logger.warn(
							'Custom prompt file not found or failed to load:',
							this.currentSession.modelConfig.promptTemplate
						);
					}
				} catch (error) {
					this.plugin.logger.error('Error loading custom prompt:', error);
				}
			}

			// Build additional prompt instructions (not part of system prompt)
			let additionalInstructions = '';

			// Add mention note if files were mentioned
			if (files.length > 0) {
				const fileNames = files.map(f => f.basename).join(', ');
				additionalInstructions += `\n\nIMPORTANT: The user has specifically referenced the following files using @ mentions: ${fileNames}
These files are included in the context below. When the user asks you to write data to or modify these files, you should:
1. First use the read_file tool to examine their current contents
2. Then use the write_file tool to update them with the new or modified content
3. If adding new data, integrate it appropriately with the existing content rather than creating a new file`;
			}

			// Add context information if available
			if (contextInfo) {
				additionalInstructions += `\n\n${contextInfo}`;
			}

			// Get available tools for this session
			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);
			this.plugin.logger.log('Available tools from registry:', availableTools);
			this.plugin.logger.log('Number of tools:', availableTools.length);
			this.plugin.logger.log('Tool names:', availableTools.map(t => t.name));

			try {
				// Get model config from session or use defaults
				const modelConfig = this.currentSession?.modelConfig || {};

				const request: ExtendedModelRequest = {
					userMessage: message,
					conversationHistory: conversationHistory,
					model: modelConfig.model || this.plugin.settings.chatModelName,
					temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
					topP: modelConfig.topP ?? this.plugin.settings.topP,
					prompt: additionalInstructions, // Additional context and instructions
					customPrompt: customPrompt, // Custom prompt template (if configured)
					renderContent: false, // We already rendered content above
					availableTools: availableTools // No need to cast to any
				};
				
				// Create model API for this session
				const modelApi = AgentFactory.createAgentModel(this.plugin, this.currentSession!);
				
				// Check if streaming is supported and enabled
				if (modelApi.generateStreamingResponse && this.plugin.settings.streamingEnabled !== false) {
					// Use streaming API with tool support
					let modelMessageContainer: HTMLElement | null = null;
					let accumulatedMarkdown = '';
					let accumulatedThoughts = '';
					let progressUpdated = false;

					const streamResponse = modelApi.generateStreamingResponse(request, (chunk) => {
						// Handle thought content - show in progress bar
						if (chunk.thought) {
							accumulatedThoughts += chunk.thought;
							this.progressStatus.title = accumulatedThoughts; // Show full thought on hover

							// Truncate for display, showing the latest part
							const displayThought = accumulatedThoughts.length > PROGRESS_THOUGHT_MAX_LENGTH
								? '...' + accumulatedThoughts.slice(-PROGRESS_THOUGHT_DISPLAY_LENGTH)
								: accumulatedThoughts;
							this.updateProgress(displayThought, 'thinking');
						}

						// Handle text content
						if (chunk.text) {
							accumulatedMarkdown += chunk.text;

							// Update progress to streaming state when first text chunk arrives
							if (!progressUpdated) {
								this.updateProgress('Generating response...', 'streaming');
								progressUpdated = true;
							}

							// Create or update the model message container
							if (!modelMessageContainer) {
								// First chunk - create the container
								modelMessageContainer = this.createStreamingMessageContainer('model');
								this.updateStreamingMessage(modelMessageContainer, chunk.text);
							} else {
								// Update existing container with new chunk
								this.updateStreamingMessage(modelMessageContainer, chunk.text);
								// Use debounced scroll to avoid stuttering
								this.debouncedScrollToBottom();
							}
						}
					});
					
					// Store the streaming response for potential cancellation
					this.currentStreamingResponse = streamResponse;
					
					try {
						const response = await streamResponse.complete;
						this.currentStreamingResponse = null;

						// Check if the model requested tool calls
						if (response.toolCalls && response.toolCalls.length > 0) {
							// Save user message to history first
							if (this.plugin.settings.chatHistory) {
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
							}
							
							// If there was any streamed text before tool calls, finalize it
							if (modelMessageContainer && accumulatedMarkdown.trim()) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: accumulatedMarkdown,
									notePath: '',
									created_at: new Date()
								};
								await this.finalizeStreamingMessage(modelMessageContainer, accumulatedMarkdown, aiEntry);
								
								// Save partial response to history before executing tools
								if (this.plugin.settings.chatHistory) {
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
								}
							}
							
							// Execute tools and handle results
							await this.handleToolCalls(response.toolCalls, message, conversationHistory, userEntry, customPrompt);
						} else {
							// Normal response without tool calls
							// Only finalize and save if response has content
							if (response.markdown && response.markdown.trim()) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: response.markdown,
									notePath: '',
									created_at: new Date()
								};
								
								// Finalize the streaming message with proper rendering
								if (modelMessageContainer) {
									await this.finalizeStreamingMessage(modelMessageContainer, response.markdown, aiEntry);
								}
								
								// Save to history
								if (this.plugin.settings.chatHistory) {
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
									
									// Auto-label session after first exchange
									await this.autoLabelSessionIfNeeded();
								}
								
								// Ensure we're scrolled to bottom after streaming completes
								this.scrollToBottom();

								// Hide progress bar after successful response
								this.hideProgress();
							} else {
								// Empty response - might be thinking tokens
								this.plugin.logger.warn('Model returned empty response');
								new Notice('Model returned an empty response. This might happen with thinking models. Try rephrasing your question.');

								// Hide progress bar
								this.hideProgress();

								// Still save the user message to history
								if (this.plugin.settings.chatHistory) {
									await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
								}
							}
						}
					} catch (error) {
						this.currentStreamingResponse = null;
						// Hide progress bar on error
						this.hideProgress();
						throw error;
					}
				} else {
					// Fall back to non-streaming API
					this.plugin.logger.log('Agent view using non-streaming API');
					const response = await modelApi.generateModelResponse(request);

					// Update progress to show response received
					this.updateProgress('Processing response...', 'waiting');

					// Check if the model requested tool calls
					if (response.toolCalls && response.toolCalls.length > 0) {
						// Execute tools and handle results
						await this.handleToolCalls(response.toolCalls, message, conversationHistory, userEntry, customPrompt);
					} else {
						// Normal response without tool calls
						// Only display if response has content
						if (response.markdown && response.markdown.trim()) {
							// Display AI response
							const aiEntry: GeminiConversationEntry = {
								role: 'model',
								message: response.markdown,
								notePath: '',
								created_at: new Date()
							};
							await this.displayMessage(aiEntry);

							// Save to history
							if (this.plugin.settings.chatHistory) {
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

								// Auto-label session after first exchange
								await this.autoLabelSessionIfNeeded();
							}

							// Hide progress bar after successful response
							this.hideProgress();
						} else {
							// Empty response - might be thinking tokens
							this.plugin.logger.warn('Model returned empty response');
							new Notice('Model returned an empty response. This might happen with thinking models. Try rephrasing your question.');

							// Still save the user message to history
							if (this.plugin.settings.chatHistory) {
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
							}

							// Hide progress bar
							this.hideProgress();
						}
					}
				}
			} catch (error) {
				// Hide progress bar on error
				this.hideProgress();
				throw error;
			}

		} catch (error) {
			this.plugin.logger.error('Failed to send message:', error);
			new Notice('Failed to send message');
		} finally {
			this.sendButton.disabled = false;
		}
	}

	private async updateSessionMetadata() {
		if (!this.currentSession) return;

		try {
			await this.plugin.sessionHistory.updateSessionMetadata(this.currentSession);
		} catch (error) {
			this.plugin.logger.error('Failed to update session metadata:', error);
		}
	}

	private updateSessionHeader() {
		this.createSessionHeader();
	}

	private async showSessionList() {
		const modal = new SessionListModal(
			this.app,
			this.plugin,
			{
				onSelect: async (session: ChatSession) => {
					await this.loadSession(session);
				},
				onDelete: (session: ChatSession) => {
					// If the deleted session is the current one, create a new session
					if (this.currentSession && this.currentSession.id === session.id) {
						this.createNewSession();
					}
				}
			},
			this.currentSession?.id || null
		);
		modal.open();
	}

	private async loadSession(session: ChatSession) {
		try {
			this.currentSession = session;
			this.allowedWithoutConfirmation.clear(); // Clear session-level permissions when loading from history
			this.autoAddedActiveFile = null; // Clear auto-added file tracking when loading a session

			// Clear chat and reload history
			this.chatContainer.empty();
			await this.loadSessionHistory();
			
			// Update UI
			this.createSessionHeader();
			this.createContextPanel();
		} catch (error) {
			this.plugin.logger.error('Failed to load session:', error);
			new Notice('Failed to load session');
		}
	}

	getCurrentSessionForToolExecution(): ChatSession | null {
		return this.currentSession;
	}
	
	private registerLinkClickHandler() {
		this.containerEl.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.tagName === 'A' && target.classList.contains('internal-link')) {
				event.preventDefault();
				const filePath = target.getAttribute('href');
				if (filePath) {
					this.app.workspace.openLinkText(filePath, '', true);
				}
			}
		});
	}


	async onClose() {
		// Cleanup when view is closed
		if (this.currentStreamingResponse) {
			this.currentStreamingResponse.cancel();
		}
		// Clean up timer if still running
		this.chatTimer.destroy();
	}

	/**
	 * Auto-label session after first exchange if it still has default title
	 */
	private async autoLabelSessionIfNeeded() {
		if (!this.currentSession) return;
		
		// Check if this is still using a default title
		if (!this.currentSession.title.startsWith('Agent Session') && 
			!this.currentSession.title.startsWith('New Agent Session')) {
			return; // Already has a custom title
		}
		
		// Get the conversation history
		const history = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
		
		// Only auto-label after we have at least a user message and an AI response
		// Check for at least one user message and one model message
		const hasUserMessage = history.some(entry => entry.role === 'user');
		const hasModelMessage = history.some(entry => entry.role === 'model');
		
		if (!hasUserMessage || !hasModelMessage) return;
		
		// Check if we've already attempted to label this session
		// to avoid multiple labeling attempts
		if (this.currentSession.metadata && this.currentSession.metadata.autoLabeled) {
			return;
		}
		
		try {
			// Generate a title based on the conversation
			const titlePrompt = `Based on this conversation, suggest a concise title (max 50 characters) that captures the main topic or purpose. Return only the title text, no quotes or explanation.

Context Files: ${this.currentSession.context.contextFiles.map(f => f.basename).join(', ')}

User: ${history[0].message}`;

			try {
				// Generate title using the model (use default settings for labeling)
				const modelApi = GeminiClientFactory.createChatModel(this.plugin);
				const response = await modelApi.generateModelResponse({
					userMessage: titlePrompt,
					conversationHistory: [],
					model: this.plugin.settings.chatModelName,
					prompt: titlePrompt,
					renderContent: false
				});

				// Extract and sanitize the title
				const generatedTitle = response.markdown.trim()
					.replace(/^["']+|["']+$/g, '') // Remove quotes
					.substring(0, 50); // Ensure max length
				
				if (generatedTitle && generatedTitle.length > 0) {
					// Update session title
					this.currentSession.title = generatedTitle;
					
					// Mark session as auto-labeled to prevent multiple attempts
					if (!this.currentSession.metadata) {
						this.currentSession.metadata = {};
					}
					this.currentSession.metadata.autoLabeled = true;
					
					// Update history file name
					const oldPath = this.currentSession.historyPath;
					const newFileName = (this.plugin.sessionManager as any).sanitizeFileName(generatedTitle);
					const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newFileName + '.md';
					
					// Rename the history file
					const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile) {
						await this.plugin.app.fileManager.renameFile(oldFile, newPath);
						this.currentSession.historyPath = newPath;
					}
					
					// Update session metadata
					await this.updateSessionMetadata();
					
					// Update UI
					this.updateSessionHeader();

					this.plugin.logger.log(`Auto-labeled session: ${generatedTitle}`);
				}
			} catch (error) {
				this.plugin.logger.error('Failed to auto-label session:', error);
				// Don't show error to user - auto-labeling is a nice-to-have feature
			}
		} catch (error) {
			this.plugin.logger.error('Error in auto-labeling:', error);
		}
	}

	/**
	 * Show session settings modal
	 */
	private async showSessionSettings() {
		if (!this.currentSession) return;
		
		const modal = new SessionSettingsModal(
			this.app,
			this.plugin,
			this.currentSession,
			async (modelConfig) => {
				// Update the session with new model config
				await this.plugin.sessionManager.updateSessionModelConfig(
					this.currentSession!.id, 
					modelConfig
				);
				// Update header to show any indicators
				this.createCompactHeader();
			}
		);
		modal.open();
	}

	/**
	 * Sort tool calls to ensure safe execution order
	 * Prioritizes reads before writes/deletes to prevent race conditions
	 */
	private sortToolCallsByPriority(toolCalls: any[]): any[] {
		// Define priority order (lower number = higher priority)
		const toolPriority: Record<string, number> = {
			'read_file': 1,
			'list_files': 2,
			'search_files': 3,
			'google_search': 4,
			'web_fetch': 5,
			'write_file': 6,
			'create_folder': 7,
			'move_file': 8,
			'delete_file': 9  // Destructive operations last
		};

		// Sort by priority, maintaining original order for same priority
		return [...toolCalls].sort((a, b) => {
			const priorityA = toolPriority[a.name] || 10;
			const priorityB = toolPriority[b.name] || 10;
			return priorityA - priorityB;
		});
	}

	/**
	 * Handle tool calls from the model response
	 */
	private async handleToolCalls(
		toolCalls: any[],
		userMessage: string,
		conversationHistory: any[],
		userEntry: GeminiConversationEntry,
		customPrompt?: CustomPrompt
	) {
		if (!this.currentSession) return;


		// Execute each tool
		const toolResults: any[] = [];
		const context: ToolExecutionContext = {
			plugin: this.plugin,
			session: this.currentSession
		};

		// Sort tool calls to prioritize reads before destructive operations
		const sortedToolCalls = this.sortToolCallsByPriority(toolCalls);

		for (const toolCall of sortedToolCalls) {
			try {
				// Generate unique ID for this tool execution
				const toolExecutionId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

				// Update progress for this tool with human-friendly description
				const tool = this.plugin.toolRegistry.getTool(toolCall.name);
				const displayName = tool?.displayName || toolCall.name;

				// Use tool's own progress description if available, otherwise use fallback
				let toolDescription: string;
				if (tool?.getProgressDescription) {
					toolDescription = tool.getProgressDescription(toolCall.arguments);
				} else {
					toolDescription = generateToolDescription(this.plugin, toolCall.name, toolCall.arguments, displayName);
				}

				this.updateProgress(toolDescription, 'tool');

				// Show tool execution in UI
				await this.showToolExecution(toolCall.name, toolCall.arguments, toolExecutionId);

				// Execute the tool
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, context, this);

				// Show result in UI
				await this.showToolResult(toolCall.name, result, toolExecutionId);

				// Format result for the model - store original tool call with result
				toolResults.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments,
					result: result
				});
			} catch (error) {
				this.plugin.logger.error(`Tool execution error for ${toolCall.name}:`, error);
				toolResults.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments || {},
					result: {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error'
					}
				});
			}
		}

		// Note: User message was already saved to history before calling handleToolCalls
		// Don't save it again here to avoid duplicates

		// Build updated conversation history with proper Gemini API format:
		// 1. Previous conversation history
		// 2. User message (only if non-empty)
		// 3. Model response with tool calls (as functionCall parts)
		// 4. Tool results (as functionResponse parts)

		const updatedHistory = [
			...conversationHistory,
			// Model's tool calls
			{
				role: 'model',
				parts: toolCalls.map(tc => ({
					functionCall: {
						name: tc.name,
						args: tc.arguments || {}
					}
				}))
			},
			// Tool results as functionResponse
			{
				role: 'user',
				parts: toolResults.map(tr => ({
					functionResponse: {
						name: tr.toolName,
						response: tr.result
					}
				}))
			}
		];

		// Only add user message if it's non-empty
		// On recursive calls, userMessage will be empty since the message is already in conversationHistory
		if (userMessage && userMessage.trim()) {
			// Insert user message before the model's tool calls
			updatedHistory.splice(conversationHistory.length, 0, {
				role: 'user',
				parts: [{ text: userMessage }]
			});
		}

		// Send another request with the tool results
		try {
			// Get available tools again for the follow-up request
			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);

			// Get model config from session or use defaults
			const modelConfig = this.currentSession?.modelConfig || {};

			const followUpRequest: ExtendedModelRequest = {
				userMessage: "", // Empty since tool results are already in conversation history
				conversationHistory: updatedHistory,
				model: modelConfig.model || this.plugin.settings.chatModelName,
				temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
				topP: modelConfig.topP ?? this.plugin.settings.topP,
				prompt: this.plugin.prompts.generalPrompt({ userMessage: "Respond to the user based on the tool execution results" }),
				customPrompt: customPrompt, // Pass custom prompt through to follow-up requests
				renderContent: false,
				availableTools: availableTools  // Include tools so model can chain calls
			};

			// Update progress to show we're processing tool results
			this.updateProgress('Processing results...', 'waiting');

			// Use the same model API for follow-up requests
			const modelApi = AgentFactory.createAgentModel(this.plugin, this.currentSession!);

			// Update progress to show we're thinking about the response
			this.updateProgress('Thinking...', 'thinking');

			const followUpResponse = await modelApi.generateModelResponse(followUpRequest);
			
			// Check if the follow-up response also contains tool calls
			if (followUpResponse.toolCalls && followUpResponse.toolCalls.length > 0) {
				// Recursively handle additional tool calls
				// Don't pass a user message since the tool results are already in history
				await this.handleToolCalls(
					followUpResponse.toolCalls,
					"", // Empty message - tool results already in history
					updatedHistory,
					{
						role: 'system',
						message: 'Continuing with additional tool calls...',
						notePath: '',
						created_at: new Date()
					},
					customPrompt // Pass custom prompt through recursive calls
				);
			} else {
				// Display the final response only if it has content
				if (followUpResponse.markdown && followUpResponse.markdown.trim()) {
					const aiEntry: GeminiConversationEntry = {
						role: 'model',
						message: followUpResponse.markdown,
						notePath: '',
						created_at: new Date()
					};
					await this.displayMessage(aiEntry);

					// Save final response to history
					if (this.plugin.settings.chatHistory) {
						await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

						// Auto-label session after first exchange
						await this.autoLabelSessionIfNeeded();
					}

					// Hide progress bar after successful response
					this.hideProgress();
				} else {
					// Model returned empty response - this might happen with thinking tokens
					this.plugin.logger.warn('Model returned empty response after tool execution');
					// Try a simpler prompt to get a response
					const retryRequest: ExtendedModelRequest = {
						userMessage: "Please summarize what you just did with the tools.",
						conversationHistory: updatedHistory,
						model: modelConfig.model || this.plugin.settings.chatModelName,
						temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
						topP: modelConfig.topP ?? this.plugin.settings.topP,
						prompt: "Please summarize what you just did with the tools.",
						renderContent: false
					};
					
					// Use the same model API for retry requests
					const modelApi2 = AgentFactory.createAgentModel(this.plugin, this.currentSession!);
					const retryResponse = await modelApi2.generateModelResponse(retryRequest);
					
					if (retryResponse.markdown && retryResponse.markdown.trim()) {
						const aiEntry: GeminiConversationEntry = {
							role: 'model',
							message: retryResponse.markdown,
							notePath: '',
							created_at: new Date()
						};
						await this.displayMessage(aiEntry);

						// Save final response to history
						if (this.plugin.settings.chatHistory) {
							await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

							// Auto-label session after first exchange
							await this.autoLabelSessionIfNeeded();
						}

						// Hide progress bar after successful retry response
						this.hideProgress();
					}
				}
			}
		} catch (error) {
			this.plugin.logger.error('Failed to process tool results:', error);
			new Notice('Failed to process tool results');
			// Hide progress bar on error
			this.hideProgress();
		}
	}

	/**
	 * Format tool results for the model
	 */
	private formatToolResultsForModel(toolResults: any[]): string {
		let formatted = "Tool Execution Results:\n\n";
		
		for (const result of toolResults) {
			formatted += `### ${result.toolName}\n`;
			if (result.result.success) {
				formatted += `✅ Success\n`;
				if (result.result.data) {
					// Special handling for google_search results
					if (result.toolName === 'google_search' && result.result.data.answer && result.result.data.citations) {
						formatted += `**Search Query:** ${result.result.data.query}\n\n`;
						formatted += `**Answer with citations:**\n${result.result.data.answer}\n\n`;
						
						if (result.result.data.citations.length > 0) {
							formatted += `**Sources:**\n`;
							result.result.data.citations.forEach((citation: any, index: number) => {
								formatted += `${index + 1}. [${citation.title || citation.url}](${citation.url})`;
								if (citation.snippet) {
									formatted += ` - ${citation.snippet}`;
								}
								formatted += '\n';
							});
							formatted += '\n';
						}
						
						formatted += `**IMPORTANT:** Please incorporate these citations into your response to the user. Use the inline citation numbers [1], [2], etc. when referencing information from these sources, and include a "Sources" section at the end of your response with the full citation links.\n`;
					} else {
						// Default JSON formatting for other tools
						formatted += `\`\`\`json\n${JSON.stringify(result.result.data, null, 2)}\n\`\`\`\n`;
					}
				}
			} else {
				formatted += `❌ Failed\n`;
				formatted += `Error: ${result.result.error}\n`;
			}
			formatted += '\n';
		}
		
		return formatted;
	}

	/**
	 * Show tool execution in the UI as a chat message
	 */
	public async showToolExecution(toolName: string, parameters: any, executionId?: string): Promise<void> {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}
		
		// Create collapsible tool message
		const toolMessage = this.chatContainer.createDiv({ 
			cls: 'gemini-agent-message gemini-agent-message-tool'
		});
		
		const toolContent = toolMessage.createDiv({ cls: 'gemini-agent-tool-message' });
		
		// Header with toggle
		const header = toolContent.createDiv({ cls: 'gemini-agent-tool-header' });
		
		const toggle = header.createEl('button', { cls: 'gemini-agent-tool-toggle' });
		setIcon(toggle, 'chevron-right');
		
		const icon = header.createSpan({ cls: 'gemini-agent-tool-icon' });
		// Use tool-specific icons
		const toolIcons: Record<string, string> = {
			'read_file': 'file-text',
			'write_file': 'file-edit',
			'list_files': 'folder-open',
			'create_folder': 'folder-plus',
			'delete_file': 'trash-2',
			'move_file': 'file-symlink',
			'search_files': 'search',
			'google_search': 'globe'
		};
		setIcon(icon, toolIcons[toolName] || 'wrench');
		
		// Get display name for tool
		const tool = this.plugin.toolRegistry.getTool(toolName);
		const displayName = tool?.displayName || toolName;
		
		header.createSpan({ 
			text: `Executing: ${displayName}`,
			cls: 'gemini-agent-tool-title'
		});
		
		const status = header.createSpan({ 
			text: 'Running...',
			cls: 'gemini-agent-tool-status gemini-agent-tool-status-running'
		});
		
		// Details (hidden by default)
		const details = toolContent.createDiv({ cls: 'gemini-agent-tool-details' });
		details.style.display = 'none';
		
		// Parameters section
		if (parameters && Object.keys(parameters).length > 0) {
			const paramsSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			paramsSection.createEl('h4', { text: 'Parameters' });
			
			const paramsList = paramsSection.createDiv({ cls: 'gemini-agent-tool-params-list' });
			for (const [key, value] of Object.entries(parameters)) {
				const paramItem = paramsList.createDiv({ cls: 'gemini-agent-tool-param-item' });
				paramItem.createSpan({ 
					text: key,
					cls: 'gemini-agent-tool-param-key' 
				});
				
				const valueStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
				const valueEl = paramItem.createEl('code', { 
					text: valueStr,
					cls: 'gemini-agent-tool-param-value' 
				});
				
				// Truncate long values
				if (valueStr.length > 100) {
					valueEl.textContent = valueStr.substring(0, 100) + '...';
					valueEl.title = valueStr; // Show full value on hover
				}
			}
		}
		
		// Toggle functionality
		let isExpanded = false;
		const toggleDetails = () => {
			isExpanded = !isExpanded;
			details.style.display = isExpanded ? 'block' : 'none';
			setIcon(toggle, isExpanded ? 'chevron-down' : 'chevron-right');
			toolContent.toggleClass('gemini-agent-tool-expanded', isExpanded);
		};
		
		// Make both toggle button and header clickable
		toggle.addEventListener('click', (e) => {
			e.stopPropagation();
			toggleDetails();
		});
		header.addEventListener('click', toggleDetails);
		
		// Store reference to update with result
		toolMessage.dataset.toolName = toolName;
		if (executionId) {
			toolMessage.dataset.executionId = executionId;
		}
		
		// Auto-scroll to new message
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Show tool execution result in the UI as a chat message
	 */
	public async showToolResult(toolName: string, result: any, executionId?: string): Promise<void> {
		// Find the existing tool message
		const toolMessages = this.chatContainer.querySelectorAll('.gemini-agent-message-tool');
		let toolMessage: HTMLElement | null = null;
		
		if (executionId) {
			// Use execution ID for precise matching
			for (const msg of Array.from(toolMessages)) {
				if ((msg as HTMLElement).dataset.executionId === executionId) {
					toolMessage = msg as HTMLElement;
					break;
				}
			}
		} else {
			// Fallback to tool name (for backward compatibility)
			for (const msg of Array.from(toolMessages)) {
				if ((msg as HTMLElement).dataset.toolName === toolName) {
					toolMessage = msg as HTMLElement;
					break;
				}
			}
		}
		
		if (!toolMessage) {
			this.plugin.logger.warn(`Tool message not found for ${toolName}`);
			return;
		}
		
		// Update status
		const statusEl = toolMessage.querySelector('.gemini-agent-tool-status') as HTMLElement;
		if (statusEl) {
			statusEl.textContent = result.success ? 'Completed' : 'Failed';
			statusEl.classList.remove('gemini-agent-tool-status-running');
			statusEl.classList.add(result.success ? 'gemini-agent-tool-status-success' : 'gemini-agent-tool-status-error');
			
			// Add completion animation
			toolMessage.classList.add('gemini-agent-tool-completed');
			setTimeout(() => {
				if (toolMessage) {
					toolMessage.classList.remove('gemini-agent-tool-completed');
				}
			}, 500);
		}
		
		// Update icon
		const iconEl = toolMessage.querySelector('.gemini-agent-tool-icon') as HTMLElement;
		if (iconEl) {
			setIcon(iconEl, result.success ? 'check-circle' : 'x-circle');
		}
		
		// Add result to details
		const details = toolMessage.querySelector('.gemini-agent-tool-details');
		if (details) {
			// Add result section
			const resultSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			resultSection.createEl('h4', { text: 'Result' });

			// Always show error first if the tool failed
			if (!result.success) {
				const errorContent = resultSection.createDiv({ cls: 'gemini-agent-tool-error-content' });
				const errorMessage = result.error || 'Tool execution failed (no error message provided)';
				errorContent.createEl('p', {
					text: errorMessage,
					cls: 'gemini-agent-tool-error-message'
				});
			} else if (result.data) {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });

				// Handle different types of results
				if (typeof result.data === 'string') {
					// For string results (like file content)
					if (result.data.length > 500) {
						// Large content - show in a code block with truncation
						const codeBlock = resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
						const code = codeBlock.createEl('code');
						code.textContent = result.data.substring(0, 500) + '\n\n... (truncated)';

						// Add button to expand full content
						const expandBtn = resultContent.createEl('button', {
							text: 'Show full content',
							cls: 'gemini-agent-tool-expand-content'
						});
						expandBtn.addEventListener('click', () => {
							code.textContent = result.data;
							expandBtn.remove();
						});
					} else {
						resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
							.createEl('code', { text: result.data });
					}
				} else if (Array.isArray(result.data)) {
					// For arrays (like file lists)
					if (result.data.length === 0) {
						resultContent.createEl('p', {
							text: 'No results found',
							cls: 'gemini-agent-tool-empty-result'
						});
					} else {
						const list = resultContent.createEl('ul', { cls: 'gemini-agent-tool-result-list' });
						result.data.slice(0, 10).forEach((item: any) => {
							list.createEl('li', { text: String(item) });
						});
						if (result.data.length > 10) {
							resultContent.createEl('p', {
								text: `... and ${result.data.length - 10} more`,
								cls: 'gemini-agent-tool-more-items'
							});
						}
					}
				} else if (typeof result.data === 'object') {
					// Debug logging
					this.plugin.logger.log('Tool result is object for:', toolName);
					this.plugin.logger.log('Result data keys:', Object.keys(result.data));

					// Special handling for google_search results with citations
					if (result.data.answer && result.data.citations && toolName === 'google_search') {
						this.plugin.logger.log('Handling google_search result with citations');
						// Display the answer
						const answerDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-search-answer' });
						answerDiv.createEl('h5', { text: 'Answer:' });

						// Render the answer with markdown links
						const answerPara = answerDiv.createEl('p');
						// Parse markdown links in the answer
						const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
						let lastIndex = 0;
						let match;

						while ((match = linkRegex.exec(result.data.answer)) !== null) {
							// Add text before the link
							if (match.index > lastIndex) {
								answerPara.appendText(result.data.answer.substring(lastIndex, match.index));
							}

							// Add the link
							const link = answerPara.createEl('a', {
								text: match[1],
								href: match[2]
							});
							link.setAttribute('target', '_blank');

							lastIndex = linkRegex.lastIndex;
						}

						// Add any remaining text
						if (lastIndex < result.data.answer.length) {
							answerPara.appendText(result.data.answer.substring(lastIndex));
						}

						// Display citations if available
						if (result.data.citations.length > 0) {
							const citationsDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-citations' });
							citationsDiv.createEl('h5', { text: 'Sources:' });

							const citationsList = citationsDiv.createEl('ul', { cls: 'gemini-agent-tool-citations-list' });
							for (const citation of result.data.citations) {
								const citationItem = citationsList.createEl('li');
								const link = citationItem.createEl('a', {
									text: citation.title || citation.url,
									href: citation.url,
									cls: 'gemini-agent-tool-citation-link'
								});
								link.setAttribute('target', '_blank');

								if (citation.snippet) {
									citationItem.createEl('p', {
										text: citation.snippet,
										cls: 'gemini-agent-tool-citation-snippet'
									});
								}
							}
						}
					// Special handling for generate_image results
					} else if (result.data.path && result.data.wikilink && toolName === 'generate_image') {
						// Display the generated image
						const imageDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-image-result' });
						imageDiv.createEl('h5', { text: 'Generated Image:' });

						// Get the image file from vault
						const imageFile = this.plugin.app.vault.getAbstractFileByPath(result.data.path);
						if (imageFile instanceof TFile) {
							// Create image element
							const imgContainer = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-container' });
							const img = imgContainer.createEl('img', {
								cls: 'gemini-agent-tool-image'
							});

							// Add loading states and error handling
							img.onloadstart = () => imgContainer.addClass('loading');
							img.onload = () => imgContainer.removeClass('loading');
							img.onerror = () => {
								img.style.display = 'none';
								imgContainer.removeClass('loading');
								imgContainer.createEl('p', {
									text: 'Failed to load image preview',
									cls: 'gemini-agent-tool-image-error'
								});
							};

							// Get the image URL from Obsidian's resource path
							try {
								img.src = this.plugin.app.vault.getResourcePath(imageFile);
								img.alt = result.data.prompt || 'Generated image';
							} catch (error) {
								this.plugin.logger.error('Failed to get resource path for image:', error);
								img.onerror?.(new Event('error'));
							}

							// Add image info
							const imageInfo = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-info' });
							imageInfo.createEl('strong', { text: 'Path: ' });
							imageInfo.createSpan({ text: result.data.path });

							// Add wikilink for easy copying
							imageInfo.createEl('br');
							imageInfo.createEl('strong', { text: 'Wikilink: ' });
							const wikilinkCode = imageInfo.createEl('code', {
								text: result.data.wikilink,
								cls: 'gemini-agent-tool-wikilink'
							});

							// Add copy button for wikilink
							const copyBtn = imageInfo.createEl('button', {
								text: 'Copy',
								cls: 'gemini-agent-tool-copy-wikilink'
							});
							copyBtn.addEventListener('click', () => {
								navigator.clipboard.writeText(result.data.wikilink).then(() => {
									copyBtn.textContent = 'Copied!';
									setTimeout(() => {
										copyBtn.textContent = 'Copy';
									}, 2000);
								});
							});
						} else {
							imageDiv.createEl('p', {
								text: `Image saved to: ${result.data.path}`,
								cls: 'gemini-agent-tool-image-path'
							});
						}
					// Special handling for read_file results
					} else if (result.data.content && result.data.path) {
						// This is a file read result
						const fileInfo = resultContent.createDiv({ cls: 'gemini-agent-tool-file-info' });
						fileInfo.createEl('strong', { text: 'File: ' });
						fileInfo.createSpan({ text: result.data.path });

						if (result.data.size) {
							fileInfo.createSpan({
								text: ` (${this.formatFileSize(result.data.size)})`,
								cls: 'gemini-agent-tool-file-size'
							});
						}

						const content = result.data.content;
						if (content.length > 500) {
							// Large content - show in a code block with truncation
							const codeBlock = resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
							const code = codeBlock.createEl('code');
							code.textContent = content.substring(0, 500) + '\n\n... (truncated)';

							// Add button to expand full content
							const expandBtn = resultContent.createEl('button', {
								text: 'Show full content',
								cls: 'gemini-agent-tool-expand-content'
							});
							expandBtn.addEventListener('click', () => {
								code.textContent = content;
								expandBtn.remove();
							});
						} else {
							resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
								.createEl('code', { text: content });
						}
					} else {
						// For other objects, show key-value pairs
						const resultList = resultContent.createDiv({ cls: 'gemini-agent-tool-result-object' });
						for (const [key, value] of Object.entries(result.data)) {
							// Skip undefined/null values
							if (value === undefined || value === null) {
								continue;
							}

							if (key === 'content' && typeof value === 'string' && value.length > 100) {
								// Skip long content in generic display
								continue;
							}

							const item = resultList.createDiv({ cls: 'gemini-agent-tool-result-item' });
							item.createSpan({
								text: key + ':',
								cls: 'gemini-agent-tool-result-key'
							});

							const valueStr = typeof value === 'string' ? value : JSON.stringify(value) || String(value);
							item.createSpan({
								text: valueStr.length > 100 ? valueStr.substring(0, 100) + '...' : valueStr,
								cls: 'gemini-agent-tool-result-value'
							});
						}
					}
				}
			} else {
				// Success but no data - show a generic success message
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });
				resultContent.createEl('p', {
					text: 'Operation completed successfully',
					cls: 'gemini-agent-tool-success-message'
				});
			}
		}
		
		// Auto-expand if there was an error
		if (!result.success) {
			const toggle = toolMessage.querySelector('.gemini-agent-tool-toggle') as HTMLElement;
			const toolContent = toolMessage.querySelector('.gemini-agent-tool-message');
			if (toggle && details && toolContent) {
				setIcon(toggle, 'chevron-down');
				(details as HTMLElement).style.display = 'block';
				toolContent.classList.add('gemini-agent-tool-expanded');
			}
		}
	}
	
	private async showEmptyState() {
		if (this.chatContainer.children.length === 0) {
			const emptyState = this.chatContainer.createDiv({ cls: 'gemini-agent-empty-chat' });

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
					await this.showEmptyState();
				}
			});

			// Try to get recent sessions (excluding the current session)
			// Fetch 6 sessions since we might filter out the current one
			const allRecentSessions = await this.plugin.sessionManager.getRecentAgentSessions(6);
			const recentSessions = allRecentSessions
				.filter(session => !this.isCurrentSession(session))
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
						await this.loadSession(session);
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
					this.userInput.textContent = example.text;
					this.userInput.focus();
				});
			});
		}
	}
	
	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	/**
	 * Check if a tool is allowed without confirmation for this session
	 */
	isToolAllowedWithoutConfirmation(toolName: string): boolean {
		return this.allowedWithoutConfirmation.has(toolName);
	}

	/**
	 * Add a tool to the allowed list for this session
	 */
	allowToolWithoutConfirmation(toolName: string) {
		this.allowedWithoutConfirmation.add(toolName);
	}

	/**
	 * Scroll chat to bottom
	 */
	private scrollToBottom() {
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Debounced scroll to bottom for streaming
	 */
	private debouncedScrollToBottom() {
		// Clear existing timeout
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
		}

		// Set a new timeout to scroll after a brief delay
		this.scrollTimeout = setTimeout(() => {
			this.scrollToBottom();
			this.scrollTimeout = null;
		}, 50); // 50ms debounce
	}

	/**
	 * Create empty message container for streaming
	 */
	private createStreamingMessageContainer(role: 'user' | 'model' | 'system' = 'model'): HTMLElement {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}
		
		const messageDiv = this.chatContainer.createDiv({ 
			cls: `gemini-agent-message gemini-agent-message-${role}`
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', { 
			text: role === 'user' ? 'You' : role === 'system' ? 'System' : 'Agent',
			cls: 'gemini-agent-message-role'
		});
		header.createEl('span', { 
			text: new Date().toLocaleTimeString(),
			cls: 'gemini-agent-message-time'
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });
		
		return messageDiv;
	}

	/**
	 * Update streaming message with new chunk
	 */
	private async updateStreamingMessage(messageContainer: HTMLElement, newChunk: string): Promise<void> {
		const messageDiv = messageContainer.querySelector('.gemini-agent-message-content') as HTMLElement;
		if (messageDiv) {
			// For streaming, append the new chunk as plain text to avoid re-rendering
			// We'll do a final markdown render when streaming completes
			const textNode = document.createTextNode(newChunk);
			messageDiv.appendChild(textNode);
		}
	}

	/**
	 * Finalize streaming message with full markdown
	 */
	private async finalizeStreamingMessage(messageContainer: HTMLElement, fullMarkdown: string, entry: GeminiConversationEntry): Promise<void> {
		const messageDiv = messageContainer.querySelector('.gemini-agent-message-content') as HTMLElement;
		if (messageDiv) {
			// Clear the div and render the final markdown
			messageDiv.empty();
			
			// Apply the same formatting logic as displayMessage
			let formattedMessage = fullMarkdown;
			if (entry.role === 'model') {
				// Apply the same formatting for tables and paragraphs
				const lines = fullMarkdown.split('\n');
				const formattedLines: string[] = [];
				let inTable = false;
				let previousLineWasEmpty = true;

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					const trimmedLine = line.trim();
					const hasUnescapedPipe = /(?<!\\)\|/.test(line);
					const nextLine = lines[i + 1];
					
					// Check if we're starting a table
					if (hasUnescapedPipe && !inTable) {
						inTable = true;
						// Add empty line before table if not already present
						if (!previousLineWasEmpty) {
							formattedLines.push('');
						}
					}
					
					// Add the current line
					formattedLines.push(line);
					
					// Check if we're ending a table
					if (inTable && !hasUnescapedPipe && trimmedLine !== '') {
						inTable = false;
						// Add empty line after table
						formattedLines.push('');
					} else if (inTable && trimmedLine === '') {
						// Empty line also ends a table
						inTable = false;
					}
					
					// For non-table content, add empty line between paragraphs
					if (!inTable && !hasUnescapedPipe && trimmedLine !== '' && 
						nextLine && nextLine.trim() !== '' && !nextLine.includes('|')) {
						formattedLines.push('');
					}
					
					previousLineWasEmpty = trimmedLine === '';
				}
				
				formattedMessage = formattedLines.join('\n');
			}
			
			const sourcePath = this.currentSession?.historyPath || '';
			await MarkdownRenderer.render(this.app, formattedMessage, messageDiv, sourcePath, this);
			
			// Add a copy button for model messages
			if (entry.role === 'model') {
				const copyButton = messageDiv.createEl('button', {
					cls: 'gemini-agent-copy-button',
				});
				setIcon(copyButton, 'copy');

				copyButton.addEventListener('click', () => {
					// Use the original message text to preserve formatting
					navigator.clipboard
						.writeText(entry.message)
						.then(() => {
							new Notice('Message copied to clipboard.');
						})
						.catch((err) => {
							new Notice('Could not copy message to clipboard. Try selecting and copying manually.');
							this.plugin.logger.error('Failed to copy to clipboard', err);
						});
				});
			}
		}
	}
}