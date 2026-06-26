import { Modal, App, TFile, Notice, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import type ObsidianGemini from '../../main';
import { t } from '../../i18n';

/** Filter value representing all sessions regardless of project. */
const FILTER_ALL = 'all';
/** Filter value representing sessions not linked to any project. */
const FILTER_NONE = 'none';

interface SessionListCallbacks {
	onSelect: (session: ChatSession) => void;
	onDelete?: (session: ChatSession) => void;
}

export class SessionListModal extends Modal {
	private plugin: ObsidianGemini;
	private callbacks: SessionListCallbacks;
	private sessions: ChatSession[] = [];
	private currentSessionId: string | null;
	/** Maps project file path → display name for label look-ups. */
	private projectMap: Map<string, string> = new Map();
	/** Current filter selection: 'all', 'none', or a project file path. */
	private selectedFilter: string = FILTER_ALL;

	constructor(
		app: App,
		plugin: ObsidianGemini,
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
		this.modalEl.addClass('mod-gemini-session-modal');

		// Title
		contentEl.createEl('h2', { text: t('agent.sessionList.title') });

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
				text: t('agent.sessionList.empty'),
				cls: 'gemini-agent-empty-state',
			});
		} else {
			this.renderSessionList(listContainer);
		}

		// Add create new session button at the bottom
		const footer = contentEl.createDiv({ cls: 'modal-button-container' });
		const newSessionBtn = footer.createEl('button', {
			text: t('agent.menu.newSession'),
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
			new Notice(t('agent.sessionList.loadFailed'));
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
		const label = bar.createEl('label', { text: t('agent.sessionList.filterLabel') + ' ' });
		label.setAttribute('for', 'gemini-session-project-filter');

		const select = bar.createEl('select', { cls: 'dropdown' });
		select.id = 'gemini-session-project-filter';

		// "All Projects" option
		select.createEl('option', { text: t('agent.sessionList.filterAll'), value: FILTER_ALL });
		// "No Project" option
		select.createEl('option', { text: t('agent.project.none'), value: FILTER_NONE });

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
				text: t('agent.sessionList.noFilterMatch'),
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
			const fileText =
				fileCount === 1 ? t('agent.sessionList.fileCountOne') : t('agent.sessionList.fileCount', { count: fileCount });

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
				title: t('agent.sessionList.openTooltip'),
			});
			setIcon(openBtn, 'arrow-right');

			// Delete button
			if (this.callbacks.onDelete) {
				const deleteBtn = actionsDiv.createEl('button', {
					cls: 'gemini-session-action-btn delete',
					title: t('agent.sessionList.deleteTooltip'),
				});
				setIcon(deleteBtn, 'trash-2');

				deleteBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					// eslint-disable-next-line no-alert -- TODO: replace with Obsidian confirmation Modal
					if (confirm(t('agent.sessionList.deleteConfirm', { title: session.title }))) {
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
				await this.app.fileManager.trashFile(file);
				new Notice(t('agent.sessionList.deleted', { title: session.title }));

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
			new Notice(t('agent.sessionList.deleteFailed'));
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
