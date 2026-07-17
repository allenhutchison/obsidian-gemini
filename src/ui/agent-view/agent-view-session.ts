import { App, Notice } from 'obsidian';
import { getActiveChatModel } from '../../models';
import { ChatSession } from '../../types/agent';
import { isSameSession } from './session-identity';
import { GeminiConversationEntry } from '../../types/conversation';
import type { ObsidianGemini } from '../../types/plugin';
import { ModelClientFactory } from '../../api';
import { HandlerPriority } from '../../types/agent-events';
import { sanitizeFileName } from '../../utils/file-utils';
import { isAlreadyExistsError, resolveUniquePath } from '../../services/headless-run-output';

/**
 * How many times the auto-label rename re-resolves a unique path after a
 * destination-exists collision before giving up (leaving the file un-renamed).
 */
const AUTO_LABEL_RENAME_ATTEMPTS = 3;
import { formatLocalDate } from '../../utils/format-utils';
import { t } from '../../i18n';

/**
 * Callbacks for UI operations that the session manager needs to trigger
 */
export interface SessionUICallbacks {
	/** Clear the chat container */
	clearChat: () => void;

	/** Display a message in the chat */
	displayMessage: (entry: GeminiConversationEntry) => Promise<void>;

	/** Update the session header UI */
	updateSessionHeader: () => void;

	/** Update the context panel UI */
	updateContextPanel: () => void;

	/** Show the empty state UI */
	showEmptyState: () => Promise<void>;

	/** Focus the input field */
	focusInput: () => void;
}

/**
 * Mutable state references that the session manager needs access to
 */
export interface SessionState {
	/** Reference to allowed tools set */
	allowedWithoutConfirmation: Set<string>;

	/** User input element */
	userInput: HTMLDivElement;
}

/**
 * Manages agent session lifecycle, loading, and metadata updates.
 * Extracted from AgentView to separate session management concerns.
 */
export class AgentViewSession {
	private currentSession: ChatSession | null = null;
	private unsubscribers: (() => void)[] = [];

	constructor(
		private app: App,
		private plugin: ObsidianGemini,
		private uiCallbacks: SessionUICallbacks,
		private state: SessionState
	) {
		// Auto-label sessions after each turn completes
		const unsub = this.plugin.agentEventBus?.on(
			'turnEnd',
			async () => {
				await this.autoLabelSessionIfNeeded();
			},
			HandlerPriority.INTERNAL
		);
		if (unsub) this.unsubscribers.push(unsub);
	}

	/**
	 * Unsubscribe from event bus handlers.
	 */
	destroy(): void {
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
	}

	/**
	 * Get the current session
	 */
	getCurrentSession(): ChatSession | null {
		return this.currentSession;
	}

	/**
	 * Set the current session (for loading from external sources)
	 */
	setCurrentSession(session: ChatSession | null) {
		this.currentSession = session;
	}

	/**
	 * Create a new agent session
	 */
	async createNewSession() {
		try {
			// Clear current session and UI state
			this.currentSession = null;
			this.uiCallbacks.clearChat();
			this.state.allowedWithoutConfirmation.clear(); // Clear session-level permissions
			// Clear input if it has content
			if (this.state.userInput) {
				this.state.userInput.innerHTML = '';
			}

			// Create new session with default context (no initial files)
			this.currentSession = await this.plugin.sessionManager.createAgentSession();

			// Update UI (no history to load for new session)
			this.uiCallbacks.updateSessionHeader();
			this.uiCallbacks.updateContextPanel();
			await this.uiCallbacks.showEmptyState();

			// Focus on input
			this.uiCallbacks.focusInput();
		} catch (error) {
			this.plugin.logger.error('Failed to create agent session:', error);
			new Notice(t('agent.session.createFailed'));
		}
	}

	/**
	 * Check if a session is the current session
	 * Compares both session ID and history path for robustness
	 */
	isCurrentSession(session: ChatSession): boolean {
		return isSameSession(session, this.currentSession);
	}

