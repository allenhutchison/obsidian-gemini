import { Notice, setIcon, App } from 'obsidian';
import { getActiveChatModel } from '../../models';
import type { Content } from '@google/genai';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest, ModelApi, ModelResponse, StreamChunk } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { getErrorMessage } from '../../utils/error-utils';
import { formatLocalTimestamp } from '../../utils/format-utils';
import { buildTurnPreamble } from '../../utils/turn-preamble';
import { InlineAttachment } from './inline-attachment';
import planModeInstructionContent from '../../../prompts/planModeInstruction.hbs';
import { AgentViewProgress } from './agent-view-progress';
import { AgentViewMessages } from './agent-view-messages';
import { AgentViewTools } from './agent-view-tools';
import { AgentViewSession } from './agent-view-session';
import { AgentViewShelf } from './agent-view-shelf';
import type { ObsidianGemini } from '../../types/plugin';
import type { ConfirmationResult, DiffContext, Tool } from '../../tools/types';
import { t } from '../../i18n';

/**
 * Context interface for the send module.
 * Provides access to shared state and components owned by the orchestrator.
 */
export interface SendContext {
	plugin: ObsidianGemini;
	app: App;
	getCurrentSession: () => ChatSession | null;
	getShelf: () => AgentViewShelf;
	getUserInput: () => HTMLDivElement;
	getSendButton: () => HTMLButtonElement;
	getPlanModeButton: () => HTMLButtonElement;
	getChatContainer: () => HTMLElement;
	progress: AgentViewProgress;
	messages: AgentViewMessages;
	tools: AgentViewTools;
	session: AgentViewSession;
	displayMessage: (entry: GeminiConversationEntry) => Promise<void>;
	updateTokenUsage: () => Promise<void>;
	isToolAllowedWithoutConfirmation: (toolName: string) => boolean;
	allowToolWithoutConfirmation: (toolName: string) => void;
	showConfirmationInChat: (
		tool: Tool,
		parameters: Record<string, unknown>,
		executionId: string,
		diffContext?: DiffContext
	) => Promise<ConfirmationResult>;
}

/**
 * Handles message sending with streaming and non-streaming paths,
 * history management, model API calls, and tool execution loops.
 */
export class AgentViewSend {
	// Execution state owned by this module
	private currentStreamingResponse: { cancel: () => void } | null = null;
	private isExecuting = false;
	private turnToolCallCount = 0;
	private cancellationRequested = false;
	private isPlanModeActive = false;

	constructor(private ctx: SendContext) {}

	/**
	 * Register the in-flight follow-up stream (created inside AgentLoop) so the
	 * Stop button can cancel it mid-stream, mirroring how the initial request
	 * wires its own stream into `currentStreamingResponse`. Called with the stream
	 * when a streaming follow-up starts and with `null` once it settles.
	 */
	public setActiveStreamingResponse(stream: { cancel: () => void } | null): void {
		this.currentStreamingResponse = stream;
	}

	/**
	 * Toggle plan mode on/off. When active, the next send will ask the model to
	 * produce a plan first; the user approves or rejects before tools run.
	 */
	public togglePlanMode(): void {
		this.setPlanModeActive(!this.isPlanModeActive);
	}

	private setPlanModeActive(active: boolean): void {
		this.isPlanModeActive = active;
		const btn = this.ctx.getPlanModeButton();
		btn.toggleClass('gemini-agent-plan-btn-active', this.isPlanModeActive);
		btn.setAttribute('aria-pressed', String(this.isPlanModeActive));
		btn.setAttribute('aria-label', t('agent.planMode.toggleAria'));
	}

