import { App, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import type ObsidianGemini from '../../main';
import { formatModelMessage } from '../../utils/markdown-formatting';
import { stripTurnPreamble } from '../../utils/turn-preamble';
import { Tool, DiffContext, ConfirmationResult } from '../../tools/types';

// Documentation and help content
const DOCS_BASE_URL = 'https://allenhutchison.github.io/obsidian-gemini';
const AGENT_MODE_GUIDE_URL = `${DOCS_BASE_URL}/guide/agent-mode`;

const AGENT_CAPABILITIES = [
	{ icon: 'search', text: 'Search and read files in your vault' },
	{ icon: 'file-edit', text: 'Create, modify, and organize notes' },
	{ icon: 'globe', text: 'Search the web and fetch information' },
	{ icon: 'workflow', text: 'Execute multi-step tasks autonomously' },
] as const;

const DEFAULT_EXAMPLE_PROMPTS = [
	{ icon: 'search', text: 'Find all notes tagged with #important' },
	{ icon: 'file-plus', text: 'Create a weekly summary of my meeting notes' },
	{ icon: 'globe', text: 'Research productivity methods and create notes' },
	{ icon: 'folder-tree', text: 'Organize my research notes by topic' },
] as const;

/**
 * Callback for loading a session
 */
export type LoadSessionCallback = (session: ChatSession) => Promise<void>;

/**
 * Handles message display and streaming functionality for Agent View
 */
export class AgentViewMessages {
	private app: App;
	private chatContainer: HTMLElement;
	private plugin: ObsidianGemini;
	private userInput: HTMLDivElement;
	private scrollTimeout: number | null = null;
	private autoOpenDiffTimeout: number | null = null;
	private pendingConfirmations = new Set<(result: ConfirmationResult) => void>();
	private viewContext: any; // For MarkdownRenderer context

	constructor(
		app: App,
		chatContainer: HTMLElement,
		plugin: ObsidianGemini,
		userInput: HTMLDivElement,
		viewContext: any
	) {
		this.app = app;
		this.chatContainer = chatContainer;
		this.plugin = plugin;
		this.userInput = userInput;
		this.viewContext = viewContext;
	}

	/**
	 * Load example prompts from example-prompts.json or fall back to defaults
	 */
	private async loadExamplePrompts(): Promise<Array<{ icon: string; text: string }>> {
		try {
			const prompts = await this.plugin.examplePrompts.read();
			if (prompts && prompts.length > 0) {
				return prompts;
			}

			// Fall back to defaults if no prompts or empty array
			return [...DEFAULT_EXAMPLE_PROMPTS];
		} catch (error) {
			this.plugin.logger.warn('Failed to load example prompts, using defaults:', error);
			return [...DEFAULT_EXAMPLE_PROMPTS];
		}
	}

	/**
	 * Display a conversation entry as a message
	 */
	async displayMessage(entry: GeminiConversationEntry, currentSession: ChatSession | null) {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}

		const messageDiv = this.chatContainer.createDiv({
			cls: `gemini-agent-message gemini-agent-message-${entry.role}`,
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', {
			text: entry.role === 'user' ? 'You' : entry.role === 'system' ? 'System' : 'Agent',
			cls: 'gemini-agent-message-role',
		});
		header.createEl('span', {
			text: entry.created_at.toLocaleTimeString(),
			cls: 'gemini-agent-message-time',
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });

		// User turns carry a time preamble for the model; strip it for UI/copy.
		const renderMessage = entry.role === 'user' ? stripTurnPreamble(entry.message) : entry.message;

		// Check if this is a tool execution message from history
		const isToolExecution = entry.metadata?.toolName || renderMessage.includes('Tool Execution Results:');

		// Convert single newlines to double newlines for proper markdown rendering
		// while preserving table formatting
		let formattedMessage = renderMessage;
		if (entry.role === 'model') {
			formattedMessage = formatModelMessage(renderMessage);

			// Debug logging for table formatting
			if (formattedMessage.includes('|')) {
				this.plugin.logger.log('Table formatting debug:');
				this.plugin.logger.log('Original message:', renderMessage);
				this.plugin.logger.log('Formatted message:', formattedMessage);
			}
		}

		// Get source path for proper link resolution
		const sourcePath = currentSession?.historyPath || '';

		// Special handling for tool execution messages
		if (isToolExecution && renderMessage.includes('Tool Execution Results:')) {
			// Extract tool execution sections and make them collapsible
			const toolSections = formattedMessage.split(/### ([^\n]+)/);

			if (toolSections.length > 1) {
				// First part before any tool sections
				const intro = toolSections[0].trim();
				if (intro) {
					const introDiv = content.createDiv();
					await MarkdownRenderer.render(this.app, intro, introDiv, sourcePath, this.viewContext);
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
							cls: 'gemini-agent-tool-name',
						});

						// Tool status (if available)
						if (toolContent.includes('✅')) {
							toolHeader.createEl('span', {
								text: 'Success',
								cls: 'gemini-agent-tool-status gemini-agent-tool-status-success',
							});
						} else if (toolContent.includes('❌')) {
							toolHeader.createEl('span', {
								text: 'Failed',
								cls: 'gemini-agent-tool-status gemini-agent-tool-status-error',
							});
						}

						// Tool content (initially hidden)
						const toolContentDiv = toolDiv.createDiv({
							cls: 'gemini-agent-tool-content gemini-agent-tool-content-collapsed',
						});

						// Render the tool content
						await MarkdownRenderer.render(this.app, toolContent, toolContentDiv, sourcePath, this.viewContext);

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
				await MarkdownRenderer.render(this.app, formattedMessage, content, sourcePath, this.viewContext);
			}
		} else {
			// Use markdown rendering like the regular chat view
			await MarkdownRenderer.render(this.app, formattedMessage, content, sourcePath, this.viewContext);
		}

		// Scroll to bottom after displaying message
		this.scrollToBottom();

		// Setup image click handlers
		this.setupImageClickHandlers(content, sourcePath);

		// Add a copy button for both user and model messages
		if (entry.role === 'model' || entry.role === 'user') {
			const copyButton = content.createEl('button', {
				cls: 'gemini-agent-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Copy the user-visible text (preamble stripped for user turns)
				navigator.clipboard
					.writeText(renderMessage)
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

	/**
	 * Create empty message container for streaming
	 */
	createStreamingMessageContainer(role: 'user' | 'model' | 'system' = 'model'): HTMLElement {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}

		const messageDiv = this.chatContainer.createDiv({
			cls: `gemini-agent-message gemini-agent-message-${role}`,
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', {
			text: role === 'user' ? 'You' : role === 'system' ? 'System' : 'Agent',
			cls: 'gemini-agent-message-role',
		});
		header.createEl('span', {
			text: new Date().toLocaleTimeString(),
			cls: 'gemini-agent-message-time',
		});

		messageDiv.createDiv({ cls: 'gemini-agent-message-content' });

		return messageDiv;
	}

	/**
	 * Update streaming message with new chunk
	 */
	async updateStreamingMessage(messageContainer: HTMLElement, newChunk: string): Promise<void> {
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
	async finalizeStreamingMessage(
		messageContainer: HTMLElement,
		fullMarkdown: string,
		entry: GeminiConversationEntry,
		currentSession: ChatSession | null
	): Promise<void> {
		const messageDiv = messageContainer.querySelector('.gemini-agent-message-content') as HTMLElement;
		if (messageDiv) {
			// Clear the div and render the final markdown
			messageDiv.empty();

			// Apply the same formatting logic as displayMessage
			let formattedMessage = fullMarkdown;
			if (entry.role === 'model') {
				formattedMessage = formatModelMessage(fullMarkdown);
			}

			const sourcePath = currentSession?.historyPath || '';
			await MarkdownRenderer.render(this.app, formattedMessage, messageDiv, sourcePath, this.viewContext);

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

			// Setup image click handlers
			this.setupImageClickHandlers(messageDiv, sourcePath);
		}
	}

	/**
	 * Setup click handlers for images to open them in preview
	 */
	private setupImageClickHandlers(container: HTMLElement, sourcePath: string): void {
		const images = container.findAll('img');
		for (const img of images) {
			img.addClass('gemini-agent-clickable-image');
			img.addEventListener('click', async (e) => {
				e.stopPropagation();

				// Try to get file path from alt text (standard Obsidian behavior)
				const altText = img.getAttribute('alt');
				if (altText) {
					const file = this.app.metadataCache.getFirstLinkpathDest(altText, sourcePath);
					if (file) {
						const leaf = this.app.workspace.getLeaf('tab');
						await leaf.openFile(file);
					}
				}
			});
		}
	}

	/**
	 * Scroll chat to bottom
	 */
	scrollToBottom() {
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Debounced scroll to bottom for streaming
	 */
	debouncedScrollToBottom() {
		// Clear existing timeout
		if (this.scrollTimeout) {
			window.clearTimeout(this.scrollTimeout);
		}

		// Set a new timeout to scroll after a brief delay
		this.scrollTimeout = window.setTimeout(() => {
			this.scrollToBottom();
			this.scrollTimeout = null;
		}, 50); // 50ms debounce
	}

	/**
	 * Show empty state when no messages exist
	 */
	async showEmptyState(
		currentSession: ChatSession | null,
		onLoadSession: LoadSessionCallback,
		onSendMessage: () => Promise<void>
	) {
		// Remove existing empty state if it exists (to support refreshing after AGENTS.md update)
		const existingEmptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (existingEmptyState) {
			existingEmptyState.remove();
		}

		if (this.chatContainer.children.length === 0) {
			const emptyState = this.chatContainer.createDiv({ cls: 'gemini-agent-empty-chat' });

			const icon = emptyState.createDiv({ cls: 'gemini-agent-empty-icon' });
			setIcon(icon, 'sparkles');

			emptyState.createEl('h3', {
				text: 'Start a conversation',
				cls: 'gemini-agent-empty-title',
			});

			emptyState.createEl('p', {
				text: 'Your AI assistant that can actively work with your vault.',
				cls: 'gemini-agent-empty-desc',
			});

			// What can the agent do section
			const capabilities = emptyState.createDiv({ cls: 'gemini-agent-capabilities' });

			capabilities.createEl('h4', {
				text: 'What can the Agent do?',
				cls: 'gemini-agent-capabilities-title',
			});

			const capList = capabilities.createEl('ul', { cls: 'gemini-agent-capabilities-list' });

			AGENT_CAPABILITIES.forEach((item) => {
				const li = capList.createEl('li', { cls: 'gemini-agent-capability-item' });
				const iconEl = li.createSpan({ cls: 'gemini-agent-capability-icon' });
				setIcon(iconEl, item.icon);
				li.createSpan({ text: item.text, cls: 'gemini-agent-capability-text' });
			});

			// Documentation link
			const docsLink = capabilities.createDiv({ cls: 'gemini-agent-docs-link' });
			const linkEl = docsLink.createEl('a', {
				text: '📖 Learn more about Agent Mode',
				cls: 'gemini-agent-docs-link-text',
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
					: 'gemini-agent-init-context-button',
			});

			const buttonIcon = initButton.createDiv({ cls: 'gemini-agent-init-icon' });
			setIcon(buttonIcon, agentsMemoryExists ? 'refresh-cw' : 'sparkles');

			const buttonText = initButton.createDiv({ cls: 'gemini-agent-init-text' });

			if (agentsMemoryExists) {
				buttonText.createEl('strong', { text: 'Update Vault Context' });
				buttonText.createEl('span', {
					text: 'Refresh my understanding of your vault',
					cls: 'gemini-agent-init-desc',
				});
			} else {
				buttonText.createEl('strong', { text: 'Initialize Vault Context' });
				buttonText.createEl('span', {
					text: 'Help me understand your vault structure and organization',
					cls: 'gemini-agent-init-desc',
				});
			}

			initButton.addEventListener('click', async () => {
				// Run the vault analyzer
				if (this.plugin.vaultAnalyzer) {
					await this.plugin.vaultAnalyzer.initializeAgentsMemory();
					// Refresh the empty state to update the button
					await this.showEmptyState(currentSession, onLoadSession, onSendMessage);
				}
			});

			// Try to get recent sessions (excluding the current session)
			// Fetch 6 sessions since we might filter out the current one
			const allRecentSessions = await this.plugin.sessionManager.getRecentAgentSessions(6);
			const recentSessions = allRecentSessions
				.filter((session) => !this.isCurrentSession(session, currentSession))
				.slice(0, 5); // Limit to 5 after filtering

			if (recentSessions.length > 0) {
				// Show recent sessions
				emptyState.createEl('p', {
					text: 'Recent sessions:',
					cls: 'gemini-agent-suggestions-header',
				});

				const sessionsContainer = emptyState.createDiv({ cls: 'gemini-agent-suggestions' });

				recentSessions.forEach((session) => {
					const suggestion = sessionsContainer.createDiv({
						cls: 'gemini-agent-suggestion gemini-agent-suggestion-session',
					});

					suggestion.createEl('span', {
						text: session.title,
						cls: 'gemini-agent-suggestion-title',
					});

					suggestion.createEl('span', {
						text: new Date(session.lastActive).toLocaleDateString(),
						cls: 'gemini-agent-suggestion-date',
					});

					suggestion.addEventListener('click', async () => {
						await onLoadSession(session);
					});
				});
			}

			// Always show example prompts (load from AGENTS.md or use defaults)
			const examplePrompts = await this.loadExamplePrompts();

			emptyState.createEl('p', {
				text: 'Try these examples:',
				cls: 'gemini-agent-suggestions-header',
			});

			const examplesContainer = emptyState.createDiv({ cls: 'gemini-agent-suggestions gemini-agent-examples' });

			examplePrompts.forEach((example) => {
				const suggestion = examplesContainer.createDiv({
					cls: 'gemini-agent-suggestion gemini-agent-suggestion-example',
				});

				const iconEl = suggestion.createSpan({ cls: 'gemini-agent-example-icon' });
				setIcon(iconEl, example.icon);

				suggestion.createSpan({
					text: example.text,
					cls: 'gemini-agent-example-text',
				});

				suggestion.addEventListener('click', async () => {
					this.userInput.textContent = example.text;
					await onSendMessage();
				});
			});
		}
	}

	/**
	 * Check if a session is the current session
	 * Compares both session ID and history path for robustness
	 */
	private isCurrentSession(session: ChatSession, currentSession: ChatSession | null): boolean {
		if (!currentSession) return false;
		return session.id === currentSession.id || session.historyPath === currentSession.historyPath;
	}

	/**
	 * Display a confirmation request message with interactive buttons
	 * Returns a Promise that resolves when user clicks a button
	 */
	public async displayConfirmationRequest(
		tool: Tool,
		parameters: any,
		executionId: string,
		diffContext?: DiffContext
	): Promise<ConfirmationResult> {
		return new Promise((resolve) => {
			this.pendingConfirmations.add(resolve);
			let resolved = false; // Prevent double-resolution race condition
			let diffViewOpen = false; // Track whether the diff view is currently open
			let activeDiffView: import('./gemini-diff-view').GeminiDiffView | null = null; // Reference to the open diff view

			// Create system message container
			const messageDiv = this.chatContainer.createDiv({
				cls: 'gemini-agent-message gemini-agent-message-system gemini-agent-confirmation-request',
			});

			// Add header
			const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
			header.createEl('span', { text: 'Permission Required', cls: 'gemini-agent-message-role' });
			header.createEl('span', {
				text: new Date().toLocaleTimeString(),
				cls: 'gemini-agent-message-time',
			});

			// Create confirmation card
			const card = messageDiv.createDiv({ cls: 'gemini-agent-confirmation-card' });

			// Tool info section
			const toolInfo = card.createDiv({ cls: 'gemini-agent-tool-info' });

			const toolHeader = toolInfo.createDiv({ cls: 'gemini-agent-tool-info-header' });
			const iconContainer = toolHeader.createDiv({ cls: 'gemini-agent-confirmation-tool-icon' });
			this.setToolIcon(iconContainer, tool.name);

			toolHeader.createEl('span', {
				text: tool.displayName || tool.name,
				cls: 'gemini-agent-tool-name',
			});

			toolHeader.createEl('span', {
				text: this.getCategoryLabel(tool.category),
				cls: 'gemini-agent-tool-category',
			});

			// Tool description
			toolInfo.createEl('p', {
				text: tool.description,
				cls: 'gemini-agent-tool-description',
			});

			// Parameters section
			if (parameters && Object.keys(parameters).length > 0) {
				const paramsSection = card.createDiv({ cls: 'gemini-agent-params-section' });
				paramsSection.createEl('div', { text: 'Parameters:', cls: 'gemini-agent-params-header' });

				const paramsList = paramsSection.createDiv({ cls: 'gemini-agent-params-list' });
				for (const [key, value] of Object.entries(parameters)) {
					const paramItem = paramsList.createDiv({ cls: 'gemini-agent-param-item' });
					paramItem.createEl('strong', { text: `${key}: ` });

					const valueStr = this.formatParameterValue(value);
					paramItem.createEl('code', { text: valueStr });
				}
			}

			// Custom confirmation message
			if (tool.confirmationMessage) {
				try {
					const customMsg = card.createDiv({ cls: 'gemini-agent-confirmation-message' });
					customMsg.createEl('p', { text: tool.confirmationMessage(parameters) });
				} catch (error) {
					this.plugin.logger?.warn(`Error generating confirmation message for tool ${tool.name}:`, error);
					// Continue without custom message - other parts of UI still work
				}
			}

			// Action buttons container
			const buttonsContainer = messageDiv.createDiv({ cls: 'gemini-agent-confirmation-buttons' });

			// Allow button
			const allowBtn = buttonsContainer.createEl('button', {
				cls: 'gemini-agent-confirmation-btn gemini-agent-confirmation-btn-confirm mod-cta',
			});
			const allowIcon = allowBtn.createSpan({ cls: 'gemini-agent-confirmation-btn-icon' });
			setIcon(allowIcon, 'check');
			allowBtn.createSpan({ text: 'Allow' });

			// Cancel button
			const cancelBtn = buttonsContainer.createEl('button', {
				cls: 'gemini-agent-confirmation-btn gemini-agent-confirmation-btn-cancel',
			});
			const cancelIcon = cancelBtn.createSpan({ cls: 'gemini-agent-confirmation-btn-icon' });
			setIcon(cancelIcon, 'x');
			cancelBtn.createSpan({ text: 'Cancel' });

			// "Don't ask again" checkbox
			const checkboxContainer = buttonsContainer.createDiv({
				cls: 'gemini-agent-confirmation-checkbox',
			});
			const checkboxId = `allow-without-confirmation-${executionId}`;
			const checkbox = checkboxContainer.createEl('input', {
				type: 'checkbox',
				cls: 'gemini-agent-checkbox-input',
				attr: { id: checkboxId },
			});
			checkboxContainer.createEl('label', {
				text: "Don't ask again this session",
				cls: 'gemini-agent-checkbox-label',
				attr: { for: checkboxId },
			});

			// "View Changes" button for write_file
			if (diffContext) {
				const viewChangesBtn = buttonsContainer.createEl('button', {
					cls: 'gemini-agent-confirmation-btn gemini-agent-confirmation-btn-diff',
				});
				const diffIcon = viewChangesBtn.createSpan({ cls: 'gemini-agent-confirmation-btn-icon' });
				setIcon(diffIcon, diffContext.isNewFile ? 'file-text' : 'file-diff');
				viewChangesBtn.createSpan({ text: diffContext.isNewFile ? 'Preview File' : 'View Changes' });

				viewChangesBtn.addEventListener('click', async () => {
					await this.openDiffView(
						diffContext,
						handleResponse,
						(view) => {
							diffViewOpen = true;
							activeDiffView = view;
						},
						() => {
							diffViewOpen = false;
							activeDiffView = null;
						}
					);
				});
			}

			// Button handlers
			const handleResponse = (confirmed: boolean, finalContent?: string, userEdited?: boolean) => {
				if (resolved) return;
				resolved = true;
				this.pendingConfirmations.delete(resolve);

				// Disable buttons to prevent double-click
				allowBtn.disabled = true;
				cancelBtn.disabled = true;

				// Clean up event listeners to prevent memory leak
				allowBtn.removeEventListener('click', allowHandler);
				cancelBtn.removeEventListener('click', cancelHandler);

				// Update message to show result
				this.updateConfirmationResult(messageDiv, confirmed, tool.displayName || tool.name);

				// Resolve Promise
				resolve({
					confirmed,
					allowWithoutConfirmation: checkbox.checked,
					finalContent,
					userEdited: userEdited ?? false,
				});

				// Scroll to show result
				this.debouncedScrollToBottom();
			};

			// Create named handlers so we can remove them later
			const allowHandler = () => {
				// If a diff view is open, get its current (possibly edited) content
				if (diffViewOpen && activeDiffView) {
					const currentContent = activeDiffView.getCurrentContent();
					const originalProposed = diffContext?.proposedContent ?? '';
					const userEdited = currentContent !== originalProposed;
					handleResponse(true, currentContent, userEdited);
					// Close the diff view since the user approved from chat
					activeDiffView.leaf.detach();
				} else {
					handleResponse(true);
				}
			};
			const cancelHandler = () => {
				// If a diff view is open, close it before cancelling
				if (diffViewOpen && activeDiffView) {
					activeDiffView.leaf.detach();
				}
				handleResponse(false);
			};

			allowBtn.addEventListener('click', allowHandler);
			cancelBtn.addEventListener('click', cancelHandler);

			// Auto-open diff view if setting enabled
			// Small delay allows the confirmation card DOM to render before opening the leaf
			if (diffContext && this.plugin.settings.alwaysShowDiffView) {
				if (this.autoOpenDiffTimeout !== null) {
					window.clearTimeout(this.autoOpenDiffTimeout);
				}
				this.autoOpenDiffTimeout = window.setTimeout(() => {
					this.autoOpenDiffTimeout = null;
					this.openDiffView(
						diffContext,
						handleResponse,
						(view) => {
							diffViewOpen = true;
							activeDiffView = view;
						},
						() => {
							diffViewOpen = false;
							activeDiffView = null;
						}
					);
				}, 100);
			}

			// Scroll to show confirmation
			this.debouncedScrollToBottom();
		});
	}

	/**
	 * Open a diff view leaf for reviewing proposed file changes.
	 */
	private async openDiffView(
		diffContext: DiffContext,
		handleResponse: (confirmed: boolean, finalContent?: string, userEdited?: boolean) => void,
		onDiffOpened?: (view: import('./gemini-diff-view').GeminiDiffView) => void,
		onDiffClosed?: () => void
	): Promise<void> {
		// Remember the previously focused leaf so we can restore it when the diff closes
		const previousLeaf = this.plugin.app.workspace.getMostRecentLeaf();
		const leaf = this.plugin.app.workspace.getLeaf('tab');

		const restorePreviousLeaf = () => {
			if (previousLeaf && previousLeaf !== leaf) {
				this.plugin.app.workspace.setActiveLeaf(previousLeaf, { focus: true });
			}
		};

		try {
			const { GeminiDiffView } = await import('./gemini-diff-view');
			const { VIEW_TYPE_DIFF } = await import('../../main');
			await leaf.setViewState({ type: VIEW_TYPE_DIFF, active: true });

			const view = leaf.view;
			if (view instanceof GeminiDiffView) {
				view.setDiffState({
					filePath: diffContext.filePath,
					originalContent: diffContext.originalContent,
					proposedContent: diffContext.proposedContent,
					isNewFile: diffContext.isNewFile,
					onResolve: (result) => {
						restorePreviousLeaf();
						onDiffClosed?.();
						handleResponse(result.approved, result.finalContent, result.userEdited);
					},
					onClose: () => {
						restorePreviousLeaf();
						onDiffClosed?.();
					},
				});
				onDiffOpened?.(view);
			} else {
				this.plugin.logger?.error(
					`[AgentViewMessages] Failed to open diff view for ${diffContext.filePath}: unexpected view type`
				);
				leaf.detach();
				restorePreviousLeaf();
				onDiffClosed?.();
			}
		} catch (error) {
			this.plugin.logger?.error(`[AgentViewMessages] Failed to open diff view for ${diffContext.filePath}:`, error);
			leaf.detach();
			restorePreviousLeaf();
			onDiffClosed?.();
		}
	}

	/**
	 * Update confirmation message after user responds
	 */
	private updateConfirmationResult(messageDiv: HTMLElement, confirmed: boolean, toolName: string) {
		// Remove the card and buttons
		messageDiv.empty();

		// Add result message
		const result = messageDiv.createDiv({ cls: 'gemini-agent-confirmation-result' });

		const icon = result.createSpan({ cls: 'gemini-agent-result-icon' });
		setIcon(icon, confirmed ? 'check-circle' : 'x-circle');

		result.createSpan({
			text: confirmed ? `Permission granted: ${toolName} was allowed` : `Permission denied: ${toolName} was cancelled`,
			cls: 'gemini-agent-result-text',
		});
	}

	/**
	 * Format parameter value for display with proper error handling
	 */
	private formatParameterValue(value: any): string {
		const MAX_LENGTH = 100;

		try {
			// Handle null and undefined
			if (value === null) return 'null';
			if (value === undefined) return 'undefined';

			// Handle functions
			if (typeof value === 'function') return '[Function]';

			// Handle strings
			if (typeof value === 'string') {
				return value.length > MAX_LENGTH ? value.substring(0, MAX_LENGTH) + `... (${value.length} chars)` : value;
			}

			// Try to stringify other values
			const stringified = JSON.stringify(value);

			// Truncate if too long
			if (stringified.length > MAX_LENGTH) {
				return stringified.substring(0, MAX_LENGTH) + `... (${stringified.length} chars)`;
			}

			return stringified;
		} catch (error) {
			// Handle circular references and other serialization errors
			this.plugin.logger?.warn('Error serializing parameter value:', error);
			return '[Complex Object]';
		}
	}

	/**
	 * Get user-friendly category label
	 */
	private getCategoryLabel(category: string): string {
		const labels: Record<string, string> = {
			'read-only': 'Read Only',
			'vault-operations': 'Vault Operation',
			external: 'External',
			web: 'Web Access',
			memory: 'Memory',
			'deep-research': 'Deep Research',
		};
		return labels[category] || category;
	}

	/**
	 * Set icon for tool based on tool name
	 */
	private setToolIcon(container: HTMLElement, toolName: string) {
		const iconMap: Record<string, string> = {
			write_file: 'file-edit',
			delete_file: 'trash-2',
			move_file: 'file-symlink',
			create_folder: 'folder-plus',
			read_file: 'file-text',
			list_files: 'folder-open',
			find_files_by_name: 'search',
			find_files_by_content: 'search',
		};
		setIcon(container, iconMap[toolName] || 'tool');
	}

	/**
	 * Cleanup method to clear any pending scroll timers
	 */
	cleanup() {
		if (this.scrollTimeout) {
			window.clearTimeout(this.scrollTimeout);
			this.scrollTimeout = null;
		}
		if (this.autoOpenDiffTimeout !== null) {
			window.clearTimeout(this.autoOpenDiffTimeout);
			this.autoOpenDiffTimeout = null;
		}

		// Settle any pending confirmation promises so tool executions don't hang
		for (const resolve of this.pendingConfirmations) {
			resolve({ confirmed: false, allowWithoutConfirmation: false, userEdited: false });
		}
		this.pendingConfirmations.clear();
	}
}
