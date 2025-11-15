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

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
	}

	/**
	 * Get the path to the example-prompts.json file
	 * Computed dynamically to handle settings changes
	 * @returns The normalized path to the prompts file
	 */
	getPromptsFilePath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/example-prompts.json`);
	}

	/**
	 * Validate a single example prompt object
	 * @param prompt - The prompt to validate
	 * @returns True if valid, false otherwise
	 */
	private isValidPrompt(prompt: any): prompt is ExamplePrompt {
		return (
			typeof prompt === 'object' &&
			typeof prompt.icon === 'string' &&
			typeof prompt.text === 'string' &&
			prompt.icon.trim().length > 0 &&
			prompt.text.trim().length > 0
		);
	}

	/**
	 * Validate an array of prompts
	 * @param prompts - The prompts array to validate
	 * @returns True if valid array of prompts, false otherwise
	 */
	private isValidPromptsArray(prompts: any): prompts is ExamplePrompt[] {
		return Array.isArray(prompts) && prompts.every(p => this.isValidPrompt(p));
	}

	/**
	 * Check if example-prompts.json exists
	 * @returns True if the file exists and is a TFile, false otherwise
	 */
	async exists(): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.getPromptsFilePath());
		return file instanceof TFile;
	}

	/**
	 * Read example prompts from the JSON file
	 * @returns Array of example prompts, or null if file doesn't exist or can't be parsed
	 */
	async read(): Promise<ExamplePrompt[] | null> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(this.getPromptsFilePath());
			if (!(file instanceof TFile)) {
				return null;
			}

			const content = await this.plugin.app.vault.read(file);
			const prompts = JSON.parse(content);

			if (!this.isValidPromptsArray(prompts)) {
				this.plugin.logger.warn('Invalid example prompts structure in file');
				return null;
			}

			return prompts;
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
			if (!this.isValidPromptsArray(prompts)) {
				throw new Error('Invalid example prompts structure');
			}

			const content = JSON.stringify(prompts, null, 2);
			const filePath = this.getPromptsFilePath();
			const file = this.plugin.app.vault.getAbstractFileByPath(filePath);

			if (file instanceof TFile) {
				// Update existing file
				await this.plugin.app.vault.modify(file, content);
			} else {
				// Create new file
				await this.plugin.app.vault.create(filePath, content);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to write example-prompts.json:', error);
			throw new Error(`Failed to write example-prompts.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
