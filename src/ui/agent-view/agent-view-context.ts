import { TFile, setIcon } from 'obsidian';
import { ChatSession } from '../../types/agent';

/**
 * Manages the context panel and file context for agent sessions
 * Handles adding/removing context files
 */
export class AgentViewContext {
	/**
	 * Updates the context files list display
	 */
	updateContextFilesList(
		container: HTMLElement,
		currentSession: ChatSession | null,
		onRemove: (file: TFile) => void
	): void {
		container.empty();

		const hasContextFiles = currentSession && currentSession.context.contextFiles.length > 0;

		if (!hasContextFiles) {
			container.createEl('p', {
				text: 'No context files',
				cls: 'gemini-agent-empty-state',
			});
			return;
		}

		// Show all context files with remove buttons
		if (currentSession) {
			currentSession.context.contextFiles.forEach((file) => {
				const fileItem = container.createDiv({ cls: 'gemini-agent-file-item' });

				// Add file icon
				const fileIcon = fileItem.createEl('span', { cls: 'gemini-agent-file-icon' });
				setIcon(fileIcon, 'file-text');

				fileItem.createEl('span', {
					text: file.basename,
					cls: 'gemini-agent-file-name',
					title: file.path, // Show full path on hover
				});

				const removeBtn = fileItem.createEl('button', {
					text: '×',
					cls: 'gemini-agent-remove-btn',
					title: 'Remove file',
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
		}
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

		files.forEach((file) => {
			this.addFileToContext(file, currentSession);
		});
	}
}
