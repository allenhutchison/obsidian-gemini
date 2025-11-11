import { App, TFile, Notice } from 'obsidian';
import { ChatSession, SessionType } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import type ObsidianGemini from '../../main';
import { GeminiClientFactory } from '../../api/simple-factory';

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

	/** Add active file to context if available */
	addActiveFileToContext: () => Promise<void>;

	/** Focus the input field */
	focusInput: () => void;
}

/**
 * Mutable state references that the session manager needs access to
 */
export interface SessionState {
	/** Reference to mentioned files array */
	mentionedFiles: TFile[];

	/** Reference to allowed tools set */
	allowedWithoutConfirmation: Set<string>;

	/** Reference to auto-added file tracking (using object wrapper for mutability) */
	autoAddedActiveFile: { value: TFile | null };

	/** User input element */
	userInput: HTMLDivElement;
}

/**
 * Manages agent session lifecycle, loading, and metadata updates.
 * Extracted from AgentView to separate session management concerns.
 */
export class AgentViewSession {
	private currentSession: ChatSession | null = null;

	constructor(
		private app: App,
		private plugin: ObsidianGemini,
		private uiCallbacks: SessionUICallbacks,
		private state: SessionState
	) {}

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
			this.state.mentionedFiles.length = 0; // Clear any mentioned files from previous session
			this.state.allowedWithoutConfirmation.clear(); // Clear session-level permissions
			this.state.autoAddedActiveFile.value = null; // Clear auto-added file tracking

			// Clear input if it has content
			if (this.state.userInput) {
				this.state.userInput.innerHTML = '';
			}

			// Create new session with default context (no initial files)
			this.currentSession = await this.plugin.sessionManager.createAgentSession();

			// Add active file to context if there is one
			await this.uiCallbacks.addActiveFileToContext();

			// Update UI (no history to load for new session)
			this.uiCallbacks.updateSessionHeader();
			this.uiCallbacks.updateContextPanel();
			await this.uiCallbacks.showEmptyState();

			// Focus on input
			this.uiCallbacks.focusInput();
		} catch (error) {
			this.plugin.logger.error('Failed to create agent session:', error);
			new Notice('Failed to create agent session');
		}
	}

	/**
	 * Check if a session is the current session
	 * Compares both session ID and history path for robustness
	 */
	isCurrentSession(session: ChatSession): boolean {
		if (!this.currentSession) return false;
		return session.id === this.currentSession.id ||
		       session.historyPath === this.currentSession.historyPath;
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
			this.state.autoAddedActiveFile.value = null; // Clear auto-added file tracking when loading a session

			// Clear chat and reload history
			this.uiCallbacks.clearChat();
			await this.loadSessionHistory();

			// Update UI
			this.uiCallbacks.updateSessionHeader();
			this.uiCallbacks.updateContextPanel();
		} catch (error) {
			this.plugin.logger.error('Failed to load session:', error);
			new Notice('Failed to load session');
		}
	}

	/**
	 * Auto-label session after first exchange if it still has default title
	 */
	async autoLabelSessionIfNeeded() {
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
					.replace(/^["']+/, '') // Remove leading quotes
				.replace(/["']+$/, '') // Remove trailing quotes
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
					const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile) {
						await this.app.fileManager.renameFile(oldFile, newPath);
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
}