	/**
	 * Run the plan-only phase: call the model without tools, show approval UI,
	 * and on approval save the plan + proceed entries and return the augmented
	 * history so the caller can continue with a tool-enabled execute call.
	 *
	 * Returns null when the plan was rejected or could not be produced (caller
	 * should abort the turn). Returns the proceed message + updated history on
	 * approval so the caller can build the execute-phase request.
	 */
	private async conductPlanApproval(
		modelApi: ModelApi,
		baseRequest: ExtendedModelRequest,
		currentSession: ChatSession,
		compactedHistory: Content[]
	): Promise<{ proceedMessage: string; updatedHistory: Content[] } | null> {
		const planRequest: ExtendedModelRequest = {
			...baseRequest,
			availableTools: [],
			perTurnContext: (baseRequest.perTurnContext || '') + '\n\n' + planModeInstructionContent,
		};

		this.ctx.progress.update(t('agent.progress.thinking'), 'thinking');

		let planText = '';

		// Accumulate plan text without a streaming UI container — showPlanApproval
		// renders the final text with proper formatting and approval buttons.
		if (modelApi.generateStreamingResponse && this.ctx.plugin.settings.streamingEnabled !== false) {
			let accumulated = '';
			const stream = modelApi.generateStreamingResponse(planRequest, (chunk: StreamChunk) => {
				if (chunk.text) {
					accumulated += chunk.text;
				}
			});
			this.currentStreamingResponse = stream;
			const response = await stream.complete;
			this.currentStreamingResponse = null;
			planText = response.markdown || accumulated;
		} else {
			const response = await modelApi.generateModelResponse(planRequest);
			planText = response.markdown || '';
		}

		if (this.isCancellationRequested()) {
			this.ctx.progress.hide();
			return null;
		}

		this.ctx.progress.hide();

		if (!planText.trim()) {
			new Notice(t('agent.send.emptyResponse'));
			return null;
		}

		const approved = await this.ctx.messages.showPlanApproval(planText);
		if (this.isCancellationRequested()) return null;
		if (!approved) {
			new Notice(t('agent.planMode.rejectedNotice'));
			return null;
		}

		const planEntry: GeminiConversationEntry = {
			role: 'model',
			message: planText,
			notePath: '',
			created_at: new Date(),
			isPlan: true,
		};
		await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, planEntry);

