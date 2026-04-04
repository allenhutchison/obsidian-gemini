import { ItemView, WorkspaceLeaf, TFile, Notice, TFolder, setIcon } from 'obsidian';
import { ChatSession, SessionModelConfig } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import type ObsidianGemini from '../../main';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { getErrorMessage } from '../../utils/error-utils';
import { HandlerPriority } from '../../types/agent-events';

// Import all component modules
import { AgentViewProgress } from './agent-view-progress';
import { getTextFilesFromFolder } from './agent-view-shelf';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';
import { AgentViewMessages } from './agent-view-messages';
import { AgentViewContext } from './agent-view-context';
import { AgentViewSession, SessionUICallbacks, SessionState } from './agent-view-session';
import { AgentViewTools, AgentViewContext as ToolsContext } from './agent-view-tools';
import { AgentViewUI, UICallbacks } from './agent-view-ui';
import { InlineAttachment } from './inline-attachment';
import { AgentViewShelf } from './agent-view-shelf';
import { getContextSelection, createContextRange } from '../../utils/dom-context';
import { ProjectPickerModal } from './project-picker-modal';

// Import modals from agent-view directory
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
import { FileMentionModal } from './file-mention-modal';
import { SessionSettingsModal } from './session-settings-modal';

export const VIEW_TYPE_AGENT = 'gemini-agent-view';

/**
 * AgentView is the main coordinator for the Agent Mode interface.
 * It delegates functionality to specialized components and manages their interactions.
 */
export class AgentView extends ItemView {
	private plugin: InstanceType<typeof ObsidianGemini>;

	// UI components
	private progress: AgentViewProgress;
	private messages: AgentViewMessages;
	private context: AgentViewContext;
	private session: AgentViewSession;
	private tools: AgentViewTools;
	private ui: AgentViewUI;

	// UI element references
	private chatContainer: HTMLElement;
	private userInput: HTMLDivElement;
	private sendButton: HTMLButtonElement;
	private sessionHeader: HTMLElement;

