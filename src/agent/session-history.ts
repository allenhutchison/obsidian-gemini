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
			return this.parseHistoryContent(content);
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

		// Ensure the Agent-Sessions folder exists
		await this.ensureAgentSessionsFolder();

		let historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
		let existingContent = '';

		if (historyFile instanceof TFile) {
			// Read existing content
			try {
				existingContent = await this.plugin.app.vault.read(historyFile);
			} catch (error) {
				this.plugin.logger.error(`Error reading existing history from ${historyPath}:`, error);
			}
		} else {
			// Create new file with session metadata
			existingContent = this.generateSessionFrontmatter(session);
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
		let historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);

		if (!(historyFile instanceof TFile)) {
			// File doesn't exist yet, create it with just frontmatter
			const content = this.generateSessionFrontmatter(session);
			await this.ensureAgentSessionsFolder();
			await this.plugin.app.vault.create(historyPath, content);
			return;
		}

		// Convert file paths to Obsidian wikilink format for frontmatter
		const contextFileLinks = session.context.contextFiles.map((f) => `[[${f.basename}]]`);

		// Update existing file's frontmatter
		await this.plugin.app.fileManager.processFrontMatter(historyFile, (frontmatter: any) => {
			frontmatter.session_id = session.id;
			frontmatter.type = session.type;
			frontmatter.title = session.title;
			frontmatter.context_files = contextFileLinks;
			frontmatter.enabled_tools = session.context.enabledTools;
			frontmatter.require_confirmation = session.context.requireConfirmation;
			frontmatter.created = session.created.toISOString();
			frontmatter.last_active = session.lastActive.toISOString();
			if (session.sourceNotePath) {
				frontmatter.source_note_path = session.sourceNotePath;
			} else {
				delete frontmatter.source_note_path;
			}

			// Handle model config - delete properties when not present or set to default
			if (session.modelConfig && session.modelConfig.model) {
				frontmatter.model = session.modelConfig.model;
			} else {
				delete frontmatter.model;
			}

			if (session.modelConfig && session.modelConfig.temperature !== undefined) {
				frontmatter.temperature = session.modelConfig.temperature;
			} else {
				delete frontmatter.temperature;
			}

			if (session.modelConfig && session.modelConfig.topP !== undefined) {
				frontmatter.top_p = session.modelConfig.topP;
			} else {
				delete frontmatter.top_p;
			}

			if (session.modelConfig && session.modelConfig.promptTemplate) {
				frontmatter.prompt_template = session.modelConfig.promptTemplate;
			} else {
				delete frontmatter.prompt_template;
			}

			// Save additional metadata
			if (session.metadata) {
				frontmatter.metadata = session.metadata;
			} else {
				delete frontmatter.metadata;
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
	private parseHistoryContent(content: string): GeminiConversationEntry[] {
		const entries: GeminiConversationEntry[] = [];

		// Split content by entry separator (---)
		const entrySeparator = /^---\s*$/m;
		const sections = content.split(entrySeparator);

		// Skip the frontmatter section (first two sections)
		const contentSections = sections.slice(2);

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
	 * Generate frontmatter for a new session file
	 */
	private generateSessionFrontmatter(session: ChatSession): string {
		// Convert file paths to Obsidian wikilink format for frontmatter
		const contextFileLinks = session.context.contextFiles.map((f) => {
			// Use just the basename without extension for cleaner links
			const basename = f.basename;
			return `[[${basename}]]`;
		});

		const frontmatter: any = {
			session_id: session.id,
			type: session.type,
			title: session.title,
			context_files: contextFileLinks,
			enabled_tools: session.context.enabledTools,
			require_confirmation: session.context.requireConfirmation,
			created: session.created.toISOString(),
			last_active: session.lastActive.toISOString(),
		};

		// Only add optional fields if they have values
		if (session.sourceNotePath) {
			frontmatter.source_note_path = session.sourceNotePath;
		}

		// Only add model config fields if they have values
		if (session.modelConfig) {
			if (session.modelConfig.model) {
				frontmatter.model = session.modelConfig.model;
			}
			if (session.modelConfig.temperature !== undefined) {
				frontmatter.temperature = session.modelConfig.temperature;
			}
			if (session.modelConfig.topP !== undefined) {
				frontmatter.top_p = session.modelConfig.topP;
			}
			if (session.modelConfig.promptTemplate) {
				frontmatter.prompt_template = session.modelConfig.promptTemplate;
			}
		}

		// Add metadata if present
		if (session.metadata) {
			frontmatter.metadata = session.metadata;
		}

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
