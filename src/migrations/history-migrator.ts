/**
 * HistoryMigrator - Migrates note-centric chat history to agent sessions
 *
 * Converts History/ folder files to Agent-Sessions/ format
 */

import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ChatSession, SessionType, ToolCategory, DestructiveAction } from '../types/agent';

/**
 * Simple interface for parsed history entries
 */
interface ParsedHistoryEntry {
	role: 'user' | 'model';
	message: string;
}

export interface MigrationReport {
	totalFilesFound: number;
	filesProcessed: number;
	sessionsCreated: number;
	filesFailed: number;
	backupCreated: boolean;
	errors: string[];
}

/**
 * Handles migration of note-centric history to agent sessions
 */
export class HistoryMigrator {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private historyFolder: string;
	private agentSessionsFolder: string;
	private archiveFolder: string;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.historyFolder = normalizePath(plugin.settings.historyFolder + '/History');
		this.agentSessionsFolder = normalizePath(plugin.settings.historyFolder + '/Agent-Sessions');
		this.archiveFolder = normalizePath(plugin.settings.historyFolder + '/History-Archive');
	}

	/**
	 * Check if migration is needed
	 */
	async needsMigration(): Promise<boolean> {
		// Check if History folder exists and has markdown files
		const historyFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.historyFolder);
		if (!historyFolderObj || historyFolderObj instanceof TFile) {
			return false;
		}

		// Check for any markdown files in History folder
		const files = this.plugin.app.vault.getMarkdownFiles();
		const historyFiles = files.filter(file =>
			normalizePath(file.path).startsWith(this.historyFolder + '/')
		);

		// If there are history files and no agent sessions, migration is needed
		if (historyFiles.length > 0) {
			const agentFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.agentSessionsFolder);
			if (!agentFolderObj || agentFolderObj instanceof TFile) {
				return true; // History exists but no agent folder
			}

			// Check if agent folder is empty or has significantly fewer files
			const agentFiles = files.filter(file =>
				normalizePath(file.path).startsWith(this.agentSessionsFolder + '/')
			);

			// If History has files but Agent-Sessions has none, migration needed
			return agentFiles.length === 0;
		}

		return false;
	}

	/**
	 * Perform the full migration
	 */
	async migrateAllHistory(): Promise<MigrationReport> {
		const report: MigrationReport = {
			totalFilesFound: 0,
			filesProcessed: 0,
			sessionsCreated: 0,
			filesFailed: 0,
			backupCreated: false,
			errors: []
		};

		try {
			// Step 1: Find all history files
			const historyFiles = await this.findHistoryFiles();
			report.totalFilesFound = historyFiles.length;

			if (historyFiles.length === 0) {
				return report; // Nothing to migrate
			}

			// Step 2: Create backup
			await this.createBackup();
			report.backupCreated = true;

			// Step 3: Ensure Agent-Sessions folder exists
			await this.ensureAgentSessionsFolder();

			// Step 4: Process each history file
			for (const file of historyFiles) {
				try {
					const created = await this.migrateHistoryFile(file);
					if (created) {
						report.filesProcessed++;
						report.sessionsCreated++;
					}
				} catch (error) {
					report.filesFailed++;
					report.errors.push(`Failed to migrate ${file.path}: ${error.message}`);
					console.error(`Migration error for ${file.path}:`, error);
				}
			}

			return report;
		} catch (error) {
			report.errors.push(`Migration failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Find all history files in the History/ folder
	 */
	private async findHistoryFiles(): Promise<TFile[]> {
		const files = this.plugin.app.vault.getMarkdownFiles();
		return files.filter(file =>
			normalizePath(file.path).startsWith(this.historyFolder + '/')
		);
	}

	/**
	 * Create a backup of the History folder
	 */
	private async createBackup(): Promise<void> {
		const historyFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.historyFolder);
		if (!historyFolderObj || historyFolderObj instanceof TFile) {
			return; // Nothing to backup
		}

		// Ensure archive folder exists
		const archiveFolderObj = this.plugin.app.vault.getAbstractFileByPath(this.archiveFolder);
		if (!archiveFolderObj) {
			await this.plugin.app.vault.createFolder(this.archiveFolder);
		}

		// Copy all files from History to History-Archive
		const files = await this.findHistoryFiles();
		for (const file of files) {
			try {
				const relativePath = file.path.substring(this.historyFolder.length + 1);
				const archivePath = normalizePath(this.archiveFolder + '/' + relativePath);

				// Ensure parent folder exists
				const parentPath = archivePath.substring(0, archivePath.lastIndexOf('/'));
				const parentFolderObj = this.plugin.app.vault.getAbstractFileByPath(parentPath);
				if (!parentFolderObj) {
					await this.plugin.app.vault.createFolder(parentPath);
				}

				// Copy file
				const content = await this.plugin.app.vault.read(file);
				await this.plugin.app.vault.create(archivePath, content);
			} catch (error) {
				console.warn(`Failed to backup ${file.path}:`, error);
				// Continue with other files even if one fails
			}
		}
	}

	/**
	 * Ensure the Agent-Sessions folder exists
	 */
	private async ensureAgentSessionsFolder(): Promise<void> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(this.agentSessionsFolder);
		if (!folder) {
			await this.plugin.app.vault.createFolder(this.agentSessionsFolder);
		}
	}

	/**
	 * Migrate a single history file to an agent session
	 * @returns true if session was created, false if skipped
	 */
	private async migrateHistoryFile(file: TFile): Promise<boolean> {
		// Read the history file
		const content = await this.plugin.app.vault.read(file);

		// Parse the conversation history
		const history = await this.parseHistoryContent(content);

		if (history.length === 0) {
			// Empty history, skip
			return false;
		}

		// Generate a session title from the file name or first message
		const title = this.generateSessionTitle(file, history);

		// Create a new chat session
		const session: ChatSession = {
			id: this.generateSessionId(),
			title: title,
			type: SessionType.AGENT_SESSION,
			context: {
				contextFiles: [],
				contextDepth: 0,
				enabledTools: [ToolCategory.VAULT_OPERATIONS],
				requireConfirmation: [DestructiveAction.DELETE_FILES, DestructiveAction.MODIFY_FILES]
			},
			historyPath: normalizePath(
				this.agentSessionsFolder + '/' + this.sanitizeFilename(title) + '.md'
			),
			created: new Date(file.stat.ctime),
			lastActive: new Date(file.stat.mtime),
			metadata: {
				autoLabeled: true
			}
		};

		// Create the session file with frontmatter and history
		await this.createSessionFile(session, history);
		return true;
	}

	/**
	 * Parse history content into conversation entries
	 */
	private async parseHistoryContent(content: string): Promise<ParsedHistoryEntry[]> {
		const entries: ParsedHistoryEntry[] = [];

		// Split by role markers (### User, ### Assistant, etc.)
		const rolePattern = /^### (User|Assistant|Model)/gm;
		const parts = content.split(rolePattern);

		// Process pairs of (role, message)
		for (let i = 1; i < parts.length; i += 2) {
			const role = parts[i].toLowerCase() === 'user' ? 'user' : 'model';
			const message = parts[i + 1]?.trim() || '';

			if (message) {
				entries.push({
					role: role as 'user' | 'model',
					message: message
				});
			}
		}

		return entries;
	}

	/**
	 * Generate a session title from file or first message
	 */
	private generateSessionTitle(file: TFile, history: ParsedHistoryEntry[]): string {
		// Use the file name without extension as default
		const fileName = file.basename;

		// If it's a descriptive name, use it
		if (fileName.length > 3 && !fileName.match(/^\d{4}-\d{2}-\d{2}/)) {
			return fileName;
		}

		// Otherwise, generate from first user message
		const firstUserMessage = history.find(entry => entry.role === 'user');
		if (firstUserMessage) {
			// Take first 50 chars of the message as title
			const title = firstUserMessage.message
				.substring(0, 50)
				.replace(/\n/g, ' ')
				.trim();
			return title || 'Migrated Conversation';
		}

		return 'Migrated Conversation';
	}

	/**
	 * Generate a unique session ID
	 */
	private generateSessionId(): string {
		return `migrated-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
	}

	/**
	 * Sanitize filename for safe filesystem use
	 */
	private sanitizeFilename(title: string): string {
		return title
			.replace(/[<>:"/\\|?*]/g, '-')
			.replace(/\s+/g, '-')
			.substring(0, 100);
	}

	/**
	 * Create a session file with frontmatter and history
	 */
	private async createSessionFile(
		session: ChatSession,
		history: ParsedHistoryEntry[]
	): Promise<void> {
		// Build frontmatter
		const frontmatter = [
			'---',
			`session-id: ${session.id}`,
			`title: ${session.title}`,
			`type: ${session.type.toLowerCase()}`,
			`created: ${session.created.toISOString()}`,
			`updated: ${session.lastActive.toISOString()}`,
			`auto-labeled: ${session.metadata?.autoLabeled || false}`,
			'---',
			'',
			'# ' + session.title,
			''
		].join('\n');

		// Build history entries
		const historyContent = history.map(entry => {
			const role = entry.role === 'user' ? 'User' : 'Assistant';
			return `### ${role}\n${entry.message}\n`;
		}).join('\n');

		const fullContent = frontmatter + historyContent;

		// Check if file already exists
		const existingFile = this.plugin.app.vault.getAbstractFileByPath(session.historyPath);
		if (existingFile instanceof TFile) {
			// File exists, append a number
			const basePath = session.historyPath.substring(0, session.historyPath.length - 3);
			let counter = 1;
			let newPath = '';
			while (true) {
				newPath = `${basePath}-${counter}.md`;
				const checkFile = this.plugin.app.vault.getAbstractFileByPath(newPath);
				if (!checkFile) {
					session.historyPath = newPath;
					break;
				}
				counter++;
			}
		}

		// Create the file
		await this.plugin.app.vault.create(session.historyPath, fullContent);
	}
}
