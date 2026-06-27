import { App, MarkdownRenderer, Notice, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import type ObsidianGemini from '../../main';
import { formatModelMessage } from '../../utils/markdown-formatting';
import { stripTurnPreamble } from '../../utils/turn-preamble';
import { Tool, DiffContext, ConfirmationResult } from '../../tools/types';
import { t, getResolvedLocale } from '../../i18n';

// Documentation and help content
const DOCS_BASE_URL = 'https://allenhutchison.github.io/obsidian-gemini';
const AGENT_MODE_GUIDE_URL = `${DOCS_BASE_URL}/guide/agent-mode`;

const AGENT_CAPABILITIES = [
	{ icon: 'search', key: 'agent.empty.capability.search' },
	{ icon: 'file-edit', key: 'agent.empty.capability.organize' },
	{ icon: 'globe', key: 'agent.empty.capability.web' },
	{ icon: 'workflow', key: 'agent.empty.capability.multiStep' },
] as const;

const DEFAULT_EXAMPLE_PROMPTS = [
	{ icon: 'search', key: 'agent.empty.example.findTagged' },
	{ icon: 'file-plus', key: 'agent.empty.example.weeklySummary' },
	{ icon: 'globe', key: 'agent.empty.example.research' },
	{ icon: 'folder-tree', key: 'agent.empty.example.organize' },
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
	private pendingPlanApproval: ((approved: boolean) => void) | null = null;
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
			return DEFAULT_EXAMPLE_PROMPTS.map((p) => ({ icon: p.icon, text: t(p.key) }));
		} catch (error) {
			this.plugin.logger.warn('Failed to load example prompts, using defaults:', error);
			return DEFAULT_EXAMPLE_PROMPTS.map((p) => ({ icon: p.icon, text: t(p.key) }));
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

		// Plan entries (isPlan: true) are already-decided — render with plan styling
		// but no interactive buttons (they were approved; approval label is shown instead).
		if (entry.isPlan) {
			await this.displayDecidedPlanMessage(entry, currentSession);
			return;
		}

		// Reasoning-only turn (the model thought but produced no text — e.g. before
		// calling tools). Render it as a bare collapsible line in the conversation
		// flow, with no "Agent" message header, so reasoning steps don't each spawn
		// a new attribution.
		if (entry.role === 'model' && !entry.message.trim() && entry.thoughts?.trim()) {
			const sourcePath = currentSession?.historyPath || '';
			await this.renderReasoningSection(this.chatContainer, entry.thoughts, sourcePath);
			this.scrollToBottom();
			this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
			return;
		}

		const messageDiv = this.chatContainer.createDiv({
			cls: `gemini-agent-message gemini-agent-message-${entry.role}`,
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', {
			text:
				entry.role === 'user'
					? t('agent.message.roleUser')
					: entry.role === 'system'
						? t('agent.message.roleSystem')
						: t('agent.message.roleAgent'),
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
							text: t('agent.message.toolPrefix', { name: toolName }),
							cls: 'gemini-agent-tool-name',
						});

						// Tool status (if available)
						if (toolContent.includes('✅')) {
							toolHeader.createEl('span', {
								text: t('agent.message.toolSuccess'),
								cls: 'gemini-agent-tool-status gemini-agent-tool-status-success',
							});
						} else if (toolContent.includes('❌')) {
							toolHeader.createEl('span', {
								text: t('agent.message.toolFailed'),
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

		// Render model reasoning as a collapsible section below the message.
		if (entry.role === 'model' && entry.thoughts?.trim()) {
			await this.renderReasoningSection(content, entry.thoughts, sourcePath);
		}

		// Scroll to bottom after displaying message
		this.scrollToBottom();

		// Setup image click handlers
		this.setupImageClickHandlers(content, sourcePath);

		// Add a copy button for messages with visible text (skip reasoning-only turns).
		if ((entry.role === 'model' || entry.role === 'user') && renderMessage.trim()) {
			const copyButton = content.createEl('button', {
				cls: 'gemini-agent-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Copy the user-visible text (preamble stripped for user turns)
				navigator.clipboard
					.writeText(renderMessage)
					.then(() => {
						new Notice(t('agent.message.copied'));
					})
					.catch((err) => {
						new Notice(t('agent.message.copyFailed'));
						this.plugin.logger.error(err);
					});
			});
		}

		// Auto-scroll to bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Render a persisted plan entry from session history without interactive buttons.
	 * Used when reloading history — the plan was already approved; we show the content
	 * with the plan card styling and an "approved" decision label.
	 */
	private async displayDecidedPlanMessage(
		entry: GeminiConversationEntry,
		currentSession: ChatSession | null
	): Promise<void> {
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) emptyState.remove();

		const messageDiv = this.chatContainer.createDiv({
			cls: 'gemini-agent-message gemini-agent-message-model gemini-agent-message-plan',
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', {
			text: t('agent.planMode.headerLabel'),
			cls: 'gemini-agent-message-role',
		});
		header.createEl('span', {
			text: entry.created_at.toLocaleTimeString(),
			cls: 'gemini-agent-message-time',
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });
		const sourcePath = currentSession?.historyPath || '';
		await MarkdownRenderer.render(this.app, formatModelMessage(entry.message), content, sourcePath, this.viewContext);
		if (entry.thoughts?.trim()) {
			await this.renderReasoningSection(content, entry.thoughts, sourcePath);
		}
		this.setupImageClickHandlers(content, sourcePath);

		const actionsDiv = messageDiv.createDiv({ cls: 'gemini-agent-plan-actions' });
		actionsDiv.createEl('span', {
			text: t('agent.planMode.approved'),
			cls: 'gemini-agent-plan-decision gemini-agent-plan-decision-approve',
		});

		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Public entry point to render a reasoning line into an arbitrary container —
	 * e.g. the tool group body, so reasoning interleaves with tool rows. Shares
	 * the single row renderer so live and reload reasoning look identical.
	 */
	async renderReasoningInto(container: HTMLElement, thoughts: string, sourcePath: string): Promise<void> {
		await this.renderReasoningSection(container, thoughts, sourcePath);
	}

	/**
	 * Render model reasoning ("thinking") as a single collapsible line that
	 * mirrors a tool-execution row — a 🧠 header that toggles open — but without
	 * the surrounding group box. Shared by the live-stream finalizer, the
	 * reasoning-only renderer, and history re-rendering so reasoning looks the
	 * same whether it just arrived or was loaded from a session file.
	 */
	private async renderReasoningSection(parent: HTMLElement, thoughts: string, sourcePath: string): Promise<void> {
		// Reuse the tool-row structure/styling (no group wrapper) so reasoning
		// reads as the same kind of collapsible line as a tool call.
		const row = parent.createDiv({ cls: 'gemini-tool-row gemini-reasoning-row' });

		const header = row.createDiv({ cls: 'gemini-tool-row-header' });
		header.setAttribute('role', 'button');
		header.setAttribute('tabindex', '0');
		header.setAttribute('aria-expanded', 'false');

		const icon = header.createSpan({ cls: 'gemini-tool-row-icon gemini-reasoning-row-icon' });
		icon.setText('🧠');

		header.createSpan({ text: t('agent.message.reasoning'), cls: 'gemini-tool-row-name' });

		const chevron = header.createSpan({ cls: 'gemini-tool-row-chevron' });
		setIcon(chevron, 'chevron-right');

		const details = row.createDiv({ cls: 'gemini-tool-row-details gemini-reasoning-row-details' });
		details.style.display = 'none';
		await MarkdownRenderer.render(this.app, formatModelMessage(thoughts), details, sourcePath, this.viewContext);

		const toggle = () => {
			const nowExpanded = header.getAttribute('aria-expanded') !== 'true';
			details.style.display = nowExpanded ? 'block' : 'none';
			setIcon(chevron, nowExpanded ? 'chevron-down' : 'chevron-right');
			row.toggleClass('gemini-tool-row-expanded', nowExpanded);
			header.setAttribute('aria-expanded', String(nowExpanded));
		};
		header.addEventListener('click', toggle);
		header.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggle();
			}
		});
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
			text:
				role === 'user'
					? t('agent.message.roleUser')
					: role === 'system'
						? t('agent.message.roleSystem')
						: t('agent.message.roleAgent'),
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

			// Render model reasoning as a collapsible section below the message.
			if (entry.role === 'model' && entry.thoughts?.trim()) {
				await this.renderReasoningSection(messageDiv, entry.thoughts, sourcePath);
			}

			// Add a copy button only when there's visible message text — mirrors the
			// reasoning-only suppression in displayMessage.
			if (entry.role === 'model' && fullMarkdown.trim()) {
				const copyButton = messageDiv.createEl('button', {
					cls: 'gemini-agent-copy-button',
				});
				setIcon(copyButton, 'copy');

				copyButton.addEventListener('click', () => {
					// Use the original message text to preserve formatting
					navigator.clipboard
						.writeText(entry.message)
						.then(() => {
							new Notice(t('agent.message.copied'));
						})
						.catch((err) => {
							new Notice(t('agent.message.copyFailed'));
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
				text: t('agent.empty.title'),
				cls: 'gemini-agent-empty-title',
			});

			emptyState.createEl('p', {
				text: t('agent.empty.description'),
				cls: 'gemini-agent-empty-desc',
			});

			// What can the agent do section
			const capabilities = emptyState.createDiv({ cls: 'gemini-agent-capabilities' });

			capabilities.createEl('h4', {
				text: t('agent.empty.capabilitiesTitle'),
				cls: 'gemini-agent-capabilities-title',
			});

			const capList = capabilities.createEl('ul', { cls: 'gemini-agent-capabilities-list' });

			AGENT_CAPABILITIES.forEach((item) => {
				const li = capList.createEl('li', { cls: 'gemini-agent-capability-item' });
				const iconEl = li.createSpan({ cls: 'gemini-agent-capability-icon' });
				setIcon(iconEl, item.icon);
				li.createSpan({ text: t(item.key), cls: 'gemini-agent-capability-text' });
			});

			// Documentation link
			const docsLink = capabilities.createDiv({ cls: 'gemini-agent-docs-link' });
			const linkEl = docsLink.createEl('a', {
				text: t('agent.empty.docsLink'),
				cls: 'gemini-agent-docs-link-text',
			});
			linkEl.href = AGENT_MODE_GUIDE_URL;
			linkEl.setAttribute('aria-label', t('agent.empty.docsLinkAria'));
			linkEl.addEventListener('click', (e) => {
				e.preventDefault();
				// Validate URL before opening
				if (linkEl.href.startsWith(DOCS_BASE_URL)) {
					try {
						window.open(linkEl.href, '_blank');
					} catch (error) {
						this.plugin.logger.error('Failed to open documentation link:', error);
						new Notice(t('agent.empty.docsOpenFailed'));
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
				buttonText.createEl('strong', { text: t('agent.empty.updateContext') });
				buttonText.createEl('span', {
					text: t('agent.empty.updateContextDesc'),
					cls: 'gemini-agent-init-desc',
				});
			} else {
				buttonText.createEl('strong', { text: t('agent.empty.initContext') });
				buttonText.createEl('span', {
					text: t('agent.empty.initContextDesc'),
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
					text: t('agent.empty.recentSessions'),
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
				text: t('agent.empty.examplesHeader'),
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

			if (getResolvedLocale() !== 'en') {
				emptyState.createEl('p', {
					text: t('i18n.aiTranslatedNotice'),
					cls: 'gemini-agent-i18n-notice',
				});
			}
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
	 * Display a plan from the model with Approve / Reject buttons.
	 * Resolves true when the user approves, false when they reject.
	 */
	public async showPlanApproval(planText: string): Promise<boolean> {
		const messageDiv = this.chatContainer.createDiv({
			cls: 'gemini-agent-message gemini-agent-message-model gemini-agent-plan-message',
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', {
			text: t('agent.planMode.headerLabel'),
			cls: 'gemini-agent-message-role gemini-agent-plan-role',
		});
		header.createEl('span', {
			text: new Date().toLocaleTimeString(),
			cls: 'gemini-agent-message-time',
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });
		await MarkdownRenderer.render(this.app, formatModelMessage(planText), content, '', this.viewContext);

		const buttonsDiv = messageDiv.createDiv({ cls: 'gemini-agent-plan-buttons' });

		const approveBtn = buttonsDiv.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-primary',
			text: t('agent.planMode.approveBtn'),
		});
		const rejectBtn = buttonsDiv.createEl('button', {
			cls: 'gemini-agent-btn gemini-agent-btn-secondary',
			text: t('agent.planMode.rejectBtn'),
		});

		this.debouncedScrollToBottom();

		return new Promise((resolve) => {
			let resolved = false;

			const done = (approved: boolean) => {
				if (resolved) return;
				resolved = true;
				this.pendingPlanApproval = null;
				approveBtn.disabled = true;
				rejectBtn.disabled = true;
				buttonsDiv.remove();
				resolve(approved);
				this.debouncedScrollToBottom();
			};

			// Allow the Stop button / view teardown to settle this promise via
			// settlePendingPlanApproval, so a cancelled turn doesn't hang here.
			this.pendingPlanApproval = done;
			approveBtn.addEventListener('click', () => done(true));
			rejectBtn.addEventListener('click', () => done(false));
		});
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
			header.createEl('span', { text: t('agent.confirm.title'), cls: 'gemini-agent-message-role' });
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
				paramsSection.createEl('div', { text: t('agent.confirm.parameters'), cls: 'gemini-agent-params-header' });

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
			allowBtn.createSpan({ text: t('agent.confirm.allow') });

			// Cancel button
			const cancelBtn = buttonsContainer.createEl('button', {
				cls: 'gemini-agent-confirmation-btn gemini-agent-confirmation-btn-cancel',
			});
			const cancelIcon = cancelBtn.createSpan({ cls: 'gemini-agent-confirmation-btn-icon' });
			setIcon(cancelIcon, 'x');
			cancelBtn.createSpan({ text: t('agent.confirm.cancel') });

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
				text: t('agent.confirm.dontAskAgain'),
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
				viewChangesBtn.createSpan({
					text: diffContext.isNewFile ? t('agent.confirm.previewFile') : t('agent.confirm.viewChanges'),
				});

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

				// On grant, drop the request card from the main flow — the caller
				// renders a "permission granted" row into the tool stack instead, so
				// the acknowledgment lives next to the tool it authorized. Denials
				// stay in the main flow as a visible interruption.
				if (confirmed) {
					messageDiv.remove();
				} else {
					this.updateConfirmationResult(messageDiv, confirmed, tool.displayName || tool.name);
				}

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
			const { GeminiDiffView, VIEW_TYPE_DIFF } = await import('./gemini-diff-view');
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
			text: confirmed ? t('agent.confirm.granted', { name: toolName }) : t('agent.confirm.denied', { name: toolName }),
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
			'read-only': t('agent.toolCategory.readOnly'),
			'vault-operations': t('agent.toolCategory.vaultOperations'),
			external: t('agent.toolCategory.external'),
			web: t('agent.toolCategory.web'),
			memory: t('agent.toolCategory.memory'),
			'deep-research': t('agent.toolCategory.deepResearch'),
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

		// Settle a pending plan approval (view closed while the approval card is
		// showing) so conductPlanApproval doesn't hang awaiting a button click.
		this.settlePendingPlanApproval(false);
	}

	/**
	 * Resolve a pending plan-approval promise from outside the approval card —
	 * e.g. the Stop button (stopAgentLoop) or view teardown (cleanup). No-op when
	 * no approval is in flight.
	 */
	public settlePendingPlanApproval(approved: boolean): void {
		if (this.pendingPlanApproval) {
			this.pendingPlanApproval(approved);
			this.pendingPlanApproval = null;
		}
	}
}
