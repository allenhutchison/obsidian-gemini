import { Notice, setIcon, App, TFile } from 'obsidian';
import type { TurnOutcome } from '../../types/agent-events';
import { pinSessionChatModel } from '../../models';
import type { Content } from '@google/genai';
import { ChatSession, type PerTurnContext, type SessionModelConfig } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { ToolExecutionContext } from '../../tools/types';
import { ExtendedModelRequest, ModelApi, ModelResponse, StreamChunk } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { getErrorMessage } from '../../utils/error-utils';
import { formatLocalTimestamp } from '../../utils/format-utils';
import { buildTurnPreamble } from '../../utils/turn-preamble';
import { InlineAttachment } from './inline-attachment';
import { buildCompactionEntry } from './compaction-notice';
import planModeInstructionContent from '../../../prompts/planModeInstruction.hbs';
import { AgentViewProgress } from './agent-view-progress';
import { AgentViewMessages } from './agent-view-messages';
import { AgentViewTools } from './agent-view-tools';
import type { TurnHandle } from './agent-view-tools';
import { AgentViewSession } from './agent-view-session';
import { AgentViewShelf } from './agent-view-shelf';
import type { ObsidianGemini } from '../../types/plugin';
import { t } from '../../i18n';
import { projectScopeStatement } from '../../tools/vault/utils';
import { mimeKind, type MimeKind } from '../../utils/file-classification';

/**
 * Label shown beside a non-image attachment in the sent message's
 * "Attachment Source" callout. Persisted into session history, so these stay
 * English rather than going through `t()`.
 */
const ATTACHMENT_LABEL_BY_MIME_KIND: Record<Exclude<MimeKind, 'image'>, string> = {
	audio: 'Audio',
	video: 'Video',
	pdf: 'PDF',
	other: 'Attachment',
};

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
	progress: AgentViewProgress;
	messages: AgentViewMessages;
	tools: AgentViewTools;
	session: AgentViewSession;
	displayMessage: (entry: GeminiConversationEntry) => Promise<void>;
	updateTokenUsage: () => Promise<void>;
}

/**
 * Load the project instructions for a session's linked project and fold in
 * the discovery-scope statement (#1506). The scope rule rides the
 * byte-stable `projectInstructions` PerTurnContext threading, so it reaches
 * the model on every model call — initial, follow-up, and retry — without
 * any new plumbing. A load error is swallowed (logged) so the system
 * instruction stays renderable, matching the old inline behavior.
 */
export async function loadProjectInstructions(
	plugin: ObsidianGemini,
	projectPath: string | undefined
): Promise<string | undefined> {
	if (!projectPath || !plugin.projectManager) return undefined;
	try {
		const project = await plugin.projectManager.getProject(projectPath);
		if (!project) return undefined;
		const scopeStatement = projectScopeStatement(project.rootPath);
		return project.instructions ? `${project.instructions}\n\n${scopeStatement}` : scopeStatement;
	} catch (error) {
		plugin.logger.error('Error loading project instructions:', error);
		return undefined;
	}
}

/**
 * Everything `dispatchResponse` needs to run one model turn: the request, the
 * byte-stable `perTurn` fields threaded through to `handleToolCalls`, the
 * resolved model API, and the turn-scoped message/history that plan mode may
 * have rewritten.
 */
interface TurnRequest {
	request: ExtendedModelRequest;
	messageToSend: string;
	historyToSend: Content[];
	perTurn: PerTurnContext;
	modelApi: ModelApi;
	modelName: string;
	/** The session model config snapshot `request` and `modelApi` were built from. */
	modelConfig: SessionModelConfig;
	customPrompt: CustomPrompt | undefined;
	/** True when plan mode rejected/emptied the plan — the turn ends silently. */
	aborted: boolean;
}

/**
 * Ownership token for one agent turn (#1787, #1790). Each turn gets its own,
 * so a stopped turn that is still unwinding only ever touches its own state.
 */