	// State
	private currentSession: ChatSession | null = null;
	private currentStreamingResponse: { cancel: () => void } | null = null;
	private isExecuting: boolean = false;
	private turnToolCallCount: number = 0;
	private cancellationRequested: boolean = false;
	private eventBusUnsubscribers: (() => void)[] = [];
	private allowedWithoutConfirmation: Set<string> = new Set(); // Session-level allowed tools
	private shelf: AgentViewShelf;
	private tokenUsageContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: InstanceType<typeof ObsidianGemini>) {
		super(leaf);
		this.plugin = plugin;

		// Initialize components (actual UI setup happens in onOpen)
		this.progress = new AgentViewProgress(this.app, this);
		this.context = new AgentViewContext();
		this.ui = new AgentViewUI(this.app, this.plugin);
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

		// Create default agent session
		await this.createNewSession();
	}

	private async createAgentInterface(container: HTMLElement) {
		// Create UI callbacks for components
		const callbacks: UICallbacks = {
			showFilePicker: () => this.showFilePicker(),
			showFileMention: () => this.showFileMention(),
			showSessionList: () => this.showSessionList(),
			showSessionSettings: () => this.showSessionSettings(),
			createNewSession: () => this.createNewSession(),
			sendMessage: () => this.sendMessage(),
			stopAgentLoop: () => this.stopAgentLoop(),
			removeContextFile: (file: TFile) => this.removeContextFile(file),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateSessionMetadata: () => this.updateSessionMetadata(),
			loadSession: (session: ChatSession) => this.loadSession(session),
			isCurrentSession: (session: ChatSession) => this.isCurrentSession(session),
			addAttachment: (attachment: InlineAttachment) => this.addAttachment(attachment),
			removeAttachment: (id: string) => this.removeAttachment(id),
			getAttachments: () => this.shelf?.getPendingAttachments() || [],
			handleDroppedFiles: (files: TFile[]) => this.handleDroppedFiles(files),
			switchProject: () => this.switchProject(),
		};

		// Create the main interface using AgentViewUI
		const elements = this.ui.createAgentInterface(container, this.currentSession, callbacks);

		// Store element references
		this.sessionHeader = elements.sessionHeader;
		this.chatContainer = elements.chatContainer;
		this.userInput = elements.userInput;
		this.sendButton = elements.sendButton;
		this.tokenUsageContainer = elements.tokenUsageContainer;

		// Initialize the unified file shelf above the input row
		const shelfParent = elements.imagePreviewContainer.parentElement!;
		const inputRow = elements.userInput.parentElement!; // .gemini-agent-input-row
		elements.imagePreviewContainer.remove(); // Remove the old preview container
		this.shelf = new AgentViewShelf(
			this.app,
			shelfParent,
			{
				onRemoveTextFile: (file: TFile) => {
					this.context.removeContextFile(file, this.currentSession);
					this.updateSessionHeader();
					this.updateSessionMetadata();
				},
				onRemoveFolder: (files: TFile[]) => {
					for (const file of files) {
						this.context.removeContextFile(file, this.currentSession);
					}
					this.updateSessionHeader();
					this.updateSessionMetadata();
				},
				onRemoveAttachment: () => {
					// Shelf handles its own state; nothing else to sync
				},
			},
			inputRow
		);

		// Initialize progress bar with the created elements
		this.progress.createProgressBar(elements.progressContainer);

		// Initialize file chips component

		// Initialize messages component
		this.messages = new AgentViewMessages(
			this.app,
			this.chatContainer,
			this.plugin,
			this.userInput,
			this // View context for MarkdownRenderer
		);

		// Initialize tools component with context
		const toolsContext: ToolsContext = {
			getCurrentSession: () => this.currentSession,
			isCancellationRequested: () => this.cancellationRequested,
			updateProgress: (statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming') =>
				this.progress.update(statusText, state),
			hideProgress: () => this.progress.hide(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			incrementToolCallCount: (count: number) => {
				this.turnToolCallCount += count;
			},
		};
		this.tools = new AgentViewTools(this.chatContainer, this.plugin, toolsContext);

		// Initialize session component with callbacks and state
		const sessionCallbacks: SessionUICallbacks = {
			clearChat: () => this.chatContainer.empty(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateContextPanel: () => this.updateContextPanel(),
			showEmptyState: () => this.showEmptyState(),
			focusInput: () => this.userInput.focus(),
		};

		// Create session state with direct callback references to context
		const sessionState: SessionState = {
			allowedWithoutConfirmation: this.allowedWithoutConfirmation,
			userInput: this.userInput,
		};

		this.session = new AgentViewSession(this.app, this.plugin, sessionCallbacks, sessionState);

		// Register session lifecycle event bus subscribers for token display
		const createdUnsub = this.plugin.agentEventBus?.on(
			'sessionCreated',
			async () => {
				await this.updateTokenUsage();
			},
			HandlerPriority.NORMAL
		);
		if (createdUnsub) this.eventBusUnsubscribers.push(createdUnsub);

		const loadedUnsub = this.plugin.agentEventBus?.on(
			'sessionLoaded',
			async () => {
				await this.refreshTokenUsageFromHistory();
			},
			HandlerPriority.NORMAL
		);
		if (loadedUnsub) this.eventBusUnsubscribers.push(loadedUnsub);

		// Create the header and context panel
		this.ui.createCompactHeader(this.sessionHeader, this.currentSession, callbacks);

		// Show empty state initially
		await this.showEmptyState();
	}

	/**
	 * Main orchestration method for sending messages and handling tool calls
	 */
	private async sendMessage() {
		if (!this.currentSession) {
			new Notice('No active session');
			return;
		}
		// Snapshot session so all hook emissions use the same reference
		// even if currentSession changes during async operations
		const turnSession = this.currentSession;

		// Get message text directly from input (no chips to process)
		const message = this.userInput.innerText?.trim() || '';
		const formattedMessage = message;
		// Allow sending with only attachments (no text)
		const shelfTextFiles = this.shelf.getTextFiles();
		const attachments = this.shelf.getPendingAttachments();
		if (!message && shelfTextFiles.length === 0 && attachments.length === 0) return;

		// Mark binary shelf items as sent
		this.shelf.markBinarySent();

		// Save attachments to vault (skip those already saved, e.g. from drag-drop)
		const savedAttachments: Array<{ attachment: InlineAttachment; path: string }> = [];
		const failedSaves: number[] = [];
		for (let i = 0; i < attachments.length; i++) {
			const attachment = attachments[i];
			if (attachment.vaultPath) {
				// Already in vault (from drag-drop), skip saving
				savedAttachments.push({ attachment, path: attachment.vaultPath });
				continue;
			}
			try {
				const { saveAttachmentToVault } = await import('./inline-attachment');
				const path = await saveAttachmentToVault(this.app, attachment);
				attachment.vaultPath = path;
				savedAttachments.push({ attachment, path });
			} catch (err) {
				this.plugin.logger.error('Failed to save attachment to vault:', err);
				failedSaves.push(i + 1);
			}
		}

		// Notify user of any save failures (attachments will still be sent to AI)
		if (failedSaves.length > 0) {
			const failedList = failedSaves.join(', ');
			new Notice(
				`Failed to save ${failedSaves.length === 1 ? 'attachment' : 'attachments'} #${failedList} to vault. ` +
					`${failedSaves.length === 1 ? 'It' : 'They'} will still be sent to the AI but won't be stored locally.`,
				5000
			);
		}

		// Clear input
		this.userInput.innerHTML = '';

		// Set execution state and change button to "Stop"
		this.isExecuting = true;
		this.cancellationRequested = false;
		this.sendButton.empty();
		setIcon(this.sendButton, 'square');
		this.sendButton.addClass('gemini-agent-stop-btn');
		this.sendButton.disabled = false; // Re-enable so user can click stop
		this.sendButton.setAttribute('aria-label', 'Stop agent execution');
		this.turnToolCallCount = 0;

		// Emit turnStart hook
		await this.plugin.agentEventBus?.emit('turnStart', {
			session: turnSession,
			userMessage: formattedMessage,
		});

		// Show progress bar
		this.progress.show('Thinking...', 'thinking');

		// Build message with attachment previews for display
		let displayMessage = formattedMessage;
		if (savedAttachments.length > 0) {
			const imagePaths: string[] = [];
			const otherPaths: { path: string; label: string }[] = [];

			for (const { attachment, path } of savedAttachments) {
				const mimeType = attachment.mimeType || '';
				if (mimeType.startsWith('image/')) {
					imagePaths.push(path);
				} else {
					let label = 'Attachment';
					if (mimeType.startsWith('audio/')) label = 'Audio';
					else if (mimeType.startsWith('video/')) label = 'Video';
					else if (mimeType === 'application/pdf') label = 'PDF';
					otherPaths.push({ path, label });
				}
			}

			const parts: string[] = [];

			if (imagePaths.length > 0) {
				const imageLinks = imagePaths.map((path) => `![[${path}]]`).join('\n');
				const contextNote = `\n> [!info] Image Source\n> ${imagePaths.map((p) => `\`${p}\``).join('\n> ')}`;
				parts.push(imageLinks + contextNote);
			}

			if (otherPaths.length > 0) {
				const contextNote = `> [!info] Attachment Source\n> ${otherPaths.map((o) => `\`${o.path}\` (${o.label})`).join('\n> ')}`;
				parts.push(contextNote);
			}

			if (parts.length > 0) {
				displayMessage = displayMessage + '\n\n' + parts.join('\n\n');
			}
		}

		// Display user message with formatted version (includes markdown links and images)
		const userEntry: GeminiConversationEntry = {
			role: 'user',
			message: displayMessage, // Use formatted message with images for display
			notePath: '',
			created_at: new Date(),
		};
		await this.displayMessage(userEntry);

		try {
			// Get all context files from the shelf (persistent text files + folder contents)
			const allContextFiles = this.shelf.getTextFiles();

			// Snapshot pre-turn history BEFORE saving user message to avoid duplication
			const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);

			// Save user message to history once, before the API call.
			// Tools use in-memory updatedHistory, not the file, so early save is safe.
			await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);

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

			// Load project instructions if session is linked to a project
			let projectInstructions: string | undefined;
			if (this.currentSession?.projectPath && this.plugin.projectManager) {
				try {
					const project = await this.plugin.projectManager.getProject(this.currentSession.projectPath);
					if (project?.instructions) {
						projectInstructions = project.instructions;
					}
				} catch (error) {
					this.plugin.logger.error('Error loading project instructions:', error);
				}
			}

			// Build additional prompt instructions (not part of system prompt)
			let additionalInstructions = '';

			// Add context file note if shelf has text files
			if (shelfTextFiles.length > 0) {
				const fileList = shelfTextFiles.map((f) => `- [[${f.path}|${f.basename}]]`).join('\n');
				additionalInstructions += `\n\nCONTEXT FILES: The following files have been added to this conversation as context:
${fileList}

When referring to these files in tool calls, use the FULL PATH (the part before | in the wikilinks above).
The content of these files is included in the context below.`;
			}

			// Add attachment path information if attachments were saved
			if (savedAttachments.length > 0) {
				const pathList = savedAttachments.map(({ path }) => `- ${path}`).join('\n');
				additionalInstructions += `\n\nATTACHMENTS: The user has attached ${savedAttachments.length} file(s) to this message. They have been saved to the vault at these paths:
${pathList}
To embed images in a note, use the wikilink format: ![[path/to/image.png]]
To reference an attachment in your response, use the path shown above.`;
			}

			// Add context information if available
			if (contextInfo) {
				additionalInstructions += `\n\n${contextInfo}`;
			}

			// Get available tools for this session
			// Set project root path for scoped tool discovery
			const activeProject = this.currentSession?.projectPath
				? await this.plugin.projectManager?.getProject(this.currentSession.projectPath)
				: null;

			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession,
				projectRootPath: activeProject?.rootPath,
				projectPermissions: activeProject?.config.permissions,
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);
			this.plugin.logger.log('Available tools from registry:', availableTools);
			this.plugin.logger.log('Number of tools:', availableTools.length);
			this.plugin.logger.log(
				'Tool names:',
				availableTools.map((t) => t.name)
			);

			try {
				// Get model config from session or use defaults
				const modelConfig = this.currentSession?.modelConfig || {};
				const modelName = modelConfig.model || this.plugin.settings.chatModelName;

				// beginTurn() is now handled by the turnStart event bus subscriber

				// Prepare history through context manager (may compact if over threshold)
				const compactionResult = await this.plugin.contextManager.prepareHistory(conversationHistory, modelName);

				// If compaction occurred, show notification and save summary to transcript
				if (compactionResult.wasCompacted && compactionResult.summaryText) {
					// Force-set the lower post-compaction token count (bypasses high-water mark)
					this.plugin.contextManager.setUsageMetadata({
						promptTokenCount: compactionResult.estimatedTokens,
						totalTokenCount: compactionResult.estimatedTokens,
					});
					await this.updateTokenUsage();

					const compactionEntry: GeminiConversationEntry = {
						role: 'model',
						message: `> [!info] Context Compacted\n> Older conversation turns have been summarized to maintain performance.\n\n${compactionResult.summaryText}`,
						notePath: '',
						created_at: new Date(),
					};
					await this.displayMessage(compactionEntry);
					await this.plugin.sessionHistory.addEntryToSession(this.currentSession, compactionEntry);
					this.plugin.logger.log(`[AgentView] Context compacted: ${compactionResult.estimatedTokens} tokens remaining`);
				}

				const request: ExtendedModelRequest = {
					userMessage: message,
					conversationHistory: compactionResult.compactedHistory,
					model: modelName,
					temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
					topP: modelConfig.topP ?? this.plugin.settings.topP,
					prompt: additionalInstructions, // Additional context and instructions
					customPrompt: customPrompt, // Custom prompt template (if configured)
					projectInstructions: projectInstructions, // Project-scoped instructions (if active)
					projectSkills: activeProject?.config.skills, // Filter skills to project scope
					renderContent: false, // We already rendered content above
					availableTools: availableTools,
					inlineAttachments: attachments.map((a: InlineAttachment) => ({ base64: a.base64, mimeType: a.mimeType })),
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
							const chunkPreview = chunk.thought.length > 100 ? chunk.thought.substring(0, 100) + '...' : chunk.thought;
							this.plugin.logger.debug(`[AgentView] Received thought chunk: ${chunkPreview}`);
							accumulatedThoughts += chunk.thought;

							// Update the expandable thinking section
							this.progress.updateThought(accumulatedThoughts);
						}

						// Handle text content
						if (chunk.text) {
							accumulatedMarkdown += chunk.text;

							// Update progress to streaming state when first text chunk arrives
							if (!progressUpdated) {
								this.progress.update('Generating response...', 'streaming');
								progressUpdated = true;
							}

							// Create or update the model message container
							if (!modelMessageContainer) {
								// First chunk - create the container
								modelMessageContainer = this.messages.createStreamingMessageContainer('model');
								this.messages.updateStreamingMessage(modelMessageContainer, chunk.text);
							} else {
								// Update existing container with new chunk
								this.messages.updateStreamingMessage(modelMessageContainer, chunk.text);
								// Use debounced scroll to avoid stuttering
								this.messages.debouncedScrollToBottom();
							}
						}
					});

					// Store the streaming response for potential cancellation
					this.currentStreamingResponse = streamResponse;

					try {
						const response = await streamResponse.complete;
						this.currentStreamingResponse = null;

						// Emit usage metadata via event bus (contextManager subscribes)
						if (response.usageMetadata) {
							await this.plugin.agentEventBus?.emit('apiResponseReceived', {
								usageMetadata: response.usageMetadata,
							});
						} else {
							this.plugin.logger.debug('[AgentView] Streaming response had no usageMetadata');
						}

						// Check if the model requested tool calls
						if (response.toolCalls && response.toolCalls.length > 0) {
							// User message already saved early in sendMessage()

							// If there was any streamed text before tool calls, finalize it
							if (modelMessageContainer && accumulatedMarkdown.trim()) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: accumulatedMarkdown,
									notePath: '',
									created_at: new Date(),
								};
								await this.messages.finalizeStreamingMessage(
									modelMessageContainer,
									accumulatedMarkdown,
									aiEntry,
									this.currentSession
								);

								// Save partial response to history before executing tools
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
							}

							// Execute tools and handle results
							await this.tools.handleToolCalls(
								response.toolCalls,
								message,
								compactionResult.compactedHistory,
								userEntry,
								customPrompt
							);
						} else {
							// Normal response without tool calls
							// Only finalize and save if response has content
							if (response.markdown && response.markdown.trim()) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: response.markdown,
									notePath: '',
									created_at: new Date(),
								};

								// Finalize the streaming message with proper rendering
								if (modelMessageContainer) {
									await this.messages.finalizeStreamingMessage(
										modelMessageContainer,
										response.markdown,
										aiEntry,
										this.currentSession
									);
								}

								// Save AI response to history (user message already saved early)
								await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

								// Ensure we're scrolled to bottom after streaming completes
								this.messages.scrollToBottom();

								// Hide progress bar after successful response
								this.progress.hide();
							} else {
								// Empty response - might be thinking tokens
								this.plugin.logger.warn('Model returned empty response');
								new Notice(
									'Model returned an empty response. This might happen with thinking models. Try rephrasing your question.'
								);

								// Hide progress bar
								this.progress.hide();

								// User message already saved early in sendMessage()
							}
						}
					} catch (error) {
						this.currentStreamingResponse = null;
						// Hide progress bar on error
						this.progress.hide();
						throw error;
					}
				} else {
					// Fall back to non-streaming API
					this.plugin.logger.log('Agent view using non-streaming API');
					const response = await modelApi.generateModelResponse(request);

					// Emit usage metadata via event bus (contextManager subscribes)
					if (response.usageMetadata) {
						await this.plugin.agentEventBus?.emit('apiResponseReceived', {
							usageMetadata: response.usageMetadata,
						});
					} else {
						this.plugin.logger.debug('[AgentView] Non-streaming response had no usageMetadata');
					}

					// Update progress to show response received
					this.progress.update('Processing response...', 'waiting');

					// Check if the model requested tool calls
					if (response.toolCalls && response.toolCalls.length > 0) {
						// Execute tools and handle results
						await this.tools.handleToolCalls(
							response.toolCalls,
							message,
							compactionResult.compactedHistory,
							userEntry,
							customPrompt
						);
					} else {
						// Normal response without tool calls
						// Only display if response has content
						if (response.markdown && response.markdown.trim()) {
							// Display AI response
							const aiEntry: GeminiConversationEntry = {
								role: 'model',
								message: response.markdown,
								notePath: '',
								created_at: new Date(),
							};
							await this.displayMessage(aiEntry);

							// Save AI response to history (user message already saved early)
							await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);

							// Hide progress bar after successful response
							this.progress.hide();
						} else {
							// Empty response - might be thinking tokens
							this.plugin.logger.warn('Model returned empty response');
							new Notice(
								'Model returned an empty response. This might happen with thinking models. Try rephrasing your question.'
							);

							// User message already saved early in sendMessage()

							// Hide progress bar
							this.progress.hide();
						}
					}
				}
			} catch (error) {
				// Hide progress bar on error
				this.progress.hide();
				throw error;
			}
		} catch (error) {
			this.plugin.logger.error('Failed to send message:', error);
			const errorMessage = getErrorMessage(error);
			new Notice(errorMessage, 8000); // Show for 8 seconds to give user time to read

			// Emit turnError hook
			await this.plugin.agentEventBus?.emit('turnError', {
				session: turnSession,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		} finally {
			// Always emit turnEnd so subscribers get a reliable cleanup signal
			await this.plugin.agentEventBus?.emit('turnEnd', {
				session: turnSession,
				toolCallCount: this.turnToolCallCount,
			});

			// Reset execution state and button (unless already reset by stopAgentLoop)
			// The check prevents redundant resets if user clicked stop
			if (this.isExecuting) {
				this.resetExecutionUiState();
			}

			// Always update token usage display after any message completion
			await this.updateTokenUsage();
		}
	}

	/**
	 * Stops the current agent execution loop
	 */
	private stopAgentLoop() {
		this.plugin.logger.debug('[AgentView] stopAgentLoop called');

		// Set cancellation flag
		this.cancellationRequested = true;

		// Cancel streaming response if active
		if (this.currentStreamingResponse) {
			this.plugin.logger.debug('[AgentView] Cancelling streaming response');
			this.currentStreamingResponse.cancel();
			this.currentStreamingResponse = null;
		}

		// Update UI immediately
		this.resetExecutionUiState();

		// Hide progress bar
		this.progress.hide();

		// Show cancellation notice
		new Notice('Agent execution cancelled');
	}

	/**
	 * Resets execution UI state after completion or cancellation
	 */
	private resetExecutionUiState() {
		this.isExecuting = false;
		// Note: Don't reset cancellationRequested here - it needs to stay true
		// so that tool loops can see it. It's reset in sendMessage() when starting
		// a new execution.
		this.sendButton.disabled = false;
		this.sendButton.empty();
		setIcon(this.sendButton, 'play');
		this.sendButton.removeClass('gemini-agent-stop-btn');
		this.sendButton.setAttribute('aria-label', 'Send message to agent');
	}

	/**
	 * Display a message in the chat (delegates to messages component)
	 */
	private async displayMessage(entry: GeminiConversationEntry) {
		await this.messages.displayMessage(entry, this.currentSession);
	}

	/**
	 * Show empty state (delegates to messages component)
	 */
	private async showEmptyState() {
		await this.messages.showEmptyState(
			this.currentSession,
			(session) => this.loadSession(session),
			() => this.sendMessage()
		);
	}

	/**
	 * Update context panel UI and sync shelf with session context
	 */
	private updateContextPanel() {
		// Sync shelf with current session's context files
		if (this.currentSession) {
			this.shelf.loadFromSession(this.currentSession.context.contextFiles);
		} else {
			this.shelf.clear();
		}
	}

	/**
	 * Update session header UI
	 */
	private updateSessionHeader() {
		this.ui.createCompactHeader(this.sessionHeader, this.currentSession, this.getUICallbacks());
	}

	/**
	 * Update context files list display
	 */
	/**
	 * Remove a file from context
	 */
	private removeContextFile(file: TFile) {
		this.context.removeContextFile(file, this.currentSession);
		this.updateSessionHeader();
	}

	/**
	 * Show file picker modal
	 */
	private async showFilePicker() {
		if (!this.currentSession) return;
		const session = this.currentSession;
		const initialFiles = [...session.context.contextFiles];

		const modal = new FilePickerModal(
			this.app,
			(newFiles: TFile[]) => {
				const newSet = new Set(newFiles);
				const oldSet = new Set(initialFiles);
				// Remove files no longer selected
				initialFiles
					.filter((f) => !newSet.has(f))
					.forEach((f) => {
						this.context.removeContextFile(f, session);
						const shelfItems = this.shelf.getItems();
						const match = shelfItems.find((item) => item.type === 'text' && item.path === f.path);
						if (match) this.shelf.removeItem(match.id);
					});
				// Add newly selected files
				newFiles
					.filter((f) => !oldSet.has(f))
					.forEach((f) => {
						this.context.addFileToContext(f, session);
						this.shelf.addTextFile(f);
					});
				this.updateSessionHeader();
			},
			this.plugin,
			initialFiles
		);
		modal.open();
	}

	/**
	 * Show file mention modal for @ mentions
	 */
	private async showFileMention() {
		const modal = new FileMentionModal(
			this.app,
			async (fileOrFolder: TFile | TFolder) => {
				// Remove the @ character that triggered the picker
				this.removeTrailingAtSymbol();

				if (fileOrFolder instanceof TFolder) {
					const files = getTextFilesFromFolder(fileOrFolder, (path) => shouldExcludePathForPlugin(path, this.plugin));
					this.shelf.addFolder(fileOrFolder, files);
					for (const file of files) {
						this.context.addFileToContext(file, this.currentSession);
					}
					this.updateSessionHeader();
					this.updateSessionMetadata();
					return;
				}

				// Classify the file to determine text vs binary handling
				const { classifyFile, FileCategory, arrayBufferToBase64, detectWebmMimeType, GEMINI_INLINE_DATA_LIMIT } =
					await import('../../utils/file-classification');
				const classification = classifyFile(fileOrFolder.extension);

				if (classification.category === FileCategory.TEXT) {
					this.shelf.addTextFile(fileOrFolder);
					this.context.addFileToContext(fileOrFolder, this.currentSession);
					this.updateSessionHeader();
					this.updateSessionMetadata();
				} else if (classification.category === FileCategory.GEMINI_BINARY) {
					// Handle binary file — create inline attachment (same as drag-drop)
					try {
						const buffer = await this.app.vault.readBinary(fileOrFolder);
						const existing = this.shelf.getPendingAttachments();
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
						this.plugin.logger.error(`Failed to attach ${fileOrFolder.path}:`, err);
						new Notice(`Failed to attach ${fileOrFolder.name}`);
					}
				}
			},
			this.plugin
		);
		modal.open();
	}

	/**
	 * Remove a trailing @ character from the input, used when the file picker
	 * replaces the @ trigger with a shelf entry.
	 */
	private removeTrailingAtSymbol(): void {
		const input = this.userInput;
		if (!input) return;

		const selection = getContextSelection(input);
		if (!selection || selection.rangeCount === 0) return;

		const range = selection.getRangeAt(0);

		// Only proceed with a collapsed cursor (no text selected)
		if (!range.collapsed) return;

		const node = range.startContainer;

		// Only mutate text nodes within the input element
		if (!input.contains(node)) return;

		// Check if the character before cursor is @
		if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
			const text = node.textContent || '';
			const offset = range.startOffset;
			if (text[offset - 1] === '@') {
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
	 * Show session list modal
	 */
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
				},
			},
			this.currentSession?.id || null
		);
		modal.open();
	}

	/**
	 * Show session settings modal
	 */
	private async showSessionSettings() {
		if (!this.currentSession) {
			new Notice('No active session');
			return;
		}

		const modal = new SessionSettingsModal(
			this.app,
			this.plugin,
			this.currentSession,
			async (config: SessionModelConfig) => {
				// Update current session's model config with new settings
				if (this.currentSession) {
					this.currentSession.modelConfig = config;
					await this.updateSessionMetadata();
					this.updateSessionHeader();
				}
			}
		);
		modal.open();
	}

	/**
	 * Create a new agent session (delegates to session component)
	 */
	private async createNewSession() {
		await this.session.createNewSession();
		this.currentSession = this.session.getCurrentSession();
		// Re-render header now that currentSession is updated — the header
		// rendered inside createNewSession() used the stale reference.
		this.updateSessionHeader();
		// Emit after this.currentSession is updated so subscribers see the correct session
		if (this.currentSession) {
			await this.plugin.agentEventBus?.emit('sessionCreated', { session: this.currentSession });
		}
	}

	/**
	 * Load an existing session (delegates to session component)
	 */
	async loadSession(session: ChatSession) {
		await this.session.loadSession(session);
		this.currentSession = this.session.getCurrentSession();
		this.updateSessionHeader();
		// Emit after this.currentSession is updated so subscribers see the correct session
		if (this.currentSession) {
			await this.plugin.agentEventBus?.emit('sessionLoaded', { session: this.currentSession });
		}
	}

	/**
	 * Open the project picker and switch the current session's project
	 */
	private switchProject() {
		if (!this.currentSession) return;

		const modal = new ProjectPickerModal(
			this.app,
			this.plugin,
			{
				onSelect: async (project) => {
					if (!this.currentSession) return;

					const previousProjectPath = this.currentSession.projectPath;
					this.currentSession.projectPath = project?.filePath ?? undefined;

					try {
						await this.plugin.sessionHistory.updateSessionMetadata(this.currentSession);
						this.updateSessionHeader();
						this.plugin.logger.log(`Switched project to: ${project?.name ?? 'none'}`);
					} catch (error) {
						// Rollback on persistence failure
						this.currentSession.projectPath = previousProjectPath;
						this.updateSessionHeader();
						this.plugin.logger.error('Failed to persist project change:', error);
					}
				},
			},
			this.currentSession.projectPath ?? null
		);
		modal.open();
	}

	/**
	 * Check if a session is the current session
	 * Compares both session ID and history path for robustness
	 */
	private isCurrentSession(session: ChatSession): boolean {
		if (!this.currentSession) return false;
		return session.id === this.currentSession.id || session.historyPath === this.currentSession.historyPath;
	}

	/**
	 * Update session metadata
	 */
	private async updateSessionMetadata() {
		await this.session.updateSessionMetadata();
	}

	/**
	 * Auto-label session after first exchange
	 */
	/**
	 * Get current session for tool execution
	 */
	getCurrentSessionForToolExecution(): ChatSession | null {
		return this.currentSession;
	}

	/**
	 * Check if a tool is allowed without confirmation (permission system)
	 */
	isToolAllowedWithoutConfirmation(toolName: string): boolean {
		return this.allowedWithoutConfirmation.has(toolName);
	}

	/**
	 * Allow a tool to run without confirmation for this session
	 */
	allowToolWithoutConfirmation(toolName: string) {
		this.allowedWithoutConfirmation.add(toolName);
	}

	/**
	 * Show confirmation request in chat with interactive buttons
	 * Returns Promise that resolves when user clicks a button
	 */
	public async showConfirmationInChat(
		tool: any,
		parameters: any,
		executionId: string,
		diffContext?: import('../../tools/types').DiffContext
	): Promise<import('../../tools/types').ConfirmationResult> {
		// Delegate to messages component
		return this.messages.displayConfirmationRequest(tool, parameters, executionId, diffContext);
	}

	/**
	 * Register link click handler for internal Obsidian links
	 */
	private registerLinkClickHandler() {
		this.registerDomEvent(this.chatContainer, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (target.tagName === 'A' && target.hasClass('internal-link')) {
				evt.preventDefault();
				const href = target.getAttribute('href');
				if (href) {
					this.app.workspace.openLinkText(href, '', false);
				}
			}
		});
	}

	/**
	 * Get UI callbacks for components
	 */
	private getUICallbacks(): UICallbacks {
		return {
			showFilePicker: () => this.showFilePicker(),
			showFileMention: () => this.showFileMention(),
			showSessionList: () => this.showSessionList(),
			showSessionSettings: () => this.showSessionSettings(),
			createNewSession: () => this.createNewSession(),
			sendMessage: () => this.sendMessage(),
			stopAgentLoop: () => this.stopAgentLoop(),
			removeContextFile: (file: TFile) => this.removeContextFile(file),
			updateSessionHeader: () => this.updateSessionHeader(),
			updateSessionMetadata: () => this.updateSessionMetadata(),
			loadSession: (session: ChatSession) => this.loadSession(session),
			isCurrentSession: (session: ChatSession) => this.isCurrentSession(session),
			addAttachment: (attachment: InlineAttachment) => this.addAttachment(attachment),
			removeAttachment: (id: string) => this.removeAttachment(id),
			getAttachments: () => this.shelf?.getPendingAttachments() || [],
			handleDroppedFiles: (files: TFile[]) => this.handleDroppedFiles(files),
			switchProject: () => this.switchProject(),
		};
	}

	/**
	 * Handle dropped text files by adding to shelf
	 */
	private handleDroppedFiles(files: TFile[]) {
		for (const file of files) {
			this.shelf.addTextFile(file);
			this.context.addFileToContext(file, this.currentSession);
		}
		this.updateSessionHeader();
		this.updateSessionMetadata();
	}

	/**
	 * Add an attachment to the shelf
	 */
	private addAttachment(attachment: InlineAttachment): void {
		this.shelf.addBinaryAttachment(attachment);
	}

	/**
	 * Remove an attachment from the shelf
	 */
	private removeAttachment(id: string): void {
		this.shelf.removeItem(id);
	}

	/**
	 * Public method to show tool execution (delegates to tools component)
	 * Used by tests and external components
	 */
	async showToolExecution(toolName: string, parameters: any, executionId?: string): Promise<void> {
		// Lazy initialization for tests that don't call onOpen()
		if (!this.tools) {
			this.ensureToolsInitialized();
		}
		return this.tools.showToolExecution(toolName, parameters, executionId);
	}

	/**
	 * Public method to show tool result (delegates to tools component)
	 * Used by tests and external components
	 */
	async showToolResult(toolName: string, result: any, executionId?: string): Promise<void> {
		// Lazy initialization for tests that don't call onOpen()
		if (!this.tools) {
			this.ensureToolsInitialized();
		}
		return this.tools.showToolResult(toolName, result, executionId);
	}

	/**
	 * Ensure tools component is initialized (for lazy initialization in tests)
	 */
	private ensureToolsInitialized(): void {
		if (this.tools) return;

		if (!this.chatContainer) {
			throw new Error('Cannot initialize tools component: chatContainer is not set');
		}

		const toolsContext: ToolsContext = {
			getCurrentSession: () => this.currentSession,
			isCancellationRequested: () => this.cancellationRequested,
			updateProgress: (statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming') =>
				this.progress.update(statusText, state),
			hideProgress: () => this.progress.hide(),
			displayMessage: (entry: GeminiConversationEntry) => this.displayMessage(entry),
			incrementToolCallCount: (count: number) => {
				this.turnToolCallCount += count;
			},
		};

		this.tools = new AgentViewTools(this.chatContainer, this.plugin, toolsContext);
	}

	/**
	 * Updates the token usage display if the setting is enabled.
	 * Uses cached usageMetadata from the latest API response for fast, reliable updates.
	 * Falls back to countTokens API if no cached metadata is available.
	 */
	private async updateTokenUsage(): Promise<void> {
		if (!this.plugin.contextManager || !this.plugin.settings.showTokenUsage || !this.tokenUsageContainer) {
			if (this.tokenUsageContainer) {
				this.tokenUsageContainer.style.display = 'none';
			}
			return;
		}

		try {
			const modelName = this.currentSession?.modelConfig?.model || this.plugin.settings.chatModelName;
			let usage = await this.plugin.contextManager.getTokenUsage(modelName);

			// If no cached data, try counting from conversation history as fallback
			if (usage.estimatedTokens === 0 && this.currentSession) {
				const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
				if (conversationHistory && conversationHistory.length > 0) {
					this.plugin.logger.debug('[AgentView] No cached token usage, falling back to countTokens API');
					const tokenCount = await this.plugin.contextManager.countTokens(modelName, conversationHistory);
					if (tokenCount > 0) {
						this.plugin.contextManager.setUsageMetadata({
							promptTokenCount: tokenCount,
							totalTokenCount: tokenCount,
						});
						usage = await this.plugin.contextManager.getTokenUsage(modelName);
					}
				}
			}

			// Still no data (e.g., new session with no messages)
			if (usage.estimatedTokens === 0) {
				this.tokenUsageContainer.style.display = 'none';
				return;
			}

			this.tokenUsageContainer.style.display = '';
			this.tokenUsageContainer.empty();

			const tokenText = this.tokenUsageContainer.createSpan({ cls: 'gemini-agent-token-text' });
			const uncached = usage.estimatedTokens - usage.cachedTokens;
			if (usage.cachedTokens > 0) {
				tokenText.textContent = `Tokens: ~${usage.estimatedTokens.toLocaleString()} (${uncached.toLocaleString()} new) / ${usage.inputTokenLimit.toLocaleString()} (${usage.percentUsed}%)`;
			} else {
				tokenText.textContent = `Tokens: ~${usage.estimatedTokens.toLocaleString()} / ${usage.inputTokenLimit.toLocaleString()} (${usage.percentUsed}%)`;
			}

			// Add warning class if approaching threshold
			const threshold = this.plugin.settings.contextCompactionThreshold;
			if (usage.percentUsed >= threshold) {
				this.tokenUsageContainer.addClass('gemini-agent-token-usage-warning');
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-caution');
			} else if (usage.percentUsed >= threshold * 0.8) {
				this.tokenUsageContainer.addClass('gemini-agent-token-usage-caution');
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-warning');
			} else {
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-warning');
				this.tokenUsageContainer.removeClass('gemini-agent-token-usage-caution');
			}
		} catch (error) {
			this.plugin.logger.debug('[AgentView] Failed to update token usage:', error);
		}
	}

	/**
	 * Refreshes token usage by counting tokens from the stored session history.
	 * Used when loading/switching sessions where we don't have cached API metadata.
	 */
	private async refreshTokenUsageFromHistory(): Promise<void> {
		if (!this.plugin.contextManager || !this.plugin.settings.showTokenUsage || !this.currentSession) {
			await this.updateTokenUsage();
			return;
		}

		try {
			const modelName = this.currentSession?.modelConfig?.model || this.plugin.settings.chatModelName;
			const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			if (conversationHistory && conversationHistory.length > 0) {
				const tokenCount = await this.plugin.contextManager.countTokens(modelName, conversationHistory);
				if (tokenCount > 0) {
					this.plugin.contextManager.setUsageMetadata({
						promptTokenCount: tokenCount,
						totalTokenCount: tokenCount,
					});
				}
			}
		} catch (error) {
			this.plugin.logger.debug('[AgentView] Failed to refresh token usage from history:', error);
		}

		await this.updateTokenUsage();
	}

	async onClose() {
		// Cleanup event bus subscriptions
		this.session?.destroy();
		for (const unsub of this.eventBusUnsubscribers) {
			unsub();
		}
		this.eventBusUnsubscribers = [];

		// Cleanup components
		if (this.messages) {
			this.messages.cleanup();
		}
		if (this.progress) {
			this.progress.hide();
		}
	}
}
