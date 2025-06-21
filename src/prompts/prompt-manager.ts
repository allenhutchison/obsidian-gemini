import { 
	Vault, 
	TFile, 
	TFolder,
	normalizePath, 
	Notice, 
	SuggestModal, 
	App
} from 'obsidian';
import ObsidianGemini from '../../main';
import { CustomPrompt, PromptInfo } from './types';

export class PromptManager {
	constructor(
		private plugin: ObsidianGemini,
		private vault: Vault
	) {}

	// Get the prompts directory path
	getPromptsDirectory(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/Prompts`);
	}

	// Ensure prompts directory exists
	async ensurePromptsDirectory(): Promise<void> {
		const promptsDir = this.getPromptsDirectory();
		const folder = this.vault.getAbstractFileByPath(promptsDir);
		
		// If it doesn't exist or isn't a folder, create it
		if (!folder || !(folder instanceof TFolder)) {
			await this.vault.createFolder(promptsDir);
		}
	}

	// Load a prompt from file
	async loadPromptFromFile(filePath: string): Promise<CustomPrompt | null> {
		try {
			const file = this.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return null;
			
			// Use Obsidian's metadata cache to get frontmatter
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter || {};
			
			// Get the content without frontmatter using sections
			let contentWithoutFrontmatter = '';
			
			// If there are sections, concatenate them (they don't include frontmatter)
			if (cache?.sections) {
				const fullContent = await this.vault.read(file);
				const lines = fullContent.split('\n');
				
				for (const section of cache.sections) {
					// Skip frontmatter section
					if (section.type === 'yaml') continue;
					
					const startLine = section.position.start.line;
					const endLine = section.position.end.line;
					
					for (let i = startLine; i <= endLine && i < lines.length; i++) {
						contentWithoutFrontmatter += lines[i] + '\n';
					}
				}
			} else {
				// Fallback if no sections found
				const fullContent = await this.vault.read(file);
				contentWithoutFrontmatter = this.extractContentWithoutFrontmatter(fullContent);
			}
			
			// Parse tags - ensure it's an array
			const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
			
			return {
				name: frontmatter.name || 'Unnamed Prompt',
				description: frontmatter.description || '',
				version: frontmatter.version || 1,
				overrideSystemPrompt: frontmatter.override_system_prompt || false,
				tags: tags,
				content: contentWithoutFrontmatter.trim()
			};
		} catch (error) {
			console.error('Error loading prompt file:', error);
			return null;
		}
	}

	// Extract content without frontmatter block
	private extractContentWithoutFrontmatter(content: string): string {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
		const match = content.match(frontmatterRegex);
		
		if (match) {
			return match[2]; // Return content after frontmatter
		}
		
		return content; // No frontmatter found, return entire content
	}

	// Get prompt from note's frontmatter
	async getPromptFromNote(file: TFile): Promise<CustomPrompt | null> {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const promptPath = cache?.frontmatter?.['gemini-scribe-prompt'];
		
		if (!promptPath) return null;
		
		// Extract path from wikilink
		const linkpath = this.extractPathFromWikilink(promptPath);
		if (!linkpath) return null;
		
		// Use Obsidian's link resolution to find the file
		// getFirstLinkpathDest resolves the link path relative to the source file
		const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (!linkedFile || !(linkedFile instanceof TFile)) return null;
		
		return await this.loadPromptFromFile(linkedFile.path);
	}

	// Extract path from wikilink format
	private extractPathFromWikilink(wikilink: string): string | null {
		// Remove brackets if present
		let cleaned = wikilink;
		if (cleaned.startsWith('[[') && cleaned.endsWith(']]')) {
			cleaned = cleaned.slice(2, -2);
		}
		
		// Remove alias (text after |)
		const pathWithoutAlias = cleaned.split('|')[0];
		
		// Remove heading (text after #)
		const pathWithoutHeading = pathWithoutAlias.split('#')[0];
		
		// Remove block reference (text after ^)
		const pathWithoutBlock = pathWithoutHeading.split('^')[0];
		
		return pathWithoutBlock.trim() || null;
	}

	// List all available prompts
	async listAvailablePrompts(): Promise<PromptInfo[]> {
		const promptsDir = this.getPromptsDirectory();
		const folder = this.vault.getAbstractFileByPath(promptsDir);
		
		if (!(folder instanceof TFolder)) {
			return [];
		}
		
		const prompts: PromptInfo[] = [];
		
		// Use Vault.getMarkdownFiles() and filter by path
		const markdownFiles = this.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith(promptsDir));
		
		for (const file of markdownFiles) {
			const prompt = await this.loadPromptFromFile(file.path);
			if (prompt) {
				prompts.push({
					path: file.path,
					name: prompt.name,
					description: prompt.description,
					tags: prompt.tags
				});
			}
		}
		
		return prompts;
	}

	// Create default example prompts on first run
	async createDefaultPrompts(): Promise<void> {
		const promptsDir = this.getPromptsDirectory();
		const examplePromptPath = normalizePath(`${promptsDir}/example-expert.md`);
		
		// Check if file already exists using getAbstractFileByPath
		const existingFile = this.vault.getAbstractFileByPath(examplePromptPath);
		if (existingFile) return;
		
		const exampleContent = `---
name: "Subject Matter Expert"
description: "A knowledgeable expert who provides detailed, accurate information"
version: 1
override_system_prompt: false
tags: ["general", "expert"]
---

You are a subject matter expert with comprehensive knowledge across multiple domains. When answering questions:

- Provide accurate, well-researched information
- Cite relevant sources when possible
- Explain complex concepts clearly
- Acknowledge limitations in your knowledge
- Offer multiple perspectives when appropriate

Focus on being helpful while maintaining intellectual honesty.`;

		await this.vault.create(examplePromptPath, exampleContent);
	}

	// Setup commands for prompt management
	setupPromptCommands(): void {
		// Only register commands if custom prompts are enabled
		if (this.plugin.settings.enableCustomPrompts) {
			this.plugin.addCommand({
				id: 'gemini-scribe-apply-custom-prompt',
				name: 'Apply Custom Prompt to Current Note',
				callback: () => this.applyCustomPromptToCurrentNote(),
			});

			this.plugin.addCommand({
				id: 'gemini-scribe-remove-custom-prompt',
				name: 'Remove Custom Prompt from Current Note',
				callback: () => this.removeCustomPromptFromCurrentNote(),
			});
		}
	}

	// Apply a custom prompt to the current note by inserting frontmatter
	async applyCustomPromptToCurrentNote(): Promise<void> {
		try {
			// Check if custom prompts are enabled
			if (!this.plugin.settings.enableCustomPrompts) {
				new Notice('Custom prompts are disabled. Enable them in plugin settings.');
				return;
			}

			const activeFile = this.plugin.gfile.getActiveFile();
			if (!activeFile) {
				new Notice('No active file to apply prompt to');
				return;
			}

			if (!this.plugin.gfile.isMarkdownFile(activeFile)) {
				new Notice('Custom prompts can only be applied to markdown files');
				return;
			}

			// Get available prompts
			const availablePrompts = await this.listAvailablePrompts();
			if (availablePrompts.length === 0) {
				new Notice('No custom prompts found. Create prompts in the Prompts folder first.');
				return;
			}

			// Show prompt selection modal
			this.showPromptSelectionModal(activeFile, availablePrompts);

		} catch (error) {
			console.error('Error applying custom prompt:', error);
			new Notice('Failed to apply custom prompt');
		}
	}

	// Show modal for selecting a prompt
	private showPromptSelectionModal(file: TFile, prompts: PromptInfo[]): void {
		const modal = new PromptSelectionModal(this.plugin.app, this, file, prompts);
		modal.open();
	}

	// Apply the selected prompt to the file using Obsidian's API
	async applyPromptToFile(file: any, prompt: PromptInfo): Promise<void> {
		try {
			const promptName = this.extractPromptNameFromPath(prompt.path);
			const frontmatterValue = `[[${promptName}]]`;

			// Use Obsidian's processFrontMatter API to add/update the prompt
			this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
				frontmatter['gemini-scribe-prompt'] = frontmatterValue;
			});

			new Notice(`Applied custom prompt: ${prompt.name}`);

		} catch (error) {
			console.error('Error applying prompt to file:', error);
			new Notice('Failed to apply custom prompt to note');
		}
	}

	// Remove custom prompt from the current note
	async removeCustomPromptFromCurrentNote(): Promise<void> {
		try {
			// Check if custom prompts are enabled
			if (!this.plugin.settings.enableCustomPrompts) {
				new Notice('Custom prompts are disabled. Enable them in plugin settings.');
				return;
			}

			const activeFile = this.plugin.gfile.getActiveFile();
			if (!activeFile) {
				new Notice('No active file to remove prompt from');
				return;
			}

			if (!this.plugin.gfile.isMarkdownFile(activeFile)) {
				new Notice('Custom prompts can only be removed from markdown files');
				return;
			}

			// Check if file has a custom prompt
			const cache = this.plugin.app.metadataCache.getFileCache(activeFile);
			const currentPrompt = cache?.frontmatter?.['gemini-scribe-prompt'];
			
			if (!currentPrompt) {
				new Notice('No custom prompt is applied to this note');
				return;
			}

			// Remove the prompt from frontmatter
			this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter: any) => {
				delete frontmatter['gemini-scribe-prompt'];
			});

			new Notice('Removed custom prompt from note');

		} catch (error) {
			console.error('Error removing custom prompt:', error);
			new Notice('Failed to remove custom prompt from note');
		}
	}

	// Extract prompt name from file path for wikilink
	private extractPromptNameFromPath(path: string): string {
		const file = this.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			// Use basename to get filename without extension
			return file.basename;
		}
		// Fallback
		const fileName = path.split('/').pop() || '';
		return fileName.replace('.md', '');
	}
}

class PromptSelectionModal extends SuggestModal<PromptInfo> {
	constructor(
		app: App,
		private promptManager: PromptManager,
		private targetFile: TFile,
		private prompts: PromptInfo[]
	) {
		super(app);
		this.setPlaceholder('Select a custom prompt to apply...');
	}

	getSuggestions(query: string): PromptInfo[] {
		const lowerQuery = query.toLowerCase();
		if (!query) {
			return this.prompts;
		}
		return this.prompts.filter(prompt => 
			prompt.name.toLowerCase().includes(lowerQuery) ||
			prompt.description.toLowerCase().includes(lowerQuery) ||
			prompt.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
		);
	}

	renderSuggestion(prompt: PromptInfo, el: HTMLElement): void {
		const container = el.createDiv({ cls: 'suggestion-content' });
		container.createDiv({ text: prompt.name, cls: 'suggestion-title' });
		if (prompt.description) {
			container.createDiv({ text: prompt.description, cls: 'suggestion-note' });
		}
		if (prompt.tags.length > 0) {
			const tagsEl = container.createDiv({ cls: 'suggestion-aux' });
			tagsEl.setText(`Tags: ${prompt.tags.join(', ')}`);
		}
	}

	onChooseSuggestion(prompt: PromptInfo, evt: MouseEvent | KeyboardEvent): void {
		// Use setTimeout to prevent blocking the modal close
		setTimeout(async () => {
			try {
				await this.promptManager.applyPromptToFile(this.targetFile, prompt);
			} catch (error) {
				console.error('Error applying prompt:', error);
				new Notice('Failed to apply custom prompt');
			}
		}, 0);
	}
}