interface ActiveTurn {
	/** Set by Stop. Never cleared, so the stopped turn keeps seeing it. */
	cancelled: boolean;
	/** This turn's live stream, which Stop cancels. */
	stream: { cancel: () => void } | null;
	/** Tool calls executed in this turn, reported on `turnEnd`. */
	toolCallCount: number;
	/**
	 * How the turn's response handling ended, when it ended without throwing.
	 * Unset means no final answer was produced. Stop and a thrown error are
	 * read separately, in `turnOutcome`.
	 */
	result?: Exclude<TurnOutcome, 'cancelled'>;
}

/**
 * How `turn` ended, for its `turnEnd` event. Stop wins over everything, so a
 * stopped turn that also throws while unwinding still reads `cancelled`. A
 * turn that never recorded a result produced no final answer.
 */
function turnOutcome(turn: ActiveTurn, threw: boolean): TurnOutcome {
	if (turn.cancelled) return 'cancelled';
	if (threw) return 'failed';
	return turn.result ?? 'incomplete';
}

/**
 * Handles message sending with streaming and non-streaming paths,
 * history management, model API calls, and tool execution loops.
 */
export class AgentViewSend {
	/**
	 * The turn that currently owns the Send/Stop button, or `null` when idle.
	 * Stop clears it immediately while the stopped turn keeps unwinding, so a
	 * turn only resets shared state while it is still the owner (#1787, #1790).
	 */
	private activeTurn: ActiveTurn | null = null;
	/**
	 * The most recently started turn, kept after it ends so
	 * `isCancellationRequested()` still reports a stop to code that checks it
	 * after the button was reset.
	 */
	private lastTurn: ActiveTurn | null = null;
	private isPlanModeActive = false;

	constructor(private ctx: SendContext) {}

	/**
	 * Register the in-flight follow-up stream (created inside AgentLoop) so the
	 * Stop button can cancel it mid-stream, mirroring how the initial request
	 * wires its own stream into `currentStreamingResponse`. Called with the stream
	 * when a streaming follow-up starts and with `null` once it settles.
	 */
	public setActiveStreamingResponse(stream: { cancel: () => void } | null): void {
		if (this.activeTurn) this.activeTurn.stream = stream;
	}

	/**
	 * Hide the shared progress display for `turn`, unless a newer turn owns it
	 * now. A stopped turn unwinding after the next one started must not hide
	 * (and reset) that turn's progress.
	 */
	private hideProgressFor(turn: ActiveTurn): void {
		if (this.activeTurn === null || this.activeTurn === turn) this.ctx.progress.hide();
	}

