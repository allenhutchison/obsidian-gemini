import { Modal, App, TFile, TFolder, Notice, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import type ObsidianGemini from '../../main';

interface SessionListCallbacks {
	onSelect: (session: ChatSession) => void;
	onDelete?: (session: ChatSession) => void;
}

export class SessionListModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private callbacks: SessionListCallbacks;
	private sessions: ChatSession[] = [];
	private currentSessionId: string | null;

	constructor(
		app: App,
		plugin: InstanceType<typeof ObsidianGemini>,
		callbacks: SessionListCallbacks,
		currentSessionId: string | null = null
	) {
		super(app);
		this.plugin = plugin;
		this.callbacks = callbacks;
		this.currentSessionId = currentSessionId;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-session-modal');

		// Title
		contentEl.createEl('h2', { text: 'Agent Sessions' });

		// Load sessions
		await this.loadSessions();

		// Create session list
		const listContainer = contentEl.createDiv({ cls: 'gemini-session-list' });

		if (this.sessions.length === 0) {
			listContainer.createEl('p', {
				text: 'No agent sessions found',
				cls: 'gemini-agent-empty-state',
			});
		} else {
			this.renderSessionList(listContainer);
		}

		// Add create new session button at the bottom
		const footer = contentEl.createDiv({ cls: 'modal-button-container' });
		const newSessionBtn = footer.createEl('button', {
			text: 'New Session',
			cls: 'mod-cta',
		});
		newSessionBtn.addEventListener('click', async () => {
			this.close();
			// Create a new session by passing null
			if (this.callbacks.onSelect) {
				const newSession = await this.plugin.sessionManager.createAgentSession();
				this.callbacks.onSelect(newSession);
			}
		});
	}

	private async loadSessions() {
		try {
			// Clear existing sessions before reloading
			this.sessions = [];

			// Get all files in the Agent-Sessions folder
			const sessionFolder = `${this.plugin.settings.historyFolder}/Agent-Sessions`;
			const folder = this.app.vault.getAbstractFileByPath(sessionFolder);

			// Get all markdown files in the session folder
			const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(sessionFolder + '/'));

			// Load each session
			for (const file of files) {
				try {
					const session = await this.plugin.sessionManager.loadSession(file.path);
					if (session) {
						this.sessions.push(session);
					}
				} catch (error) {
					this.plugin.logger.error(`Failed to load session from ${file.path}:`, error);
				}
			}

			// Sort sessions by last modified date (newest first)
			this.sessions.sort((a, b) => {
				const aFile = this.app.vault.getAbstractFileByPath(a.historyPath);
				const bFile = this.app.vault.getAbstractFileByPath(b.historyPath);
				if (aFile && bFile && aFile instanceof TFile && bFile instanceof TFile) {
					return bFile.stat.mtime - aFile.stat.mtime;
				}
				return 0;
			});
		} catch (error) {
			this.plugin.logger.error('Failed to load sessions:', error);
			new Notice('Failed to load agent sessions');
		}
	}

	private renderSessionList(container: HTMLElement) {
		for (const session of this.sessions) {
			const sessionItem = container.createDiv({
				cls: `gemini-session-item ${session.id === this.currentSessionId ? 'gemini-session-item-active' : ''}`,
			});

			// Session info
			const infoDiv = sessionItem.createDiv({ cls: 'gemini-session-info' });
			infoDiv.createDiv({
				text: session.title,
				cls: 'gemini-session-title',
			});

			const metaDiv = infoDiv.createDiv({ cls: 'gemini-session-meta' });

			// Show file count and last modified
			const fileCount = session.context.contextFiles.length;
			const fileText = fileCount === 1 ? '1 file' : `${fileCount} files`;

			const file = this.app.vault.getAbstractFileByPath(session.historyPath);
			if (file && file instanceof TFile) {
				const lastModified = new Date(file.stat.mtime);
				const dateStr = lastModified.toLocaleDateString();
				const timeStr = lastModified.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
				metaDiv.createSpan({ text: `${fileText} • ${dateStr} ${timeStr}` });
			} else {
				metaDiv.createSpan({ text: fileText });
			}

			// Actions
			const actionsDiv = sessionItem.createDiv({ cls: 'gemini-session-actions' });

			// Open button
			const openBtn = actionsDiv.createEl('button', {
				cls: 'gemini-session-action-btn',
				title: 'Open session',
			});
			setIcon(openBtn, 'arrow-right');

			// Delete button
			if (this.callbacks.onDelete) {
				const deleteBtn = actionsDiv.createEl('button', {
					cls: 'gemini-session-action-btn delete',
					title: 'Delete session',
				});
				setIcon(deleteBtn, 'trash-2');

				deleteBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					if (confirm(`Delete session "${session.title}"?`)) {
						await this.deleteSession(session);
					}
				});
			}

			// Click handler for the entire item
			sessionItem.addEventListener('click', () => {
				this.callbacks.onSelect(session);
				this.close();
			});
		}
	}

	private async deleteSession(session: ChatSession) {
		try {
			const file = this.app.vault.getAbstractFileByPath(session.historyPath);
			if (file) {
				await this.app.vault.delete(file);
				new Notice(`Session "${session.title}" deleted`);

				// Reload the list
				const { contentEl } = this;
				const listContainer = contentEl.querySelector('.gemini-session-list');
				if (listContainer) {
					listContainer.empty();
					await this.loadSessions();
					this.renderSessionList(listContainer as HTMLElement);
				}

				// Call the delete callback if provided
				if (this.callbacks.onDelete) {
					this.callbacks.onDelete(session);
				}
			}
		} catch (error) {
			this.plugin.logger.error('Failed to delete session:', error);
			new Notice('Failed to delete session');
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
