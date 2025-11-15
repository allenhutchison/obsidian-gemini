import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';

/**
 * Represents an example prompt shown in the Agent Panel UI
 */
export interface ExamplePrompt {
	/** Icon name from Lucide icon set */
	icon: string;
	/** The prompt text to display and execute */
	text: string;
}

/**
 * Service for managing the example-prompts.json file
 * This file stores UI-specific example prompts and is NOT sent to the AI agent
 */
export class ExamplePromptsManager {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private promptsFilePath: string;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.promptsFilePath = normalizePath(`${plugin.settings.historyFolder}/example-prompts.json`);
	}

	/**
	 * Get the path to the example-prompts.json file
	 * @returns The normalized path to the prompts file
	 */
	getPromptsFilePath(): string {
		return this.promptsFilePath;
	}

	/**
	 * Check if example-prompts.json exists
	 * @returns True if the file exists and is a TFile, false otherwise
	 */
	async exists(): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.promptsFilePath);
		return file instanceof TFile;
	}

	/**
	 * Read example prompts from the JSON file
	 * @returns Array of example prompts, or null if file doesn't exist or can't be parsed
	 */
	async read(): Promise<ExamplePrompt[] | null> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(this.promptsFilePath);
			if (!(file instanceof TFile)) {
				return null;
			}

			const content = await this.plugin.app.vault.read(file);
			const prompts = JSON.parse(content);

			// Validate structure: must be array with valid prompt objects
			if (Array.isArray(prompts) &&
			    prompts.every(p =>
				    typeof p === 'object' &&
				    typeof p.icon === 'string' &&
				    typeof p.text === 'string' &&
				    p.icon.length > 0 &&
				    p.text.length > 0
			    )) {
				return prompts;
			}

			this.plugin.logger.warn('Invalid example prompts structure in file');
			return null;
		} catch (error) {
			this.plugin.logger.error('Failed to read example-prompts.json:', error);
			return null;
		}
	}

	/**
	 * Write example prompts to the JSON file
	 * @param prompts - Array of example prompts to write
	 * @throws Error if prompts array is invalid or write operation fails
	 */
	async write(prompts: ExamplePrompt[]): Promise<void> {
		try {
			// Validate input: must be array with valid prompt objects
			if (!Array.isArray(prompts) ||
			    !prompts.every(p =>
				    typeof p === 'object' &&
				    typeof p.icon === 'string' &&
				    typeof p.text === 'string' &&
				    p.icon.length > 0 &&
				    p.text.length > 0
			    )) {
				throw new Error('Invalid example prompts structure');
			}

			const content = JSON.stringify(prompts, null, 2);
			const file = this.plugin.app.vault.getAbstractFileByPath(this.promptsFilePath);

			if (file instanceof TFile) {
				// Update existing file
				await this.plugin.app.vault.modify(file, content);
			} else {
				// Create new file
				await this.plugin.app.vault.create(this.promptsFilePath, content);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to write example-prompts.json:', error);
			throw new Error(`Failed to write example-prompts.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