	/**
	 * Build the per-turn handle the tool loop uses, bound to `turn` rather than
	 * to whichever turn is active when it is read.
	 */
	private turnHandle(turn: ActiveTurn): TurnHandle {
		return {
			isCancelled: () => turn.cancelled,
			countTool: (count) => {
				// Counts on the originating turn even after Stop released it, so a
				// late tool completion is never billed to the next turn.
				turn.toolCallCount += count;
			},
			hideProgress: () => this.hideProgressFor(turn),
			reportOutcome: (outcome) => {
				turn.result = outcome;
			},
			registerStream: (stream) => {
				if (stream) {
					// A stopped turn must not take back the Stop target.
					if (!turn.cancelled) turn.stream = stream;
				} else {
					turn.stream = null;
				}
			},
		};
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
		compactedHistory: Content[],
		turn: ActiveTurn
	): Promise<{ proceedMessage: string; updatedHistory: Content[] } | null> {
		// Stop can land during an await in assembleTurnRequest, before any stream
		// exists to cancel. Don't start the plan request for a stopped turn.
		if (turn.cancelled) return null;

		const planRequest: ExtendedModelRequest = {
			...baseRequest,
			availableTools: [],
			perTurnContext: (baseRequest.perTurnContext || '') + '\n\n' + planModeInstructionContent,
		};

		this.ctx.progress.update(t('agent.progress.thinking'), 'thinking');

		let planText = '';

		// Accumulate plan text without a streaming UI container — showPlanApproval
		// renders the final text with proper formatting and approval buttons.
		if (modelApi.generateStreamingResponse) {
			let accumulated = '';
			const stream = modelApi.generateStreamingResponse(planRequest, (chunk: StreamChunk) => {
				if (chunk.text) {
					accumulated += chunk.text;
				}
			});
			turn.stream = stream;
			const response = await stream.complete;
			if (turn.stream === stream) turn.stream = null;
			planText = response.markdown || accumulated;
		} else {
			const response = await modelApi.generateModelResponse(planRequest);
			planText = response.markdown || '';
		}

		if (turn.cancelled) {
			this.hideProgressFor(turn);
			return null;
		}

		this.ctx.progress.hide();

		if (!planText.trim()) {
			new Notice(t('agent.send.emptyResponse'));
			return null;
		}

		const approved = await this.ctx.messages.showPlanApproval(planText);
		if (turn.cancelled) return null;
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
	 * Persist dropped/pasted attachments to the vault, skipping any already saved
	 * (e.g. from drag-drop, which carry a `vaultPath`). Notifies the user of any
	 * save failures; failed attachments are omitted from the returned list but are
	 * still sent to the model as inline data by the caller.
	 *
	 * Extracted from `sendMessage` as the self-contained attachment-persistence
	 * phase (#1196) — a clear input → side-effect → returns-paths boundary. Pure
	 * code motion; call order relative to the surrounding send steps is unchanged.
	 *
	 * @param attachments The pending attachments to persist.
	 * @returns The successfully saved attachments paired with their vault paths.
	 */
	private async persistAttachments(
		attachments: InlineAttachment[]
	): Promise<Array<{ attachment: InlineAttachment; path: string }>> {
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

		return savedAttachments;
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

		// A session pinned to a provider the startup model list skipped needs that
		// provider's models loaded before its default model can resolve. This
		// await comes before the input is read, so everything below (the
		// empty-input check, the saved message, hook payloads) reads one value.
		const pinnedProvider = currentSession.modelConfig?.provider;
		if (pinnedProvider) await this.ctx.plugin.getModelManager().ensureProviderModels(pinnedProvider);

		const userInput = this.ctx.getUserInput();
		const shelf = this.ctx.getShelf();

		// Get message text directly from input (no chips to process)
		const rawMessage = userInput.innerText?.trim() || '';
		// Allow sending with only attachments (no text)
		const shelfTextFiles = shelf.getTextFiles();
		const attachments = shelf.getPendingAttachments();
		if (!rawMessage && shelfTextFiles.length === 0 && attachments.length === 0) return;

		// Snapshot the session's model config with the model and provider it
		// resolves to pinned in: the client, the model name, the tool loop's
		// follow-ups and every entry the turn saves come from this one value, even
		// if settings are saved while the turn is in flight.
		const modelConfig = pinSessionChatModel(this.ctx.plugin.settings, currentSession.modelConfig);
		// No model resolved (e.g. a provider whose model list hasn't loaded and
		// no model picked). Stop before the input is cleared, anything is saved
		// or a client is built: an empty request model makes each client re-read
		// the model from live settings, so the turn's requests could differ.
		if (!modelConfig.model) {
			new Notice(t('agent.send.noChatModel'));
			return;
		}

		// Capture and freeze the per-turn data, persist attachments, clear the input
		const { turnTimestamp, message, savedAttachments } = await this.captureTurnInput(userInput, attachments);

		// Set execution state, swap to Stop button, emit turnStart, show progress bar
		const turn = this.beginExecutionUi();

		// Emit turnStart hook
		await this.ctx.plugin.agentEventBus?.emit('turnStart', {
			session: turnSession,
			userMessage: message,
		});

		// Show progress bar
		this.ctx.progress.show(t('agent.progress.thinking'), 'thinking');

		// Build message with attachment previews for display
		const displayMessage = this.buildDisplayMessage(message, savedAttachments);

		// Display user message with formatted version (includes markdown links and images)
		const userEntry: GeminiConversationEntry = {
			role: 'user',
			message: displayMessage, // Use formatted message with images for display
			notePath: '',
			created_at: new Date(),
		};
		await this.ctx.displayMessage(userEntry);

		let threw = false;
		try {
			// Assemble the full turn request: history snapshot, context files, prompts,
			// compaction, and the model API for this session.
			const turnRequest = await this.assembleTurnRequest(
				turnSession,
				turnTimestamp,
				message,
				userEntry,
				shelfTextFiles,
				attachments,
				savedAttachments,
				turn,
				modelConfig
			);

			// Dispatch the response: streaming or non-streaming, with or without tool calls
			await this.dispatchResponse(turnRequest, turnSession, userEntry, turn);
		} catch (error) {
			threw = true;
			// Hide this turn's progress bar whether assembly or dispatch failed
			this.hideProgressFor(turn);
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
				toolCallCount: turn.toolCallCount,
				outcome: turnOutcome(turn, threw),
				// As typed: hook prompts quote it, so leave out the date preamble
				// the model sees.
				userMessage: rawMessage,
			});

			// Reset execution state and button only while this turn still owns
			// them. After Stop, a newer turn may already be running; resetting
			// here would strand it without a working Stop button (#1787, #1790).
			if (this.activeTurn === turn) {
				this.activeTurn = null;
				this.resetExecutionUiState();
			}

			// Always update token usage display after any message completion
			await this.ctx.updateTokenUsage();
		}
	}

