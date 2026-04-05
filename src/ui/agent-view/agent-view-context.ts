import { TFile } from 'obsidian';
import { ChatSession } from '../../types/agent';

/**
 * Manages file context for agent sessions
 * Handles adding/removing context files
 */
export class AgentViewContext {
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
