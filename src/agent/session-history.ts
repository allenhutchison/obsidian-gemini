import { TFile, normalizePath } from 'obsidian';
import { ChatSession, ChatMessage, ToolExecution } from '../types/agent';
import { GeminiConversationEntry } from '../types/conversation';
import type ObsidianGemini from '../main';
import * as Handlebars from 'handlebars';
// @ts-ignore
import historyEntryTemplate from '../history/templates/historyEntry.hbs';

/**
 * Handles history for agent sessions stored in Agent-Sessions/ folder
 */
export class SessionHistory {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private entryTemplate: Handlebars.TemplateDelegate;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		
		// Use the same template as regular history for consistency
		this.entryTemplate = Handlebars.compile(historyEntryTemplate);
	}

	/**
	 * Get history for an agent session
	 */
	async getHistoryForSession(session: ChatSession): Promise<GeminiConversationEntry[]> {
		if (!this.plugin.settings.chatHistory) return [];

		const historyPath = session.historyPath;
		let historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);

		if (!(historyFile instanceof TFile)) {
			// History file doesn't exist yet, return empty array
			return [];
		}

		try {
			const content = await this.plugin.app.vault.read(historyFile);
			return this.parseHistoryContent(content);
		} catch (error) {
			console.error(`Error reading agent session history from ${historyPath}:`, error);
			return [];
		}
	}

	/**
	 * Add an entry to agent session history
	 */
	async addEntryToSession(session: ChatSession, entry: GeminiConversationEntry): Promise<void> {
		if (!this.plugin.settings.chatHistory) return;

		const historyPath = session.historyPath;
		
		// Ensure the Agent-Sessions folder exists
		await this.ensureAgentSessionsFolder();

		let historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
		let existingContent = '';

		if (historyFile instanceof TFile) {
			// Read existing content
			try {
				existingContent = await this.plugin.app.vault.read(historyFile);
			} catch (error) {
				console.error(`Error reading existing history from ${historyPath}:`, error);
			}
		} else {
			// Create new file with session metadata
			existingContent = this.generateSessionFrontmatter(session);
		}

		// Generate the new entry content
		const entryContent = this.entryTemplate({
			role: entry.role,
			message: entry.message,
			content: entry.message, // The template might expect 'content' field
			timestamp: new Date().toISOString(),
			toolsUsed: [], // TODO: Add tool support later
			isDefined: (value: any) => value !== undefined
		});

		const newContent = existingContent + '\n' + entryContent;

		try {
			if (historyFile instanceof TFile) {
				// Update existing file
				await this.plugin.app.vault.modify(historyFile, newContent);
			} else {
				// Create new file
				await this.plugin.app.vault.create(historyPath, newContent);
			}

			// Update session's lastActive time
			session.lastActive = new Date();
		} catch (error) {
			console.error(`Error writing to agent session history ${historyPath}:`, error);
			throw error;
		}
	}

	/**
	 * Save session metadata to frontmatter
	 */
	async updateSessionMetadata(session: ChatSession): Promise<void> {
		if (!this.plugin.settings.chatHistory) return;

		const historyPath = session.historyPath;
		let historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);

		if (!(historyFile instanceof TFile)) {
			// File doesn't exist yet, create it with just frontmatter
			const content = this.generateSessionFrontmatter(session);
			await this.ensureAgentSessionsFolder();
			await this.plugin.app.vault.create(historyPath, content);
			return;
		}

		// Update existing file's frontmatter
		await this.plugin.app.fileManager.processFrontMatter(historyFile, (frontmatter: any) => {
			frontmatter.session_id = session.id;
			frontmatter.type = session.type;
			frontmatter.title = session.title;
			frontmatter.context_files = session.context.contextFiles.map(f => f.path);
			frontmatter.context_depth = session.context.contextDepth;
			frontmatter.enabled_tools = session.context.enabledTools;
			frontmatter.require_confirmation = session.context.requireConfirmation;
			frontmatter.created = session.created.toISOString();
			frontmatter.last_active = session.lastActive.toISOString();
			if (session.sourceNotePath) {
				frontmatter.source_note_path = session.sourceNotePath;
			}
		});
	}

	/**
	 * Delete session history file
	 */
	async deleteSessionHistory(session: ChatSession): Promise<void> {
		const historyPath = session.historyPath;
		const historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);

		if (historyFile instanceof TFile) {
			try {
				await this.plugin.app.vault.delete(historyFile);
			} catch (error) {
				console.error(`Error deleting session history ${historyPath}:`, error);
				throw error;
			}
		}
	}

	/**
	 * Get all agent session files for listing
	 */
	async getAllAgentSessions(): Promise<TFile[]> {
		const agentSessionsPath = this.getAgentSessionsFolderPath();
		
		try {
			const folder = this.plugin.app.vault.getAbstractFileByPath(agentSessionsPath);
			if (!folder || !('children' in folder)) return [];

			return (folder as any).children
				.filter((file: any): file is TFile => file instanceof TFile && file.extension === 'md')
				.sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime); // Most recent first
		} catch (error) {
			console.error(`Error listing agent sessions:`, error);
			return [];
		}
	}

	/**
	 * Parse history file content into conversation entries
	 */
	private parseHistoryContent(content: string): GeminiConversationEntry[] {
		const entries: GeminiConversationEntry[] = [];
		
		// Split content by frontmatter separator and entry separators
		const parts = content.split(/^---$/m);
		if (parts.length < 3) return entries; // No valid frontmatter structure

		// Skip frontmatter (parts[0] and parts[1])
		const historyContent = parts.slice(2).join('---');
		
		// Split by entry markers (look for role patterns)
		const entryRegex = /^## (User|Assistant|System)\s*$/gm;
		const entryParts = historyContent.split(entryRegex);
		
		// Process entries in pairs (role, content)
		for (let i = 1; i < entryParts.length; i += 2) {
			const roleName = entryParts[i].toLowerCase();
			// Map role names to existing conversation format
			const role = roleName === 'assistant' ? 'model' : (roleName as 'user' | 'model');
			const content = entryParts[i + 1]?.trim() || '';
			
			if (content && (role === 'user' || role === 'model')) {
				entries.push({
					role,
					message: content,
					notePath: '', // Will be set by the calling context
					created_at: new Date() // TODO: Parse timestamp from content if available
				});
			}
		}

		return entries;
	}

	/**
	 * Generate frontmatter for a new session file
	 */
	private generateSessionFrontmatter(session: ChatSession): string {
		const frontmatter = {
			session_id: session.id,
			type: session.type,
			title: session.title,
			context_files: session.context.contextFiles.map(f => f.path),
			context_depth: session.context.contextDepth,
			enabled_tools: session.context.enabledTools,
			require_confirmation: session.context.requireConfirmation,
			created: session.created.toISOString(),
			last_active: session.lastActive.toISOString(),
			...(session.sourceNotePath && { source_note_path: session.sourceNotePath })
		};

		return `---\n${Object.entries(frontmatter)
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join('\n')}\n---\n\n# ${session.title}\n\n`;
	}

	/**
	 * Ensure the Agent-Sessions folder exists
	 */
	private async ensureAgentSessionsFolder(): Promise<void> {
		const folderPath = this.getAgentSessionsFolderPath();
		
		const exists = await this.plugin.app.vault.adapter.exists(folderPath);
		if (!exists) {
			await this.plugin.app.vault.createFolder(folderPath);
		}
	}

	/**
	 * Get the Agent-Sessions folder path
	 */
	private getAgentSessionsFolderPath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/Agent-Sessions`);
	}
}