	/**
	 * Capture and freeze the per-turn data: the frozen turn timestamp and time
	 * preamble, the outgoing message text, and the persisted attachments. Also
	 * clears the input.
	 *
	 * The frozen turn timestamp and preamble must NOT be split from their
	 * consumers: the timestamp is threaded to `addEntryToSession` so the
	 * persisted `| Time |` row matches the preamble the model saw, and the
	 * preamble rides the message text into the outgoing request. Freezing here
	 * (rather than at write time) keeps Gemini's implicit prefix cache aligned
	 * across tool-loop iterations within the turn and across session resumes.
	 * Written into both the outgoing model message and the persisted history
	 * entry so replay is bit-identical; the UI render path strips it.
	 *
	 * @returns The frozen timestamp, the preamble-prefixed message, and the
	 *   successfully persisted attachments.
	 */
	private async captureTurnInput(
		userInput: HTMLDivElement,
		attachments: InlineAttachment[]
	): Promise<{
		turnTimestamp: Date;
		message: string;
		savedAttachments: Array<{ attachment: InlineAttachment; path: string }>;
	}> {
		const rawMessage = userInput.innerText?.trim() || '';

		// Prepend a per-turn time preamble. This is written into both the
		// outgoing model message and the persisted history entry so replay is
		// bit-identical. The UI render path strips it before display. Freezing
		// the timestamp here (rather than at write time) lets Gemini's implicit
		// prefix cache align across tool-loop iterations within the turn and
		// across session resumes.
		const turnTimestamp = new Date();
		const turnPreamble = buildTurnPreamble(formatLocalTimestamp(turnTimestamp));
		const message = turnPreamble + rawMessage;

		// Mark binary shelf items as sent
		this.ctx.getShelf().markBinarySent();

		// Save attachments to vault (skip those already saved, e.g. from drag-drop)
		const savedAttachments = await this.persistAttachments(attachments);

		// Clear input
		userInput.innerHTML = '';

		return { turnTimestamp, message, savedAttachments };
	}

	/**
	 * Start a new turn: take ownership of the execution state and transition the
	 * send button to "Stop". Called once per turn, after the turn input has been
	 * captured.
	 *
	 * If another turn still owns the button (a programmatic send, or Enter while
	 * a turn waits on a tool confirmation), that turn is stopped first, which
	 * also settles its pending Allow card as cancelled instead of orphaning it
	 * (#1780).
	 *
	 * @returns The new turn's ownership token.
	 */
	private beginExecutionUi(): ActiveTurn {
		if (this.activeTurn) {
			this.stopAgentLoop();
		}
		const turn: ActiveTurn = { cancelled: false, stream: null, toolCallCount: 0, result: undefined };
		this.activeTurn = turn;
		this.lastTurn = turn;
		const sendButton = this.ctx.getSendButton();
		sendButton.empty();
		setIcon(sendButton, 'square');
		sendButton.addClass('gemini-agent-stop-btn');
		sendButton.disabled = false; // Re-enable so user can click stop
		sendButton.setAttribute('aria-label', t('agent.input.stopAria'));
		return turn;
	}