		const proceedMessage = t('agent.planMode.proceedMessage');
		const proceedEntry: GeminiConversationEntry = {
			role: 'user',
			message: proceedMessage,
			notePath: '',
			created_at: new Date(),
		};
		await this.ctx.messages.displayMessage(proceedEntry, currentSession);
		await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, proceedEntry);

		const originalUserContent: Content = {
			role: 'user',
			parts: [{ text: baseRequest.userMessage }],
		};
		const planContent: Content = {
			role: 'model',
			parts: [{ text: planText }],
		};
		return {
			proceedMessage,
			updatedHistory: [...compactedHistory, originalUserContent, planContent],
		};
	}

	/**
	 * Main orchestration method for sending messages and handling tool calls
	 */
	async sendMessage(): Promise<void> {
		const currentSession = this.ctx.getCurrentSession();
		if (!currentSession) {
			new Notice(t('agent.view.noActiveSession'));
			return;
		}
		// Snapshot session so all hook emissions use the same reference
		// even if currentSession changes during async operations
		const turnSession = currentSession;

		const userInput = this.ctx.getUserInput();
		const shelf = this.ctx.getShelf();
		const sendButton = this.ctx.getSendButton();

		// Get message text directly from input (no chips to process)
		const rawMessage = userInput.innerText?.trim() || '';
		// Allow sending with only attachments (no text)
		const shelfTextFiles = shelf.getTextFiles();
		const attachments = shelf.getPendingAttachments();
		if (!rawMessage && shelfTextFiles.length === 0 && attachments.length === 0) return;

		// Prepend a per-turn time preamble. This is written into both the
		// outgoing model message and the persisted history entry so replay is
		// bit-identical. The UI render path strips it before display. Freezing
		// the timestamp here (rather than at write time) lets Gemini's implicit
		// prefix cache align across tool-loop iterations within the turn and
		// across session resumes.
		const turnTimestamp = new Date();
		const turnPreamble = buildTurnPreamble(formatLocalTimestamp(turnTimestamp));
		const message = turnPreamble + rawMessage;
		const formattedMessage = message;

		// Mark binary shelf items as sent
		shelf.markBinarySent();

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
				const path = await saveAttachmentToVault(this.ctx.app, attachment);
				attachment.vaultPath = path;
				savedAttachments.push({ attachment, path });
			} catch (err) {
				this.ctx.plugin.logger.error('Failed to save attachment to vault:', err);
				failedSaves.push(i + 1);
			}
		}

		// Notify user of any save failures (attachments will still be sent to AI)
		if (failedSaves.length > 0) {
			const failedList = failedSaves.join(', ');
			new Notice(
				failedSaves.length === 1
					? t('agent.attachments.saveFailedOne', { nums: failedList })
					: t('agent.attachments.saveFailed', { nums: failedList }),
				5000
			);
		}

		// Clear input
		userInput.innerHTML = '';

		// Set execution state and change button to "Stop"
		this.isExecuting = true;
		this.cancellationRequested = false;
		sendButton.empty();
		setIcon(sendButton, 'square');
		sendButton.addClass('gemini-agent-stop-btn');
		sendButton.disabled = false; // Re-enable so user can click stop
		sendButton.setAttribute('aria-label', t('agent.input.stopAria'));
		this.turnToolCallCount = 0;

		// Emit turnStart hook
		await this.ctx.plugin.agentEventBus?.emit('turnStart', {
			session: turnSession,
			userMessage: formattedMessage,
		});

		// Show progress bar
		this.ctx.progress.show(t('agent.progress.thinking'), 'thinking');

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
		await this.ctx.displayMessage(userEntry);

		try {
			// Get all context files from the shelf (persistent text files + folder contents)
			const allContextFiles = shelf.getTextFiles();

			// Snapshot pre-turn history BEFORE saving user message to avoid duplication
			const conversationHistory = await this.ctx.plugin.sessionHistory.getHistoryForSession(currentSession);

			// Save user message to history once, before the API call.
			// Tools use in-memory updatedHistory, not the file, so early save is safe.
			// Pass the frozen turn timestamp so the persisted `| Time |` row matches
			// the preamble the model saw — required for cache alignment on resume.
			await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, userEntry, turnTimestamp);

			// Build context for AI request including mentioned files
			const contextInfo = await this.ctx.plugin.gfile.buildFileContext(
				allContextFiles,
				true // renderContent
			);

			// Load custom prompt if session has one configured
			let customPrompt: CustomPrompt | undefined;
			if (currentSession?.modelConfig?.promptTemplate) {
				try {
					// Use the promptManager to robustly load the custom prompt
					const loadedPrompt = await this.ctx.plugin.promptManager.loadPromptFromFile(
						currentSession.modelConfig.promptTemplate
					);
					if (loadedPrompt) {
						customPrompt = loadedPrompt;
					} else {
						this.ctx.plugin.logger.warn(
							'Custom prompt file not found or failed to load:',
							currentSession.modelConfig.promptTemplate
						);
					}
				} catch (error) {
					this.ctx.plugin.logger.error('Error loading custom prompt:', error);
				}
			}

			// Load project instructions if session is linked to a project
			let projectInstructions: string | undefined;
			if (currentSession?.projectPath && this.ctx.plugin.projectManager) {
				try {
					const project = await this.ctx.plugin.projectManager.getProject(currentSession.projectPath);
					if (project?.instructions) {
						projectInstructions = project.instructions;
					}
				} catch (error) {
					this.ctx.plugin.logger.error('Error loading project instructions:', error);
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
			const activeProject = currentSession?.projectPath
				? await this.ctx.plugin.projectManager?.getProject(currentSession.projectPath)
				: null;

			const toolContext: ToolExecutionContext = {
				plugin: this.ctx.plugin,
				session: currentSession,
				projectRootPath: activeProject?.rootPath,
				featureToolPolicy: activeProject?.config.toolPolicy,
			};
			const availableTools = this.ctx.plugin.toolRegistry.getEnabledTools(toolContext);
			this.ctx.plugin.logger.log('Available tools from registry:', availableTools);
			this.ctx.plugin.logger.log('Number of tools:', availableTools.length);
			this.ctx.plugin.logger.log(
				'Tool names:',
				availableTools.map((t) => t.name)
			);

			try {
				// Get model config from session or use defaults
				const modelConfig = currentSession?.modelConfig || {};
				const modelName = modelConfig.model || getActiveChatModel(this.ctx.plugin.settings);

				// beginTurn() is now handled by the turnStart event bus subscriber

				// Prepare history through context manager (may compact if over threshold)
				const compactionResult = await this.ctx.plugin.contextManager.prepareHistory(conversationHistory, modelName);

				// If compaction occurred, show notification and save summary to transcript
				if (compactionResult.wasCompacted && compactionResult.summaryText) {
					// Force-set the lower post-compaction token count (bypasses high-water mark)
					this.ctx.plugin.contextManager.setUsageMetadata({
						promptTokenCount: compactionResult.estimatedTokens,
						totalTokenCount: compactionResult.estimatedTokens,
					});
					await this.ctx.updateTokenUsage();

					const compactionEntry: GeminiConversationEntry = {
						role: 'model',
						message: `> [!info] Context Compacted\n> Older conversation turns have been summarized to maintain performance.\n\n${compactionResult.summaryText}`,
						notePath: '',
						created_at: new Date(),
						model: modelName,
					};
					await this.ctx.displayMessage(compactionEntry);
					await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, compactionEntry);
					this.ctx.plugin.logger.log(
						`[AgentView] Context compacted: ${compactionResult.estimatedTokens} tokens remaining`
					);
				}

				// Per-turn fields that must stay byte-stable across the initial
				// model call AND every follow-up/retry inside the agent loop.
				// Threaded through to handleToolCalls below so the system prompt
				// rebuilt on each tool-loop iteration is identical to the one
				// the model saw on the initial call (correctness + cache).
				const perTurn = {
					perTurnContext: additionalInstructions,
					projectInstructions,
					projectSkills: activeProject?.config.skills,
					sessionStartedAt: formatLocalTimestamp(currentSession.created),
				};

				let request: ExtendedModelRequest = {
					kind: 'extended',
					userMessage: message,
					conversationHistory: compactionResult.compactedHistory,
					model: modelName,
					temperature: modelConfig.temperature ?? this.ctx.plugin.settings.temperature,
					topP: modelConfig.topP ?? this.ctx.plugin.settings.topP,
					prompt: '', // Unused in agent pipeline — perTurnContext carries context instead
					perTurnContext: perTurn.perTurnContext,
					customPrompt: customPrompt,
					projectInstructions: perTurn.projectInstructions,
					projectSkills: perTurn.projectSkills,
					renderContent: false, // We already rendered content above
					availableTools: availableTools,
					sessionStartedAt: perTurn.sessionStartedAt,
					inlineAttachments: attachments.map((a: InlineAttachment) => ({ base64: a.base64, mimeType: a.mimeType })),
				};

				// Create model API for this session
				const modelApi = AgentFactory.createAgentModel(this.ctx.plugin, currentSession);

				// Plan mode: ask for a plan first, await user approval, then execute with tools
				let messageToSend = message;
				let historyToSend = compactionResult.compactedHistory;
				if (this.isPlanModeActive) {
					let planResult: { proceedMessage: string; updatedHistory: Content[] } | null = null;
					try {
						planResult = await this.conductPlanApproval(
							modelApi,
							request,
							currentSession,
							compactionResult.compactedHistory
						);
					} finally {
						this.setPlanModeActive(false);
					}
					if (!planResult) {
						// Plan rejected or empty — abort this turn
						this.ctx.progress.hide();
						return;
					}
					messageToSend = planResult.proceedMessage;
					historyToSend = planResult.updatedHistory;
					request = { ...request, userMessage: messageToSend, conversationHistory: historyToSend };
				}

				// Check if streaming is supported and enabled
				if (modelApi.generateStreamingResponse && this.ctx.plugin.settings.streamingEnabled !== false) {
					// Use streaming API with tool support
					let modelMessageContainer: HTMLElement | null = null;
					let accumulatedMarkdown = '';
					let accumulatedThoughts = '';
					let progressUpdated = false;

					const streamResponse = modelApi.generateStreamingResponse(request, (chunk) => {
						// Handle thought content - show in progress bar
						if (chunk.thought) {
							const chunkPreview = chunk.thought.length > 100 ? chunk.thought.substring(0, 100) + '...' : chunk.thought;
							this.ctx.plugin.logger.debug(`[AgentView] Received thought chunk: ${chunkPreview}`);
							accumulatedThoughts += chunk.thought;

							// Update the expandable thinking section
							this.ctx.progress.updateThought(accumulatedThoughts);
						}

						// Handle text content
						if (chunk.text) {
							accumulatedMarkdown += chunk.text;

							// Update progress to streaming state when first text chunk arrives
							if (!progressUpdated) {
								this.ctx.progress.update(t('agent.progress.generating'), 'streaming');
								progressUpdated = true;
							}

							// Create or update the model message container
							if (!modelMessageContainer) {
								// First chunk - create the container
								modelMessageContainer = this.ctx.messages.createStreamingMessageContainer('model');
								// Fire-and-forget: async markdown render of the streamed chunk (unchanged behavior).
								void this.ctx.messages.updateStreamingMessage(modelMessageContainer, chunk.text);
							} else {
								// Update existing container with new chunk
								// Fire-and-forget: async markdown render of the streamed chunk (unchanged behavior).
								void this.ctx.messages.updateStreamingMessage(modelMessageContainer, chunk.text);
								// Use debounced scroll to avoid stuttering
								this.ctx.messages.debouncedScrollToBottom();
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
							await this.ctx.plugin.agentEventBus?.emit('apiResponseReceived', {
								usageMetadata: response.usageMetadata,
								modelName,
							});
						} else {
							this.ctx.plugin.logger.debug('[AgentView] Streaming response had no usageMetadata');
						}

						// Model reasoning for this turn — prefer the completed response's
						// thoughts; fall back to whatever streamed into the progress bar.
						const turnThoughts = response.thoughts?.trim()
							? response.thoughts
							: accumulatedThoughts.trim() || undefined;

						// Check if the model requested tool calls
						if (response.toolCalls && response.toolCalls.length > 0) {
							// User message already saved early in sendMessage()

							// If there was any streamed text before tool calls, finalize it
							const hadPartialText = !!(modelMessageContainer && accumulatedMarkdown.trim());
							if (hadPartialText) {
								const aiEntry: GeminiConversationEntry = {
									role: 'model',
									message: accumulatedMarkdown,
									notePath: '',
									created_at: new Date(),
									model: modelName,
									...(turnThoughts ? { thoughts: turnThoughts } : {}),
								};
								await this.ctx.messages.finalizeStreamingMessage(
									modelMessageContainer!,
									accumulatedMarkdown,
									aiEntry,
									currentSession
								);

								// Save partial response to history before executing tools
								await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);
							}

							// Pre-tool reasoning with no accompanying text is handed to the
							// tool handler, which renders it as the first row of the tool
							// group (interleaved with the tools) and persists it.
							await this.ctx.tools.handleToolCalls(
								response.toolCalls,
								messageToSend,
								historyToSend,
								userEntry,
								customPrompt,
								perTurn,
								hadPartialText ? undefined : turnThoughts
							);
						} else {
							// Normal response without tool calls — shared three-way finalize
							// with a streaming-specific render step: finalize the live
							// container for answer text (display the reasoning entry when
							// there's no answer), then scroll to the bottom.
							await this.finalizeNoToolCallResponse(
								response,
								turnThoughts,
								modelName,
								currentSession,
								async (entry, reasoningOnly) => {
									if (reasoningOnly) {
										await this.ctx.messages.displayMessage(entry, currentSession);
									} else if (modelMessageContainer) {
										// Finalize the streaming message with proper rendering
										await this.ctx.messages.finalizeStreamingMessage(
											modelMessageContainer,
											entry.message,
											entry,
											currentSession
										);
									}
									// Ensure we're scrolled to bottom after streaming completes
									this.ctx.messages.scrollToBottom();
								}
							);
						}
					} catch (error) {
						this.currentStreamingResponse = null;
						// Hide progress bar on error
						this.ctx.progress.hide();
						throw error;
					}
				} else {
					// Fall back to non-streaming API
					this.ctx.plugin.logger.log('Agent view using non-streaming API');
					const response = await modelApi.generateModelResponse(request);

					// Emit usage metadata via event bus (contextManager subscribes)
					if (response.usageMetadata) {
						await this.ctx.plugin.agentEventBus?.emit('apiResponseReceived', {
							usageMetadata: response.usageMetadata,
							modelName,
						});
					} else {
						this.ctx.plugin.logger.debug('[AgentView] Non-streaming response had no usageMetadata');
					}

					// Update progress to show response received
					this.ctx.progress.update(t('agent.progress.processing'), 'waiting');

					// Model reasoning for this turn (non-streaming exposes it directly).
					const turnThoughts = response.thoughts?.trim() ? response.thoughts : undefined;

					// Check if the model requested tool calls
					if (response.toolCalls && response.toolCalls.length > 0) {
						// Pre-tool reasoning is handed to the tool handler, which renders
						// it as the first row of the tool group and persists it.
						await this.ctx.tools.handleToolCalls(
							response.toolCalls,
							messageToSend,
							historyToSend,
							userEntry,
							customPrompt,
							perTurn,
							turnThoughts
						);
					} else {
						// Normal response without tool calls — shared three-way finalize
						// with the non-streaming render step (plain displayMessage, no
						// scroll) for both the answer and reasoning-only cases.
						await this.finalizeNoToolCallResponse(response, turnThoughts, modelName, currentSession, async (entry) => {
							await this.ctx.displayMessage(entry);
						});
					}
				}
			} catch (error) {
				// Hide progress bar on error
				this.ctx.progress.hide();
				throw error;
			}
		} catch (error) {
			this.ctx.plugin.logger.error('Failed to send message:', error);
			const errorMessage = getErrorMessage(error);
			new Notice(errorMessage, 8000); // Show for 8 seconds to give user time to read

			// Emit turnError hook
			await this.ctx.plugin.agentEventBus?.emit('turnError', {
				session: turnSession,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		} finally {
			// Always emit turnEnd so subscribers get a reliable cleanup signal
			await this.ctx.plugin.agentEventBus?.emit('turnEnd', {
				session: turnSession,
				toolCallCount: this.turnToolCallCount,
			});

			// Reset execution state and button (unless already reset by stopAgentLoop)
			// The check prevents redundant resets if user clicked stop
			if (this.isExecuting) {
				this.resetExecutionUiState();
			}

			// Always update token usage display after any message completion
			await this.ctx.updateTokenUsage();
		}
	}

	/**
	 * Finalize a normal (no-tool-call) model response. Shared by the streaming
	 * and non-streaming send paths, which previously duplicated this three-way
	 * branch. Owns the shared work — building the model entry, persisting it to
	 * session history, and hiding the progress bar — while the caller-supplied
	 * `renderEntry` step handles the one part that genuinely differs between the
	 * two paths: how the entry is rendered (and, for streaming, the extra scroll).
	 *
	 * `renderEntry` is invoked with `reasoningOnly = false` for an answer entry
	 * and `reasoningOnly = true` for a reasoning-only entry (no answer text).
	 */
	private async finalizeNoToolCallResponse(
		response: Pick<ModelResponse, 'markdown'>,
		turnThoughts: string | undefined,
		modelName: string,
		currentSession: ChatSession,
		renderEntry: (entry: GeminiConversationEntry, reasoningOnly: boolean) => Promise<void>
	): Promise<void> {
		// Only finalize and save if response has content
		if (response.markdown && response.markdown.trim()) {
			const aiEntry: GeminiConversationEntry = {
				role: 'model',
				message: response.markdown,
				notePath: '',
				created_at: new Date(),
				model: modelName,
				...(turnThoughts ? { thoughts: turnThoughts } : {}),
			};
			await renderEntry(aiEntry, false);
			// Save AI response to history (user message already saved early)
			await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);
			// Hide progress bar after successful response
			this.ctx.progress.hide();
		} else if (turnThoughts) {
			// No answer text, but the model did reason — show and persist the
			// reasoning instead of a bare "empty response" notice.
			const reasoningEntry: GeminiConversationEntry = {
				role: 'model',
				message: '',
				notePath: '',
				created_at: new Date(),
				model: modelName,
				thoughts: turnThoughts,
			};
			await renderEntry(reasoningEntry, true);
			await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, reasoningEntry);
			this.ctx.progress.hide();
		} else {
			// Empty response - might be thinking tokens.
			// User message already saved early in sendMessage().
			this.ctx.plugin.logger.warn('Model returned empty response');
			new Notice(t('agent.send.emptyResponse'));
			// Hide progress bar
			this.ctx.progress.hide();
		}
	}

	/**
	 * Stops the current agent execution loop
	 */
	stopAgentLoop(): void {
		this.ctx.plugin.logger.debug('[AgentView] stopAgentLoop called');

		if (!this.isExecuting) return;

		// Set cancellation flag
		this.cancellationRequested = true;

		// Cancel streaming response if active
		if (this.currentStreamingResponse) {
			this.ctx.plugin.logger.debug('[AgentView] Cancelling streaming response');
			this.currentStreamingResponse.cancel();
			this.currentStreamingResponse = null;
		}

		// Settle a pending plan approval so conductPlanApproval doesn't hang waiting
		// on the approval buttons after the user pressed Stop.
		this.ctx.messages.settlePendingPlanApproval(false);

		// Update UI immediately
		this.resetExecutionUiState();

		// Hide progress bar
		this.ctx.progress.hide();

		// Show cancellation notice
		new Notice(t('agent.send.cancelled'));
	}

	/**
	 * Resets execution UI state after completion or cancellation
	 */
	private resetExecutionUiState(): void {
		this.isExecuting = false;
		// Note: Don't reset cancellationRequested here - it needs to stay true
		// so that tool loops can see it. It's reset in sendMessage() when starting
		// a new execution.
		const sendButton = this.ctx.getSendButton();
		sendButton.disabled = false;
		sendButton.empty();
		setIcon(sendButton, 'play');
		sendButton.removeClass('gemini-agent-stop-btn');
		sendButton.setAttribute('aria-label', t('agent.input.sendAria'));
	}

	// Public getters for state the orchestrator needs to read
	getIsExecuting(): boolean {
		return this.isExecuting;
	}

	isCancellationRequested(): boolean {
		return this.cancellationRequested;
	}

	getTurnToolCallCount(): number {
		return this.turnToolCallCount;
	}

	incrementToolCallCount(count: number): void {
		this.turnToolCallCount += count;
	}
}
