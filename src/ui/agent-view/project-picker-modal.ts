import { Modal, App, setIcon } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ProjectSummary } from '../../types/project';

interface ProjectPickerCallbacks {
	onSelect: (project: ProjectSummary | null) => void;
}

/**
 * Modal for selecting a project to link to the current session.
 * Selecting null unlinks the session from any project.
 */
export class ProjectPickerModal extends Modal {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private callbacks: ProjectPickerCallbacks;
	private currentProjectPath: string | null;

	constructor(
		app: App,
		plugin: InstanceType<typeof ObsidianGemini>,
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

		contentEl.createEl('h2', { text: 'Switch Project' });

		const projects = this.plugin.projectManager?.discoverProjects() ?? [];

		const listContainer = contentEl.createDiv({ cls: 'gemini-session-list' });

		// "No project" option to unlink
		const noProjectItem = listContainer.createDiv({
			cls: `gemini-session-item ${!this.currentProjectPath ? 'gemini-session-item-active' : ''}`,
		});
		const noProjectInfo = noProjectItem.createDiv({ cls: 'gemini-session-info' });
		noProjectInfo.createDiv({ text: 'No Project', cls: 'gemini-session-title' });
		noProjectInfo.createDiv({ text: 'Use default vault-wide scope', cls: 'gemini-session-meta' });
		noProjectItem.addEventListener('click', () => {
			this.callbacks.onSelect(null);
			this.close();
		});

		if (projects.length === 0) {
			listContainer.createEl('p', {
				text: 'No projects found. Create a note with the gemini-scribe/project tag to get started.',
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
					text: project.rootPath || '(vault root)',
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