	/**
	 * Build the display message with attachment previews. The display copy
	 * appends image embeds and attachment-source callouts to the preamble-
	 * prefixed message; the model-facing text stays unpolluted.
	 *
	 * @param message The preamble-prefixed outgoing message.
	 * @param savedAttachments The successfully persisted attachments.
	 * @returns The display message, with previews appended when attachments exist.
	 */
	private buildDisplayMessage(
		message: string,
		savedAttachments: Array<{ attachment: InlineAttachment; path: string }>
	): string {
		if (savedAttachments.length === 0) return message;

		const imagePaths: string[] = [];
		const otherPaths: { path: string; label: string }[] = [];

		for (const { attachment, path } of savedAttachments) {
			const kind = mimeKind(attachment.mimeType);
			if (kind === 'image') {
				imagePaths.push(path);
			} else {
				otherPaths.push({ path, label: ATTACHMENT_LABEL_BY_MIME_KIND[kind] });
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
			return message + '\n\n' + parts.join('\n\n');
		}
		return message;
	}

	/**
	 * Assemble the full turn request: history snapshot, user entry persistence,
	 * context files, prompts, compaction, plan-mode approval, and the model API.
	 *
	 * Returns the `TurnRequest` consumed by `dispatchResponse`. The frozen turn
	 * timestamp is threaded into `addEntryToSession` here so the persisted
	 * `| Time |` row matches the preamble the model saw (cache alignment on
	 * resume); it must stay paired with `captureTurnInput`'s freeze.
	 */
	private async assembleTurnRequest(
		currentSession: ChatSession,
		turnTimestamp: Date,
		message: string,
		userEntry: GeminiConversationEntry,
		shelfTextFiles: TFile[],
		attachments: InlineAttachment[],
		savedAttachments: Array<{ attachment: InlineAttachment; path: string }>,
		turn: ActiveTurn,
		modelConfig: SessionModelConfig & { model: string }
	): Promise<TurnRequest> {
		const modelName = modelConfig.model;

		// Snapshot pre-turn history BEFORE saving user message to avoid duplication
		const conversationHistory = await this.ctx.plugin.sessionHistory.getHistoryForSession(currentSession);

		// Save user message to history once, before the API call.
		// Tools use in-memory updatedHistory, not the file, so early save is safe.
		// Pass the frozen turn timestamp so the persisted `| Time |` row matches
		// the preamble the model saw — required for cache alignment on resume.
		await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, userEntry, turnTimestamp);

		// Get all context files from the shelf (persistent text files + folder contents)
		const allContextFiles = shelfTextFiles;

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
		// Load project instructions if session is linked to a project. The
		// discovery-scope statement (#1506) is folded in so it rides the
		// byte-stable `projectInstructions` PerTurnContext threading — the
		// scope rule reaches the model on every model call for free.
		const projectInstructions = await loadProjectInstructions(this.ctx.plugin, currentSession?.projectPath);

		// Build the per-turn context notes (context files, attachments, rendered content)
		const additionalInstructions = this.buildAdditionalInstructions(shelfTextFiles, savedAttachments, contextInfo);

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
		// Log names, not the tool objects: the bundle minifies class names, so the
		// objects print as unreadable `e {…}` entries.
		this.ctx.plugin.logger.log(
			`Available tools from registry (${availableTools.length}):`,
			availableTools.map((t) => t.name)
		);

		// beginTurn() is now handled by the turnStart event bus subscriber

		// Prepare history through context manager (may compact if over threshold)
		const compactionResult = await this.ctx.plugin.contextManager.prepareHistory(conversationHistory, modelName);

		// If compaction occurred, show notification and save summary to transcript
		if (compactionResult.wasCompacted && compactionResult.summaryText) {
			// prepareHistory already revised the cached usage (#1699); refresh the readout.
			await this.ctx.updateTokenUsage();

			const compactionEntry = buildCompactionEntry(compactionResult.summaryText, modelName);
			await this.ctx.displayMessage(compactionEntry);
			await this.ctx.plugin.sessionHistory.addEntryToSession(currentSession, compactionEntry);
			this.ctx.plugin.logger.log(`[AgentView] Context compacted: ${compactionResult.estimatedTokens} tokens remaining`);
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

		const request: ExtendedModelRequest = {
			kind: 'extended',
			userMessage: message,
			conversationHistory: compactionResult.compactedHistory,
			model: modelName,
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
		const modelApi = AgentFactory.createAgentModel(this.ctx.plugin, currentSession, modelConfig);

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
					compactionResult.compactedHistory,
					turn
				);
			} finally {
				this.setPlanModeActive(false);
			}
			if (!planResult) {
				// Plan rejected or empty — abort this turn
				this.hideProgressFor(turn);
				return {
					request,
					messageToSend: message,
					historyToSend: compactionResult.compactedHistory,
					perTurn,
					modelApi,
					modelName,
					modelConfig,
					customPrompt,
					aborted: true,
				};
			}
			messageToSend = planResult.proceedMessage;
			historyToSend = planResult.updatedHistory;
			const updatedRequest = { ...request, userMessage: messageToSend, conversationHistory: historyToSend };
			return {
				request: updatedRequest,
				messageToSend,
				historyToSend,
				perTurn,
				modelApi,
				modelName,
				modelConfig,
				customPrompt,
				aborted: false,
			};
		}

