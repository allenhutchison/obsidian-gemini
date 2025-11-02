import { TFile, normalizePath } from 'obsidian';
import Handlebars from 'handlebars';
import type ObsidianGemini from '../main';

export interface AgentsMemoryData {
	vaultOverview?: string;
	organization?: string;
	keyTopics?: string;
	userPreferences?: string;
	customInstructions?: string;
}

/**
 * Service for managing the AGENTS.md memory file
 *
 * Based on the agents.md specification (https://agents.md/):
 * - Standard Markdown format with no mandatory structure
 * - Provides context and instructions for AI agents
 * - Separated from README.md (which is for humans)
 *
 * For Obsidian vaults, AGENTS.md stores:
 * - Vault structure and organization
 * - Key topics and themes
 * - User preferences for agent behavior
 * - Custom instructions specific to this vault
 */
export class AgentsMemory {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private memoryFilePath: string;
	private template: HandlebarsTemplateDelegate;

	constructor(plugin: InstanceType<typeof ObsidianGemini>, templateContent: string) {
		this.plugin = plugin;
		this.memoryFilePath = normalizePath(`${plugin.settings.historyFolder}/AGENTS.md`);
		this.template = Handlebars.compile(templateContent);
	}

	/**
	 * Get the path to the AGENTS.md file
	 */
	getMemoryFilePath(): string {
		return this.memoryFilePath;
	}

	/**
	 * Check if AGENTS.md exists
	 */
	async exists(): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.memoryFilePath);
		return file instanceof TFile;
	}

	/**
	 * Read the contents of AGENTS.md
	 * Returns null if the file doesn't exist
	 */
	async read(): Promise<string | null> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(this.memoryFilePath);
			if (!(file instanceof TFile)) {
				return null;
			}
			return await this.plugin.app.vault.read(file);
		} catch (error) {
			console.error('Failed to read AGENTS.md:', error);
			return null;
		}
	}

	/**
	 * Write content to AGENTS.md
	 * Creates the file if it doesn't exist, otherwise replaces its content
	 */
	async write(content: string): Promise<void> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(this.memoryFilePath);
			if (file instanceof TFile) {
				// Update existing file
				await this.plugin.app.vault.modify(file, content);
			} else {
				// Create new file
				await this.plugin.app.vault.create(this.memoryFilePath, content);
			}
		} catch (error) {
			console.error('Failed to write AGENTS.md:', error);
			throw new Error(`Failed to write AGENTS.md: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Render the AGENTS.md template with the provided data
	 */
	render(data: AgentsMemoryData): string {
		return this.template(data);
	}

	/**
	 * Initialize AGENTS.md with default template if it doesn't exist
	 */
	async initialize(data?: AgentsMemoryData): Promise<void> {
		const exists = await this.exists();
		if (!exists) {
			const content = this.render(data || {});
			await this.write(content);
		}
	}

	/**
	 * Append content to the end of AGENTS.md
	 */
	async append(content: string): Promise<void> {
		try {
			let existingContent = await this.read();

			if (!existingContent) {
				// File doesn't exist, create it with the content
				await this.write(content);
			} else {
				// Append to existing content
				const newContent = `${existingContent.trim()}\n\n${content}`;
				await this.write(newContent);
			}
		} catch (error) {
			console.error('Failed to append to AGENTS.md:', error);
			throw new Error(`Failed to append to AGENTS.md: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
