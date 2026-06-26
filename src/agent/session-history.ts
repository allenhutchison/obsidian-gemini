import { TFile, TFolder, normalizePath } from 'obsidian';
import { ChatSession } from '../types/agent';
import { GeminiConversationEntry } from '../types/conversation';
import type ObsidianGemini from '../main';
import { pathToWikilink } from '../utils/accessed-files';
import { formatLocalTimestamp } from '../utils/format-utils';
import { serializeToolPolicy } from '../types/tool-policy';
import * as Handlebars from 'handlebars';
import historyEntryTemplate from '../history/templates/historyEntry.hbs';

/**
 * Handles history for agent sessions stored in Agent-Sessions/ folder
 */
export class SessionHistory {
	private plugin: ObsidianGemini;
	private entryTemplate: Handlebars.TemplateDelegate;

	constructor(plugin: ObsidianGemini) {
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
	 * Add an entry to agent session history.
	 *
	 * When `explicitTimestamp` is provided, it is used for both the persisted
	 * `| Time |` metadata row and `entry.created_at`. This lets callers (e.g.
	 * the agent send path) write the exact turn timestamp the model saw into
	 * the per-turn preamble, so rehydrated history is bit-identical to what
	 * was originally sent — a prerequisite for Gemini implicit-cache alignment
	 * across resumes.
	 */
	async addEntryToSession(
		session: ChatSession,
		entry: GeminiConversationEntry,
		explicitTimestamp?: Date
	): Promise<void> {
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
		const hasMessage = entry.message.trim().length > 0;
		const messageLines = hasMessage ? entry.message.split('\n') : [];
		// Model reasoning, when present, is serialized as a collapsed
		// `[!reasoning]` callout. A model entry may carry thoughts with no
		// message (reasoning produced before the model decided to call tools).
		const thoughtLines = entry.thoughts?.trim() ? entry.thoughts.split('\n') : null;

		// Use configured user name for user entries, capitalized role for model
		const userDisplayName = (this.plugin.settings.userName ?? '').trim();
		const displayName = entry.role === 'user' ? userDisplayName || 'User' : role;

		const entryTimestamp = explicitTimestamp ?? new Date();
		entry.created_at = entryTimestamp;

		const entryContent = this.entryTemplate({
			role: role,
			displayName: displayName,
			hasMessage: hasMessage,
			messageLines: messageLines,
			thoughtLines: thoughtLines,
			timestamp: formatLocalTimestamp(entryTimestamp),
			pluginVersion: this.plugin.manifest.version,
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
				await this.plugin.app.fileManager.trashFile(historyFile);
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
			if (!(folder instanceof TFolder)) return [];

			return folder.children
				.filter((file): file is TFile => file instanceof TFile && file.extension === 'md')
				.sort((a, b) => b.stat.mtime - a.stat.mtime); // Most recent first
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

			// A section can hold more than one entry: a streamlined activity run
			// is several `> [!reasoning]-` callouts (and `> [!tools]-` logs) with no
			// `---` between them, and the final-answer section is an
			// `> [!assistant]+` message followed by its reasoning. Walk every callout
			// in order rather than assuming one entry per section.
			const lines = section.split('\n');

			// Section-level metadata (timestamp / model) lives in the `## ` header's
			// Message Info table and applies to the message entry in the section.
			const timeMatch = section.match(/\| Time \| ([^|]+) \|/);
			const sectionTimestamp = timeMatch ? new Date(timeMatch[1].trim()) : new Date();
			const modelMatch = section.match(/\| Model \| ([^|]+) \|/);
			const sectionModel = modelMatch ? modelMatch[1].trim() : undefined;
			const toolNameMatch = section.match(/\*\*Tool:\*\* `([^`]+)`/);
			const toolStatusMatch = section.match(/\*\*Status:\*\* (Success|Error)/);

			// The most recent entry created in this section — a reasoning callout that
			// immediately follows an answer attaches to it as `thoughts`; otherwise
			// it's a standalone reasoning-only turn.
			let lastInSection: GeminiConversationEntry | null = null;

			for (let i = 0; i < lines.length; i++) {
				const messageMatch = lines[i].match(/^> \[!(user|assistant)\]\+\s*$/);
				if (messageMatch) {
					const role = messageMatch[1] === 'user' ? 'user' : 'model';
					const message = this.extractCalloutBody(lines, i).join('\n').trim();
					if (!message) continue;

					const entry: GeminiConversationEntry = {
						role,
						message,
						notePath: '',
						created_at: sectionTimestamp,
						model: sectionModel,
					};
					if (toolNameMatch) {
						entry.metadata = {
							toolName: toolNameMatch[1],
							toolStatus: toolStatusMatch ? toolStatusMatch[1].toLowerCase() : undefined,
						};
					}
					entries.push(entry);
					lastInSection = entry;
					continue;
				}

				if (/^> \[!reasoning\]-/.test(lines[i])) {
					const body = this.extractCalloutBody(lines, i).join('\n').trim();
					if (!body) continue;

					if (lastInSection && lastInSection.role === 'model' && lastInSection.message && !lastInSection.thoughts) {
						// Reasoning that follows an answer is that answer's thinking.
						lastInSection.thoughts = body;
					} else {
						const entry: GeminiConversationEntry = {
							role: 'model',
							message: '',
							notePath: '',
							created_at: sectionTimestamp,
							model: sectionModel,
							thoughts: body,
						};
						entries.push(entry);
						lastInSection = entry;
					}
				}
			}
		}

		return entries;
	}

	/**
	 * Collect the de-quoted body lines of a callout. `startIndex` is the index
	 * of the callout marker line (e.g. `> [!assistant]+`). Stops at the next
	 * callout marker (`> [!...]`), or at the first non-quoted line once content
	 * has started. Bare `>` lines are preserved as blank body lines so
	 * multi-paragraph messages and reasoning round-trip intact.
	 */
	private extractCalloutBody(lines: string[], startIndex: number): string[] {
		const body: string[] = [];
		let started = false;
		for (let i = startIndex + 1; i < lines.length; i++) {
			const line = lines[i];
			// Stop at the next callout (metadata, reasoning, user, assistant, …).
			if (/^> \[!/.test(line)) break;
			if (line.startsWith('> ')) {
				body.push(line.substring(2));
				started = true;
			} else if (line === '>') {
				body.push('');
				started = true;
			} else if (started) {
				// A non-quoted line after content ends the callout.
				break;
			}
			// Leading blank/non-quoted lines before content are skipped.
		}
		return body;
	}

	/**
	 * Create a new session file with proper frontmatter using Obsidian API
	 */
	private async createNewSessionFile(session: ChatSession): Promise<TFile> {
		const historyPath = session.historyPath;
		const initialContent = `# ${session.title}\n\n`;

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
			frontmatter.created = formatLocalTimestamp(session.created);
			frontmatter.last_active = formatLocalTimestamp(session.lastActive);

			// Optional fields - set when present, delete when absent to remove stale values
			if (session.sourceNotePath) {
				frontmatter.source_note_path = session.sourceNotePath;
			} else {
				delete frontmatter.source_note_path;
			}

			// Project linkage
			if (session.projectPath) {
				frontmatter.project = `[[${session.projectPath}]]`;
			} else {
				delete frontmatter.project;
			}

			// Context fields
			if (session.context?.contextFiles?.length) {
				frontmatter.context_files = session.context.contextFiles.map((f) => `[[${f.basename}]]`);
			} else {
				delete frontmatter.context_files;
			}

			// Accessed files - all files the agent interacted with during the session
			if (session.accessedFiles?.size) {
				frontmatter.accessed_files = Array.from(session.accessedFiles).map(pathToWikilink);
			} else {
				delete frontmatter.accessed_files;
			}

			const serializedPolicy = serializeToolPolicy(session.context?.toolPolicy);
			if (serializedPolicy) {
				frontmatter.tool_policy = serializedPolicy;
			} else {
				delete frontmatter.tool_policy;
			}
			// Drop the legacy field whenever we rewrite this session — readers
			// already migrate it in-memory; clearing here finishes the on-disk
			// transition the first time we save the session.
			delete frontmatter.enabled_tools;

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
	 * Get the Agent-Sessions folder path
	 */
	private getAgentSessionsFolderPath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/Agent-Sessions`);
	}
}