		return {
			request,
			messageToSend,
			historyToSend,
			perTurn,
			modelApi,
			modelName,
			modelConfig,
			customPrompt,
			aborted: false,
		};
	}

	/**
	 * Build the per-turn context notes appended to the system instruction:
	 * context files from the shelf, persisted attachment paths, and rendered
	 * file contents.
	 */
	private buildAdditionalInstructions(
		shelfTextFiles: TFile[],
		savedAttachments: Array<{ attachment: InlineAttachment; path: string }>,
		contextInfo: string | null
	): string {
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

		return additionalInstructions;
	}

	/**
	 * Dispatch the assembled turn request to the model: streaming when the
	 * provider client supports it, non-streaming otherwise; route to
	 * `handleToolCalls` or the no-tool-call finalize in both arms.
	 *
	 * The `perTurn` fields must stay byte-stable across the initial model call
	 * and every follow-up/retry inside the agent loop — threaded through to
	 * `handleToolCalls` so the system prompt rebuilt on each tool-loop iteration
	 * is identical to the one the model saw on the initial call (correctness +
	 * cache).
	 */
	private async dispatchResponse(
		turnRequest: TurnRequest,
		currentSession: ChatSession,
		userEntry: GeminiConversationEntry,
		turn: ActiveTurn
	): Promise<void> {
		if (turnRequest.aborted) return;

		const { request, messageToSend, historyToSend, perTurn, modelApi, modelName, modelConfig, customPrompt } =
			turnRequest;

		// Streaming is always used when the provider client supports it.
		if (modelApi.generateStreamingResponse) {
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

			// Store the streaming response for potential cancellation. If Stop
			// already ran while the request was being assembled, cancel at once.
			turn.stream = streamResponse;
			if (turn.cancelled) streamResponse.cancel();

			try {
				const response = await streamResponse.complete;
				if (turn.stream === streamResponse) turn.stream = null;

				await this.emitUsageMetadata(response, modelName, 'Streaming');

				// Model reasoning for this turn — prefer the completed response's
				// thoughts; fall back to whatever streamed into the progress bar.
				const turnThoughts = response.thoughts?.trim() ? response.thoughts : accumulatedThoughts.trim() || undefined;

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
						hadPartialText ? undefined : turnThoughts,
						this.turnHandle(turn),
						modelConfig
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
						},
						turn
					);
				}
			} catch (error) {
				if (turn.stream === streamResponse) turn.stream = null;
				// Hide progress bar on error
				this.hideProgressFor(turn);
				throw error;
			}
		} else {
			// Fall back to non-streaming API
			this.ctx.plugin.logger.log('Agent view using non-streaming API');
			const response = await modelApi.generateModelResponse(request);

			await this.emitUsageMetadata(response, modelName, 'Non-streaming');

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
					turnThoughts,
					this.turnHandle(turn),
					modelConfig
				);
			} else {
				// Normal response without tool calls — shared three-way finalize
				// with the non-streaming render step (plain displayMessage, no
				// scroll) for both the answer and reasoning-only cases.
				await this.finalizeNoToolCallResponse(
					response,
					turnThoughts,
					modelName,
					currentSession,
					async (entry) => {
						await this.ctx.displayMessage(entry);
					},
					turn
				);
			}
		}
	}

	/**
	 * Publish a model response's usage metadata on the event bus (contextManager
	 * subscribes) so the token display reflects the turn. Shared by the streaming
	 * and non-streaming send paths, which previously carried the same eight-line
	 * emit-or-debug-log block with only the log prefix differing.
	 *
	 * `pathLabel` names the send path in the debug log ('Streaming' /
	 * 'Non-streaming'); it is logger output, so it stays English per the i18n rule
	 * in `.claude/guidelines/coding.md`.
	 */
	private async emitUsageMetadata(
		response: Pick<ModelResponse, 'usageMetadata'>,
		modelName: string,
		pathLabel: string
	): Promise<void> {
		if (response.usageMetadata) {
			await this.ctx.plugin.agentEventBus?.emit('apiResponseReceived', {
				usageMetadata: response.usageMetadata,
				modelName,
			});
		} else {
			this.ctx.plugin.logger.debug(`[AgentView] ${pathLabel} response had no usageMetadata`);
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
		renderEntry: (entry: GeminiConversationEntry, reasoningOnly: boolean) => Promise<void>,
		turn?: ActiveTurn
	): Promise<void> {
		// Without a turn (unit callers) this behaves as the sole, uncancelled turn.
		const hideProgress = () => (turn ? this.hideProgressFor(turn) : this.ctx.progress.hide());
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
			if (turn) turn.result = 'complete';
			// Hide progress bar after successful response
			hideProgress();
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
			hideProgress();
		} else if (turn?.cancelled) {
			// A stopped stream settles with no text. That's the Stop, not an
			// empty model reply, so don't add a second notice beside
			// "Agent execution canceled" (#1790).
			hideProgress();
		} else {
			// Empty response - might be thinking tokens.
			// User message already saved early in sendMessage().
			this.ctx.plugin.logger.warn('Model returned empty response');
			new Notice(t('agent.send.emptyResponse'));
			// Hide progress bar
			hideProgress();
		}
	}

	/**
	 * Stops the current agent execution loop
	 */
	stopAgentLoop(): void {
		this.ctx.plugin.logger.debug('[AgentView] stopAgentLoop called');

		const turn = this.activeTurn;
		if (!turn) return;

		// Mark this turn cancelled. The flag lives on the turn, so a later turn
		// starting doesn't clear it while this one unwinds.
		turn.cancelled = true;

		// Cancel streaming response if active
		if (turn.stream) {
			this.ctx.plugin.logger.debug('[AgentView] Cancelling streaming response');
			turn.stream.cancel();
			turn.stream = null;
		}

		// Settle a pending plan approval so conductPlanApproval doesn't hang waiting
		// on the approval buttons after the user pressed Stop.
		this.ctx.messages.settlePendingPlanApproval(false);
		// Likewise settle any pending tool-permission card as cancelled, so it
		// doesn't stay on screen offering an Allow that resumes nothing (#1780).
		this.ctx.messages.settlePendingConfirmations();

		// Release ownership and update UI immediately
		this.activeTurn = null;
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
		const sendButton = this.ctx.getSendButton();
		sendButton.disabled = false;
		sendButton.empty();
		setIcon(sendButton, 'play');
		sendButton.removeClass('gemini-agent-stop-btn');
		sendButton.setAttribute('aria-label', t('agent.input.sendAria'));
	}

	// Public getters for state the orchestrator needs to read
	getIsExecuting(): boolean {
		return this.activeTurn !== null;
	}

	/** Whether the most recently started turn was stopped. */
	isCancellationRequested(): boolean {
		return this.lastTurn?.cancelled ?? false;
	}

	incrementToolCallCount(count: number): void {
		if (this.activeTurn) this.activeTurn.toolCallCount += count;
	}
}
