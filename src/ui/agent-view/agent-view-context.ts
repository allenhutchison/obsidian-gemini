import { TFile, App, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin } from '../../utils/file-utils';

/**
 * Manages the context panel and file context for agent sessions
 * Handles adding/removing files and tracking auto-added active file
 */
export class AgentViewContext {
	private app: App;
	private plugin: InstanceType<typeof ObsidianGemini>;
	private autoAddedActiveFile: TFile | null = null;

	constructor(app: App, plugin: InstanceType<typeof ObsidianGemini>) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * Gets the auto-added active file
	 */
	getAutoAddedActiveFile(): TFile | null {
		return this.autoAddedActiveFile;
	}

	/**
	 * Clears the auto-added active file tracking
	 */
	clearAutoAddedActiveFile(): void {
		this.autoAddedActiveFile = null;
	}

	/**
	 * Updates the context files list display
	 */
	updateContextFilesList(container: HTMLElement, currentSession: ChatSession | null, onRemove: (file: TFile) => void): void {
		container.empty();

		const hasContextFiles = currentSession && currentSession.context.contextFiles.length > 0;

		if (!hasContextFiles) {
			container.createEl('p', {
				text: 'No context files',
				cls: 'gemini-agent-empty-state'
			});
			return;
		}

		// Get the currently active file to mark it with a badge
		const activeFile = this.app.workspace.getActiveFile();

		// Show all context files with remove buttons
		if (currentSession) {
			currentSession.context.contextFiles.forEach(file => {
				const isActiveFile = file === activeFile;

				const fileItem = container.createDiv({ cls: 'gemini-agent-file-item' });

				// Add file icon
				const fileIcon = fileItem.createEl('span', { cls: 'gemini-agent-file-icon' });
				setIcon(fileIcon, 'file-text');

				const fileName = fileItem.createEl('span', {
					text: file.basename,
					cls: 'gemini-agent-file-name',
					title: file.path // Show full path on hover
				});

				// Add "Active" badge if this is the currently open file
				if (isActiveFile) {
					const badge = fileItem.createEl('span', {
						text: 'Active',
						cls: 'gemini-agent-active-badge',
						title: 'This is the currently open file'
					});
				}

				const removeBtn = fileItem.createEl('button', {
					text: '×',
					cls: 'gemini-agent-remove-btn',
					title: 'Remove file'
				});

				removeBtn.addEventListener('click', () => {
					onRemove(file);
				});
			});
		}
	}

	/**
	 * Removes a file from the context
	 */
	removeContextFile(file: TFile, currentSession: ChatSession | null): void {
		if (!currentSession) return;

		const index = currentSession.context.contextFiles.indexOf(file);
		if (index > -1) {
			currentSession.context.contextFiles.splice(index, 1);

			// If this was the auto-added active file, clear tracking
			if (this.autoAddedActiveFile === file) {
				this.autoAddedActiveFile = null;
			}
		}
	}

	/**
	 * Add the currently active markdown file to session context
	 * Auto-replaces the previous auto-added file to avoid accumulation
	 */
	async addActiveFileToContext(currentSession: ChatSession | null): Promise<void> {
		if (!currentSession) return;

		const activeFile = this.app.workspace.getActiveFile();

		// Only add markdown files
		if (!activeFile || activeFile.extension !== 'md') return;

		// Check if file should be excluded (history files, system folders, etc.)
		if (shouldExcludePathForPlugin(activeFile.path, this.plugin)) return;

		// If this file is already the auto-added active file, nothing to do
		if (this.autoAddedActiveFile === activeFile) return;

		// If the new active file was manually added, don't modify the context
		// Keep tracking the existing auto-added file so it can be removed later
		if (currentSession.context.contextFiles.includes(activeFile)) {
			return;
		}

		// Remove previous auto-added file (if exists and still in context)
		if (this.autoAddedActiveFile) {
			const index = currentSession.context.contextFiles.indexOf(this.autoAddedActiveFile);
			if (index > -1) {
				currentSession.context.contextFiles.splice(index, 1);
			}
		}

		// Add new active file and track it
		currentSession.context.contextFiles.push(activeFile);
		this.autoAddedActiveFile = activeFile;
	}

	/**
	 * Adds a file to the context if not already present
	 */
	addFileToContext(file: TFile, currentSession: ChatSession | null): void {
		if (!currentSession) return;

		if (!currentSession.context.contextFiles.includes(file)) {
			currentSession.context.contextFiles.push(file);
		}
	}

	/**
	 * Adds multiple files to the context
	 */
	addFilesToContext(files: TFile[], currentSession: ChatSession | null): void {
		if (!currentSession) return;

		files.forEach(file => {
			this.addFileToContext(file, currentSession);
		});
	}
}
