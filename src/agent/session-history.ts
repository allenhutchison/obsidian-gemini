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

		// Register Handlebars helpers (same as in markdownHistory)
		Handlebars.registerHelper('eq', function (a, b) {
			return a === b;
		});

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
			return this.parseHistoryContent(content, historyFile);
		} catch (error) {
			this.plugin.logger.error(`Error reading agent session history from ${historyPath}:`, error);
			return [];
		}
	}

	/**
	 * Add an entry to agent session history
	 */
	async addEntryToSession(session: ChatSession, entry: GeminiConversationEntry): Promise<void> {
		if (!this.plugin.settings.chatHistory) return;

		const historyPath = session.historyPath;

		let historyFile: TFile;
		const existingFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);

		// Create file if it doesn't exist
		if (existingFile instanceof TFile) {
			historyFile = existingFile;
		} else {
			historyFile = await this.createNewSessionFile(session);
		}

		// Read existing content
		let existingContent: string;
		try {
			existingContent = await this.plugin.app.vault.read(historyFile);
		} catch (error) {
			this.plugin.logger.error(`Error reading existing history from ${historyPath}:`, error);
			throw error; // Don't proceed if we can't read the file safely
		}

		// Generate the new entry content
		const role = entry.role.charAt(0).toUpperCase() + entry.role.slice(1);
		const messageLines = entry.message.split('\n');

		const entryContent = this.entryTemplate({
			role: role,
			messageLines: messageLines,
			timestamp: new Date().toISOString(),
			pluginVersion: this.plugin.manifest.version,
			fileVersion: 'unknown', // TODO: Get file version from context
			model: entry.model,
			temperature: entry.metadata?.temperature,
			topP: entry.metadata?.topP,
			customPrompt: entry.metadata?.customPrompt,
			toolsUsed: [], // TODO: Add tool support later
			isDefined: (value: any) => value !== undefined,
		});

		const newContent = existingContent + '\n' + entryContent;

		try {
			// File is guaranteed to exist at this point
			await this.plugin.app.vault.modify(historyFile, newContent);

			// Update session's lastActive time
			session.lastActive = new Date();
		} catch (error) {
			this.plugin.logger.error(`Error writing to agent session history ${historyPath}:`, error);
			throw error;
		}
	}

	/**
	 * Save session metadata to frontmatter
	 */
	async updateSessionMetadata(session: ChatSession): Promise<void> {
		if (!this.plugin.settings.chatHistory) return;

		const historyPath = session.historyPath;
		const existingFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);

		if (!(existingFile instanceof TFile)) {
			// File doesn't exist yet, create it with frontmatter
			await this.createNewSessionFile(session);
			return;
		}

		// Update existing file's frontmatter using the shared method
		await this.applySessionFrontmatter(existingFile, session);
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
				this.plugin.logger.error(`Error deleting session history ${historyPath}:`, error);
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
			this.plugin.logger.error(`Error listing agent sessions:`, error);
			return [];
		}
	}

	/**
	 * Parse history file content into conversation entries
	 */
	private parseHistoryContent(content: string, file: TFile): GeminiConversationEntry[] {
		const entries: GeminiConversationEntry[] = [];

		// Use metadata cache to find where frontmatter ends
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		let contentAfterFrontmatter = content;

		if (cache?.frontmatterPosition) {
			contentAfterFrontmatter = content.slice(cache.frontmatterPosition.end.offset);
		}

		// Split remaining content by entry separator (---)
		const entrySeparator = /^---\s*$/m;
		const contentSections = contentAfterFrontmatter.split(entrySeparator);

		for (const section of contentSections) {
			if (!section.trim()) continue;

			// Look for role header (## User or ## Assistant)
			const roleMatch = section.match(/^## (User|Assistant|Model)\s*$/m);
			if (!roleMatch) continue;

			const roleName = roleMatch[1].toLowerCase();
			const role = roleName === 'assistant' ? 'model' : roleName === 'model' ? 'model' : 'user';

			// Extract message content from callout blocks
			// Look for > [!user]+ or > [!assistant]+ blocks
			const calloutRegex = /^> \[!(user|assistant)\]\+\s*$/m;
			const calloutMatch = section.match(calloutRegex);

			if (calloutMatch) {
				// Extract lines after the callout marker
				const lines = section.split('\n');
				const calloutIndex = lines.findIndex((line) => calloutRegex.test(line));

				if (calloutIndex !== -1) {
					const messageLines: string[] = [];
					let inMessage = false;

					for (let i = calloutIndex + 1; i < lines.length; i++) {
						const line = lines[i];

						// Stop at metadata blocks or empty lines after content
						if (line.startsWith('> [!metadata]') || (messageLines.length > 0 && !line.startsWith('>'))) {
							break;
						}

						// Extract content from quoted lines
						if (line.startsWith('> ')) {
							messageLines.push(line.substring(2));
							inMessage = true;
						} else if (inMessage) {
							// Stop if we hit a non-quoted line after starting
							break;
						}
					}

					const message = messageLines.join('\n').trim();

					if (message) {
						// Extract timestamp from metadata if available
						const timeMatch = section.match(/\| Time \| ([^|]+) \|/);
						const timestamp = timeMatch ? new Date(timeMatch[1].trim()) : new Date();

						// Extract model info if available
						const modelMatch = section.match(/\| Model \| ([^|]+) \|/);
						const model = modelMatch ? modelMatch[1].trim() : undefined;

						// Check for tool execution info
						const toolNameMatch = section.match(/\*\*Tool:\*\* `([^`]+)`/);
						const toolStatusMatch = section.match(/\*\*Status:\*\* (Success|Error)/);

						const entry: GeminiConversationEntry = {
							role,
							message,
							notePath: '',
							created_at: timestamp,
							model,
						};

						// Add tool execution info if found
						if (toolNameMatch) {
							entry.metadata = {
								...entry.metadata,
								toolName: toolNameMatch[1],
								toolStatus: toolStatusMatch ? toolStatusMatch[1].toLowerCase() : undefined,
							};
						}

						entries.push(entry);
					}
				}
			}
		}

		return entries;
	}

	/**
	 * Create a new session file with proper frontmatter using Obsidian API
	 */
	private async createNewSessionFile(session: ChatSession): Promise<TFile> {
		const historyPath = session.historyPath;
		const initialContent = `# ${session.title}\n\n`;

		await this.ensureAgentSessionsFolder();
		const file = await this.plugin.app.vault.create(historyPath, initialContent);

		// Use Obsidian API to add frontmatter properly
		await this.applySessionFrontmatter(file, session);

		return file;
	}

	/**
	 * Apply session metadata to file frontmatter using Obsidian API
	 */
	private async applySessionFrontmatter(file: TFile, session: ChatSession): Promise<void> {
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
			// Required fields - always set
			frontmatter.session_id = session.id;
			frontmatter.type = session.type;
			frontmatter.title = session.title;
			frontmatter.created = session.created.toISOString();
			frontmatter.last_active = session.lastActive.toISOString();

			// Optional fields - set when present, delete when absent to remove stale values
			if (session.sourceNotePath) {
				frontmatter.source_note_path = session.sourceNotePath;
			} else {
				delete frontmatter.source_note_path;
			}

			// Context fields
			if (session.context?.contextFiles?.length) {
				frontmatter.context_files = session.context.contextFiles.map((f) => `[[${f.basename}]]`);
			} else {
				delete frontmatter.context_files;
			}

			if (session.context?.enabledTools?.length) {
				frontmatter.enabled_tools = session.context.enabledTools;
			} else {
				delete frontmatter.enabled_tools;
			}

			if (session.context?.requireConfirmation !== undefined) {
				frontmatter.require_confirmation = session.context.requireConfirmation;
			} else {
				delete frontmatter.require_confirmation;
			}

			// Model config fields
			if (session.modelConfig?.model) {
				frontmatter.model = session.modelConfig.model;
			} else {
				delete frontmatter.model;
			}

			if (session.modelConfig?.temperature !== undefined) {
				frontmatter.temperature = session.modelConfig.temperature;
			} else {
				delete frontmatter.temperature;
			}

			if (session.modelConfig?.topP !== undefined) {
				frontmatter.top_p = session.modelConfig.topP;
			} else {
				delete frontmatter.top_p;
			}

			if (session.modelConfig?.promptTemplate) {
				frontmatter.prompt_template = session.modelConfig.promptTemplate;
			} else {
				delete frontmatter.prompt_template;
			}

			// Additional metadata
			if (session.metadata) {
				frontmatter.metadata = session.metadata;
			} else {
				delete frontmatter.metadata;
			}
		});
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
