import { Modal, App, TFile, Notice, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import type { ObsidianGemini } from '../../types/plugin';
import { isPathInFolder } from '../../utils/file-utils';
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
	/**
	 * Restores the action buttons of the row currently showing its delete
	 * confirmation, or null when no row is confirming. Doubles as the "is a
	 * confirm pending?" flag — at most one row confirms at a time.
	 */
	private pendingDelete: (() => void) | null = null;
	/** Capture-phase Escape handler; cancels a pending confirm before the modal closes. */
	private escapeHandler: ((evt: KeyboardEvent) => void) | null = null;

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

		// Escape cancels a pending row confirmation rather than closing the whole
		// modal. Capture phase on modalEl runs before Obsidian's document-level
		// close handler, so stopping propagation there keeps the modal open.
		this.escapeHandler = (evt: KeyboardEvent) => {
			if (evt.key !== 'Escape' || !this.pendingDelete) return;
			evt.preventDefault();
			evt.stopPropagation();
			this.dismissDeleteConfirm();
		};
		this.modalEl.addEventListener('keydown', this.escapeHandler, true);

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
		newSessionBtn.addEventListener('click', () => {
			this.close();
			void (async () => {
				// Create a new session by passing null
				if (this.callbacks.onSelect) {
					const newSession = await this.plugin.sessionManager.createAgentSession();
					this.callbacks.onSelect(newSession);
				}
			})();
		});
	}

	private async loadSessions() {
		try {
			// Clear existing sessions before reloading
			this.sessions = [];

			// Get all files in the Agent-Sessions folder
			const sessionFolder = `${this.plugin.settings.historyFolder}/Agent-Sessions`;

			// Get all markdown files in the session folder. Root-anchored via the
			// shared helper (#1402); the entries are files, so its `path === folder`
			// arm is unreachable here.
			const files = this.app.vault.getMarkdownFiles().filter((f) => isPathInFolder(f.path, sessionFolder));

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
		// Any row mid-confirmation is about to be replaced; drop the stale restore
		// callback so it can't rebuild actions on a detached element.
		this.pendingDelete = null;
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
			this.renderSessionActions(actionsDiv, session);

			// Click handler for the entire item
			sessionItem.addEventListener('click', () => {
				this.callbacks.onSelect(session);
				this.close();
			});
		}
	}

	/**
	 * Renders a row's default action buttons (open, and delete when a delete
	 * callback was supplied). Rebuilt from scratch rather than shown/hidden, so
	 * cancelling a confirmation restores buttons with live handlers.
	 */
	private renderSessionActions(actionsDiv: HTMLElement, session: ChatSession) {
		actionsDiv.empty();
		actionsDiv.removeClass('gemini-session-actions--confirming');

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

			deleteBtn.addEventListener('click', (e) => {
				// The row's own click handler opens the session and closes the modal,
				// so a delete click must never reach it.
				e.stopPropagation();
				this.showDeleteConfirm(actionsDiv, session);
			});
		}
	}

	/**
	 * Swaps a row's action buttons for an inline "delete?" confirmation. Keeps the
	 * list's scroll position and filter state intact — unlike a full-pane swap —
	 * and avoids stacking a second modal over the session list.
	 */
	private showDeleteConfirm(actionsDiv: HTMLElement, session: ChatSession) {
		// At most one row confirms at a time.
		this.dismissDeleteConfirm();

		actionsDiv.empty();
		actionsDiv.addClass('gemini-session-actions--confirming');

		const prompt = t('agent.sessionList.deleteConfirm', { title: session.title });
		actionsDiv.createSpan({
			text: prompt,
			cls: 'gemini-session-confirm-prompt',
			// The row ellipsizes long titles; the tooltip keeps the full question reachable.
			attr: { title: prompt },
		});

		const confirmBtn = actionsDiv.createEl('button', {
			text: t('agent.sessionList.deleteConfirmAction'),
			cls: 'gemini-session-confirm-delete',
			// Names the session for screen readers, which don't get the row context.
			attr: { 'aria-label': prompt },
		});
		const cancelBtn = actionsDiv.createEl('button', {
			text: t('agent.sessionList.deleteCancel'),
			cls: 'gemini-session-confirm-cancel',
		});

		this.pendingDelete = () => this.renderSessionActions(actionsDiv, session);

		confirmBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			// The row is about to be re-rendered by deleteSession; nothing to restore.
			this.pendingDelete = null;
			void this.deleteSession(session);
		});
		cancelBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.dismissDeleteConfirm();
		});
	}

	/** Restores the confirming row's buttons, if any row is confirming. */
	private dismissDeleteConfirm() {
		const restore = this.pendingDelete;
		this.pendingDelete = null;
		restore?.();
	}

	private async deleteSession(session: ChatSession) {
		try {
			const file = this.app.vault.getAbstractFileByPath(session.historyPath);
			if (file) {
				await this.app.fileManager.trashFile(file);
				// Release per-session engine state (tool-loop detector records) only
				// after the file deletion succeeded — if trashing failed the session
				// remains, so its detection state must survive too (#1387).
				this.plugin.toolExecutionEngine.clearLoopDetectorSession(session.id);
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
		if (this.escapeHandler) {
			this.modalEl.removeEventListener('keydown', this.escapeHandler, true);
			this.escapeHandler = null;
		}
		this.pendingDelete = null;
		const { contentEl } = this;
		contentEl.empty();
	}
}
