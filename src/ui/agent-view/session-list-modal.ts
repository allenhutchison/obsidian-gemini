import { Modal, App, TFile, Notice, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import type ObsidianGemini from '../../main';

/** Filter value representing all sessions regardless of project. */
const FILTER_ALL = 'all';
/** Filter value representing sessions not linked to any project. */
const FILTER_NONE = 'none';

interface SessionListCallbacks {
	onSelect: (session: ChatSession) => void;
	onDelete?: (session: ChatSession) => void;
}

export class SessionListModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private callbacks: SessionListCallbacks;
	private sessions: ChatSession[] = [];
	private currentSessionId: string | null;
	/** Maps project file path → display name for label look-ups. */
	private projectMap: Map<string, string> = new Map();
	/** Current filter selection: 'all', 'none', or a project file path. */
	private selectedFilter: string = FILTER_ALL;

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

		// Load sessions and build project map
		await this.loadSessions();
		this.buildProjectMap();

		// Project filter bar (only when there are projects linked to sessions)
		const filterContainer = contentEl.createDiv({ cls: 'gemini-session-filter-container' });
		const hasProjectSessions = this.sessions.some((s) => s.projectPath);
		if (hasProjectSessions) {
			this.renderFilterBar(filterContainer);
		}

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

	private buildProjectMap() {
		this.projectMap.clear();
		const projects = this.plugin.projectManager?.discoverProjects() ?? [];
		for (const p of projects) {
			this.projectMap.set(p.filePath, p.name);
		}
	}

	private renderFilterBar(container: HTMLElement) {
		const bar = container.createDiv({ cls: 'gemini-session-filter-bar' });
		const label = bar.createEl('label', { text: 'Project: ' });
		label.setAttribute('for', 'gemini-session-project-filter');

		const select = bar.createEl('select', { cls: 'dropdown' });
		select.id = 'gemini-session-project-filter';

		// "All Projects" option
		select.createEl('option', { text: 'All Projects', value: FILTER_ALL });
		// "No Project" option
		select.createEl('option', { text: 'No Project', value: FILTER_NONE });

		// One option per project that has at least one session
		const projectPathsInSessions = new Set(this.sessions.map((s) => s.projectPath).filter(Boolean) as string[]);
		const projectEntries = Array.from(projectPathsInSessions)
			.map((path) => ({ path, name: this.projectMap.get(path) ?? path }))
			.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of projectEntries) {
			select.createEl('option', { text: entry.name, value: entry.path });
		}

		select.value = this.selectedFilter;
		select.addEventListener('change', () => {
			this.selectedFilter = select.value;
			const listContainer = this.contentEl.querySelector('.gemini-session-list') as HTMLElement;
			if (listContainer) {
				listContainer.empty();
				this.renderSessionList(listContainer);
			}
		});
	}

	private getFilteredSessions(): ChatSession[] {
		if (this.selectedFilter === FILTER_ALL) return this.sessions;
		if (this.selectedFilter === FILTER_NONE) return this.sessions.filter((s) => !s.projectPath);
		return this.sessions.filter((s) => s.projectPath === this.selectedFilter);
	}

	private renderSessionList(container: HTMLElement) {
		const filtered = this.getFilteredSessions();

		if (filtered.length === 0) {
			container.createEl('p', {
				text: 'No sessions match the selected filter',
				cls: 'gemini-agent-empty-state',
			});
			return;
		}

		for (const session of filtered) {
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

			// Project tag
			if (session.projectPath) {
				const projectName = this.projectMap.get(session.projectPath) ?? session.projectPath;
				const tag = metaDiv.createSpan({ cls: 'gemini-session-project-tag' });
				const tagIcon = tag.createSpan({ cls: 'gemini-session-project-tag-icon' });
				setIcon(tagIcon, 'folder-open');
				tag.createSpan({ text: projectName });
			}

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

				// Reload the list and refresh filter state
				const { contentEl } = this;
				const listContainer = contentEl.querySelector('.gemini-session-list');
				if (listContainer) {
					listContainer.empty();
					await this.loadSessions();
					this.buildProjectMap();

					// Reset filter if selected project no longer has sessions
					if (this.selectedFilter !== FILTER_ALL && this.selectedFilter !== FILTER_NONE) {
						const hasSelectedProject = this.sessions.some((s) => s.projectPath === this.selectedFilter);
						if (!hasSelectedProject) {
							this.selectedFilter = FILTER_ALL;
						}
					}

					// Re-render filter bar to reflect current state
					const filterContainer = contentEl.querySelector('.gemini-session-filter-container') as HTMLElement;
					if (filterContainer) {
						filterContainer.empty();
						const hasProjectSessions = this.sessions.some((s) => s.projectPath);
						if (hasProjectSessions) {
							this.renderFilterBar(filterContainer);
						}
					}

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