	/**
	 * Load session history and display messages
	 */
	async loadSessionHistory() {
		if (!this.currentSession) return;

		try {
			const history = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			this.uiCallbacks.clearChat();

			for (const entry of history) {
				await this.uiCallbacks.displayMessage(entry);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to load session history:', error);
		}
	}

	/**
	 * Update session metadata in the history file
	 */
	async updateSessionMetadata() {
		if (!this.currentSession) return;

		try {
			await this.plugin.sessionHistory.updateSessionMetadata(this.currentSession);
		} catch (error) {
			this.plugin.logger.error('Failed to update session metadata:', error);
		}
	}

	/**
	 * Update the session header UI
	 */
	updateSessionHeader() {
		this.uiCallbacks.updateSessionHeader();
	}

	/**
	 * Load an existing session
	 */
	async loadSession(session: ChatSession) {
		try {
			this.currentSession = session;
			this.state.allowedWithoutConfirmation.clear(); // Clear session-level permissions when loading from history

			// Clear chat and reload history
			this.uiCallbacks.clearChat();
			await this.loadSessionHistory();

			// Update UI
			this.uiCallbacks.updateSessionHeader();
			this.uiCallbacks.updateContextPanel();
		} catch (error) {
			this.plugin.logger.error('Failed to load session:', error);
			new Notice(t('agent.session.loadFailed'));
		}
	}

	/**
	 * Auto-label session after first complete turn if it still has default title.
	 * Triggered by the turnEnd event bus hook.
	 */
	async autoLabelSessionIfNeeded() {
		if (!this.currentSession) return;

		// Check if this is still using a default title
		if (
			!this.currentSession.title.startsWith('Agent Session') &&
			!this.currentSession.title.startsWith('New Agent Session')
		) {
			return; // Already has a custom title
		}

		// Check if we've already attempted to label this session
		if (this.currentSession.metadata?.autoLabeled) {
			return;
		}

		// Get the conversation history
		const history = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);

		// Need at least a user message and a model response
		const hasUserMessage = history.some((entry) => entry.role === 'user');
		const hasModelMessage = history.some((entry) => entry.role === 'model');
		if (!hasUserMessage || !hasModelMessage) return;

		try {
			// Build context for title generation — include the full first exchange
			const firstUserMsg = history.find((e) => e.role === 'user')?.message || '';
			const firstModelMsg = history.find((e) => e.role === 'model')?.message || '';
			// Truncate model response to avoid sending too much
			const modelSummary = firstModelMsg.length > 500 ? firstModelMsg.slice(0, 500) + '...' : firstModelMsg;

			const contextFiles = this.currentSession.context.contextFiles.map((f) => f.basename).join(', ');

			const titlePrompt = `Based on this conversation, suggest a concise title (max 40 characters) that captures the main topic or purpose. Return only the title text, no quotes or explanation.

${contextFiles ? `Context Files: ${contextFiles}\n` : ''}User: ${firstUserMsg}
Assistant: ${modelSummary}`;

			// Generate title using the model
			const modelApi = ModelClientFactory.createChatModel(this.plugin);
			const response = await modelApi.generateModelResponse({
				kind: 'extended',
				userMessage: titlePrompt,
				conversationHistory: [],
				model: getActiveChatModel(this.plugin.settings),
				prompt: titlePrompt,
				renderContent: false,
			});

			// Extract and sanitize the title
			let generatedTitle = response.markdown
				.trim()
				.replace(/^["']+/, '') // Remove leading quotes
				.replace(/["']+$/, '') // Remove trailing quotes
				.substring(0, 40); // Ensure max length

			if (generatedTitle && generatedTitle.length > 0) {
				// Prepend date for chronological sorting
				const datePrefix = formatLocalDate();
				const fullTitle = `${datePrefix} ${generatedTitle}`;

				// Update session title
				this.currentSession.title = fullTitle;

				// Mark session as auto-labeled to prevent multiple attempts
				if (!this.currentSession.metadata) {
					this.currentSession.metadata = {};
				}
				this.currentSession.metadata.autoLabeled = true;

				// Update history file name
				const oldPath = this.currentSession.historyPath;
				const newFileName = sanitizeFileName(fullTitle);
				const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newFileName + '.md';

				// Rename the history file. Skip when the generated name already matches
				// the current file, and resolve a numeric-suffixed path when another
				// session file already occupies the target — renameFile throws
				// "Destination file already exists!" otherwise. resolveUniquePath +
				// renameFile is non-atomic, so a concurrent writer can still occupy the
				// candidate between the check and the rename; retry on that specific
				// error (re-resolving each attempt), and give up gracefully after a few
				// collisions — the title is still applied, only the rename is skipped.
				const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
				if (oldFile && newPath !== oldPath) {
					for (let attempt = 0; attempt < AUTO_LABEL_RENAME_ATTEMPTS; attempt++) {
						const targetPath = resolveUniquePath(this.app.vault, newPath);
						try {
							await this.app.fileManager.renameFile(oldFile, targetPath);
							this.currentSession.historyPath = targetPath;
							break;
						} catch (renameError) {
							if (!isAlreadyExistsError(renameError)) throw renameError;
							if (attempt === AUTO_LABEL_RENAME_ATTEMPTS - 1) {
								this.plugin.logger.warn('Auto-label rename skipped after repeated collisions:', targetPath);
							}
						}
					}
				}

				// Update session metadata
				await this.updateSessionMetadata();

				// Update UI
				this.updateSessionHeader();

				this.plugin.logger.log(`Auto-labeled session: ${fullTitle}`);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to auto-label session:', error);
			// Don't show error to user - auto-labeling is a nice-to-have feature
		}
	}
}
