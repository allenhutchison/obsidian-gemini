import { TFile, TFolder } from 'obsidian';
import { ChatSession, SessionType, AgentContext, DEFAULT_CONTEXTS, ChatMessage, SessionModelConfig } from '../types/agent';
import type ObsidianGemini from '../main';

/**
 * Manages chat sessions for both note-centric and agent modes
 */
export class SessionManager {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private activeSessions = new Map<string, ChatSession>();

	// Folder paths for different session types
	private readonly HISTORY_FOLDER = 'History';
	private readonly AGENT_SESSIONS_FOLDER = 'Agent-Sessions';

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
	}

	/**
	 * Create a new note-centric chat session
	 */
	async createNoteChatSession(sourceFile: TFile): Promise<ChatSession> {
		const context: AgentContext = {
			...DEFAULT_CONTEXTS.NOTE_CHAT,
			contextFiles: [sourceFile],
			// Create new arrays to avoid sharing references between sessions
			enabledTools: [...DEFAULT_CONTEXTS.NOTE_CHAT.enabledTools],
			requireConfirmation: [...DEFAULT_CONTEXTS.NOTE_CHAT.requireConfirmation]
		};

		const sessionTitle = this.sanitizeFileName(`${sourceFile.basename} Chat`);
		
		const session: ChatSession = {
			id: this.generateSessionId(),
			type: SessionType.NOTE_CHAT,
			title: sessionTitle,
			context,
			created: new Date(),
			lastActive: new Date(),
			historyPath: `${this.getHistoryFolderPath()}/${sessionTitle}.md`,
			sourceNotePath: sourceFile.path
		};

		this.activeSessions.set(session.id, session);
		return session;
	}

	/**
	 * Create a new agent session
	 */
	async createAgentSession(title?: string, initialContext?: Partial<AgentContext>): Promise<ChatSession> {
		const context: AgentContext = {
			...DEFAULT_CONTEXTS.AGENT_SESSION,
			...initialContext,
			// Create new arrays to avoid sharing references between sessions
			contextFiles: [...(initialContext?.contextFiles ?? [])],
			enabledTools: [...(initialContext?.enabledTools ?? DEFAULT_CONTEXTS.AGENT_SESSION.enabledTools)],
			requireConfirmation: [...(initialContext?.requireConfirmation ?? DEFAULT_CONTEXTS.AGENT_SESSION.requireConfirmation)]
		};

		const rawTitle = title || `Agent Session ${new Date().toLocaleDateString()}`;
		const sessionTitle = this.sanitizeFileName(rawTitle);
		
		const session: ChatSession = {
			id: this.generateSessionId(),
			type: SessionType.AGENT_SESSION,
			title: sessionTitle,
			context,
			created: new Date(),
			lastActive: new Date(),
			historyPath: `${this.getAgentSessionsFolderPath()}/${sessionTitle}.md`
		};

		this.activeSessions.set(session.id, session);
		return session;
	}

	/**
	 * Get existing session for a note (note-centric mode)
	 */
	async getNoteChatSession(sourceFile: TFile): Promise<ChatSession> {
		// Check if we already have an active session for this note
		const existingSession = Array.from(this.activeSessions.values())
			.find(session => 
				session.type === SessionType.NOTE_CHAT && 
				session.sourceNotePath === sourceFile.path
			);

		if (existingSession) {
			existingSession.lastActive = new Date();
			return existingSession;
		}

		// Check if a history file exists for this note
		const sanitizedTitle = this.sanitizeFileName(`${sourceFile.basename} Chat`);
		const historyPath = `${this.getHistoryFolderPath()}/${sanitizedTitle}.md`;
		const historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
		
		if (historyFile instanceof TFile) {
			// Load existing session from history file
			return this.loadSessionFromFile(historyFile);
		}

		// Create new session
		return this.createNoteChatSession(sourceFile);
	}

	/**
	 * Get all recent agent sessions
	 */
	async getRecentAgentSessions(limit = 10): Promise<ChatSession[]> {
		const agentSessionsFolder = await this.getOrCreateAgentSessionsFolder();
		const sessionFiles = agentSessionsFolder.children
			.filter((file): file is TFile => file instanceof TFile && file.extension === 'md')
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit);

		const sessions: ChatSession[] = [];
		for (const file of sessionFiles) {
			try {
				const session = await this.loadSessionFromFile(file);
				sessions.push(session);
			} catch (error) {
				this.plugin.logger.warn(`Failed to load agent session from ${file.path}:`, error);
			}
		}

		return sessions;
	}

	/**
	 * Update session context
	 */
	async updateSessionContext(sessionId: string, context: Partial<AgentContext>): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (session) {
			session.context = { ...session.context, ...context };
			session.lastActive = new Date();
			
			// Save metadata to history file for agent sessions
			if (session.type === SessionType.AGENT_SESSION) {
				await this.plugin.history.updateSessionMetadata(session);
			}
		}
	}

	/**
	 * Update session model configuration
	 */
	async updateSessionModelConfig(sessionId: string, modelConfig: SessionModelConfig): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (session) {
			// Replace the entire modelConfig to properly handle deletions
			// If modelConfig is empty, set to undefined
			if (Object.keys(modelConfig).length === 0) {
				session.modelConfig = undefined;
			} else {
				session.modelConfig = modelConfig;
			}
			session.lastActive = new Date();
			
			// Save metadata to history file for agent sessions
			if (session.type === SessionType.AGENT_SESSION) {
				await this.plugin.history.updateSessionMetadata(session);
			}
		}
	}

	/**
	 * Add files to session context
	 */
	async addContextFiles(sessionId: string, files: TFile[]): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (session) {
			const existingPaths = session.context.contextFiles.map(f => f.path);
			const newFiles = files.filter(f => !existingPaths.includes(f.path));
			session.context.contextFiles.push(...newFiles);
			session.lastActive = new Date();
			
			// Save metadata to history file for agent sessions
			if (session.type === SessionType.AGENT_SESSION) {
				await this.plugin.history.updateSessionMetadata(session);
			}
		}
	}

	/**
	 * Remove files from session context
	 */
	async removeContextFiles(sessionId: string, filePaths: string[]): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (session) {
			session.context.contextFiles = session.context.contextFiles
				.filter(f => !filePaths.includes(f.path));
			session.lastActive = new Date();
			
			// Save metadata to history file for agent sessions
			if (session.type === SessionType.AGENT_SESSION) {
				await this.plugin.history.updateSessionMetadata(session);
			}
		}
	}

	/**
	 * Promote a note chat to an agent session
	 */
	async promoteToAgentSession(noteChatId: string, title?: string): Promise<ChatSession> {
		const noteSession = this.activeSessions.get(noteChatId);
		if (!noteSession || noteSession.type !== SessionType.NOTE_CHAT) {
			throw new Error('Session not found or not a note chat');
		}

		// Create new agent session with expanded capabilities
		const agentSession = await this.createAgentSession(
			title || `${noteSession.title} (Agent)`,
			{
				contextFiles: noteSession.context.contextFiles
			}
		);

		// TODO: Copy message history from note session to agent session
		
		return agentSession;
	}

	/**
	 * Get session by ID
	 */
	getSession(sessionId: string): ChatSession | undefined {
		return this.activeSessions.get(sessionId);
	}

	/**
	 * Load session from history path
	 */
	async loadSession(historyPath: string): Promise<ChatSession | null> {
		const file = this.plugin.app.vault.getAbstractFileByPath(historyPath);
		if (file instanceof TFile) {
			return this.loadSessionFromFile(file);
		}
		return null;
	}

	/**
	 * Load session from a history file
	 */
	private async loadSessionFromFile(file: TFile): Promise<ChatSession> {
		const content = await this.plugin.app.vault.read(file);
		const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;

		// Determine session type based on folder location
		const isAgentSession = file.path.startsWith(this.getAgentSessionsFolderPath());
		
		const session: ChatSession = {
			id: frontmatter?.session_id || this.generateSessionId(),
			type: isAgentSession ? SessionType.AGENT_SESSION : SessionType.NOTE_CHAT,
			title: frontmatter?.title || file.basename,
			context: this.parseContextFromFrontmatter(frontmatter),
			modelConfig: this.parseModelConfigFromFrontmatter(frontmatter),
			created: frontmatter?.created ? new Date(frontmatter.created) : new Date(file.stat.ctime),
			lastActive: new Date(file.stat.mtime),
			historyPath: file.path,
			sourceNotePath: frontmatter?.source_note_path,
			metadata: frontmatter?.metadata
		};

		this.activeSessions.set(session.id, session);
		return session;
	}

	/**
	 * Parse agent context from frontmatter
	 */
	private parseContextFromFrontmatter(frontmatter: any): AgentContext {
		if (!frontmatter) {
			return DEFAULT_CONTEXTS.NOTE_CHAT as AgentContext;
		}

		// Convert file links back to TFile objects
		const contextFiles: TFile[] = [];
		if (frontmatter.context_files) {
			for (const fileRef of frontmatter.context_files) {
				let file: TFile | null = null;
				
				// Handle both old path format and new wikilink format
				if (typeof fileRef === 'string') {
					if (fileRef.startsWith('[[') && fileRef.endsWith(']]')) {
						// New wikilink format: [[filename]]
						const linkpath = fileRef.slice(2, -2); // Remove [[ and ]]
						
						// Use Obsidian's link resolution to find the file
						const resolvedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkpath, '');
						file = resolvedFile instanceof TFile ? resolvedFile : null;
					} else {
						// Old path format: direct file path
						const foundFile = this.plugin.app.vault.getAbstractFileByPath(fileRef);
						file = foundFile instanceof TFile ? foundFile : null;
					}
				}
				
				if (file instanceof TFile) {
					contextFiles.push(file);
				}
			}
		}

		return {
			contextFiles,
			enabledTools: frontmatter.enabled_tools || DEFAULT_CONTEXTS.NOTE_CHAT.enabledTools,
			requireConfirmation: frontmatter.require_confirmation || [],
			maxContextChars: frontmatter.max_context_chars,
			maxCharsPerFile: frontmatter.max_chars_per_file
		};
	}

	/**
	 * Parse model config from frontmatter
	 */
	private parseModelConfigFromFrontmatter(frontmatter: any): SessionModelConfig | undefined {
		if (!frontmatter) {
			return undefined;
		}

		const config: SessionModelConfig = {};
		let hasConfig = false;

		if (frontmatter.model) {
			config.model = frontmatter.model;
			hasConfig = true;
		}
		if (frontmatter.temperature !== undefined) {
			config.temperature = Number(frontmatter.temperature);
			hasConfig = true;
		}
		if (frontmatter.top_p !== undefined) {
			config.topP = Number(frontmatter.top_p);
			hasConfig = true;
		}
		if (frontmatter.prompt_template) {
			config.promptTemplate = frontmatter.prompt_template;
			hasConfig = true;
		}

		return hasConfig ? config : undefined;
	}

	/**
	 * Generate unique session ID
	 */
	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Get the history folder path within the plugin's state folder
	 */
	private getHistoryFolderPath(): string {
		return `${this.plugin.settings.historyFolder}/${this.HISTORY_FOLDER}`;
	}

	/**
	 * Get the agent sessions folder path within the plugin's state folder
	 */
	private getAgentSessionsFolderPath(): string {
		return `${this.plugin.settings.historyFolder}/${this.AGENT_SESSIONS_FOLDER}`;
	}

	/**
	 * Ensure the agent sessions folder exists
	 */
	private async getOrCreateAgentSessionsFolder(): Promise<TFolder> {
		const folderPath = this.getAgentSessionsFolderPath();
		
		let folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			await this.plugin.app.vault.createFolder(folderPath);
			folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				throw new Error(`Failed to create or access folder: ${folderPath}`);
			}
		}
		
		return folder;
	}

	/**
	 * Sanitize file name by removing or replacing forbidden characters
	 */
	private sanitizeFileName(fileName: string): string {
		// Characters that are forbidden in file names on most operating systems
		// Including: \ / : * ? " < > |
		return fileName
			.replace(/[\\/:*?"<>|]/g, '-')  // Replace forbidden chars with dash
			.replace(/\s+/g, ' ')          // Normalize whitespace
			.trim()                        // Remove leading/trailing whitespace
			.slice(0, 100);               // Limit length to prevent issues
	}
}