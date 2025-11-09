import ObsidianGemini from '../main';
import { TFile } from 'obsidian';
import { GeminiConversationEntry } from '../types/conversation';
import { SessionHistory } from '../agent/session-history';
import { ChatSession } from '../types/agent';

/**
 * GeminiHistory - Manages agent session history (v4.0+)
 *
 * Note: This class now only handles agent sessions.
 * Note-based chat history has been removed in v4.0.
 */
export class GeminiHistory {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private sessionHistory: SessionHistory;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.sessionHistory = new SessionHistory(plugin);
	}

	async setupHistoryCommands() {
		if (!this.plugin.settings.chatHistory) {
			return;
		}
		// No commands needed - history is managed through agent view
	}

	async onLayoutReady() {
		// No setup needed for agent-only mode
	}

	async onUnload() {
		// No cleanup needed
	}

	/**
	 * Get history for an agent session
	 */
	async getHistoryForSession(session: ChatSession): Promise<GeminiConversationEntry[]> {
		return await this.sessionHistory.getHistoryForSession(session);
	}

	/**
	 * Add entry to agent session history
	 */
	async addEntryToSession(session: ChatSession, entry: GeminiConversationEntry): Promise<void> {
		await this.sessionHistory.addEntryToSession(session, entry);
	}

	/**
	 * Update session metadata in history file
	 */
	async updateSessionMetadata(session: ChatSession): Promise<void> {
		await this.sessionHistory.updateSessionMetadata(session);
	}

	/**
	 * Delete session history
	 */
	async deleteSessionHistory(session: ChatSession): Promise<void> {
		await this.sessionHistory.deleteSessionHistory(session);
	}

	/**
	 * Get all agent session files
	 */
	async getAllAgentSessions(): Promise<TFile[]> {
		return await this.sessionHistory.getAllAgentSessions();
	}
}
