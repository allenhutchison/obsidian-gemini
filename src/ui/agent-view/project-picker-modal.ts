import { Modal, App, setIcon } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ProjectSummary } from '../../types/project';
import { t } from '../../i18n';

interface ProjectPickerCallbacks {
	onSelect: (project: ProjectSummary | null) => void;
}

/**
 * Modal for selecting a project to link to the current session.
 * Selecting null unlinks the session from any project.
 */
export class ProjectPickerModal extends Modal {
	private plugin: ObsidianGemini;
	private callbacks: ProjectPickerCallbacks;
	private currentProjectPath: string | null;

	constructor(
		app: App,
		plugin: ObsidianGemini,
		callbacks: ProjectPickerCallbacks,
		currentProjectPath: string | null = null
	) {
		super(app);
		this.plugin = plugin;
		this.callbacks = callbacks;
		this.currentProjectPath = currentProjectPath;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-session-modal');
		this.modalEl.addClass('mod-gemini-session-modal');

		contentEl.createEl('h2', { text: t('agent.projectPicker.title') });

		const projects = this.plugin.projectManager?.discoverProjects() ?? [];

		const listContainer = contentEl.createDiv({ cls: 'gemini-session-list' });

		// "No project" option to unlink
		const noProjectItem = listContainer.createDiv({
			cls: `gemini-session-item ${!this.currentProjectPath ? 'gemini-session-item-active' : ''}`,
		});
		const noProjectInfo = noProjectItem.createDiv({ cls: 'gemini-session-info' });
		noProjectInfo.createDiv({ text: t('agent.project.none'), cls: 'gemini-session-title' });
		noProjectInfo.createDiv({ text: t('agent.projectPicker.noProjectDesc'), cls: 'gemini-session-meta' });
		noProjectItem.addEventListener('click', () => {
			this.callbacks.onSelect(null);
			this.close();
		});

		if (projects.length === 0) {
			listContainer.createEl('p', {
				text: t('agent.projectPicker.empty'),
				cls: 'gemini-agent-empty-state',
			});
		} else {
			for (const project of projects) {
				const isActive = project.filePath === this.currentProjectPath;
				const item = listContainer.createDiv({
					cls: `gemini-session-item ${isActive ? 'gemini-session-item-active' : ''}`,
				});

				const infoDiv = item.createDiv({ cls: 'gemini-session-info' });

				const titleDiv = infoDiv.createDiv({ cls: 'gemini-session-title' });
				const iconSpan = titleDiv.createSpan();
				setIcon(iconSpan, 'folder-open');
				titleDiv.createSpan({ text: ' ' + project.name });

				infoDiv.createDiv({
					text: project.rootPath || t('agent.projectPicker.vaultRoot'),
					cls: 'gemini-session-meta',
				});

				item.addEventListener('click', () => {
					this.callbacks.onSelect(project);
					this.close();
				});
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
