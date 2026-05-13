import { Vault, TFile, TFolder, normalizePath, Notice, Modal, App } from 'obsidian';
import type ObsidianGemini from '../main';
import { CustomPrompt, PromptInfo } from './types';
import { BundledPromptRegistry } from './bundled-prompts';

export class PromptManager {
	constructor(
		private plugin: ObsidianGemini,
		private vault: Vault
	) {}

	// Get the prompts directory path
	getPromptsDirectory(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/Prompts`);
	}

	// Load a prompt from file
	async loadPromptFromFile(filePath: string): Promise<CustomPrompt | null> {
		try {
			const file = this.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return null;

			// Use Obsidian's metadata cache to get frontmatter
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter || {};

			// Get content without frontmatter using frontmatterPosition
			const fullContent = await this.vault.read(file);
			let contentWithoutFrontmatter: string;

			if (cache?.frontmatterPosition) {
				// Skip to content after frontmatter (frontmatterPosition.end.offset includes closing ---)
				contentWithoutFrontmatter = fullContent.slice(cache.frontmatterPosition.end.offset).trim();
			} else {
				// No frontmatter - use full content
				contentWithoutFrontmatter = fullContent;
			}

			// Parse tags - normalize to array of lowercase strings
			let rawTags = frontmatter.tags;
			if (typeof rawTags === 'string') {
				rawTags = [rawTags];
			} else if (!Array.isArray(rawTags)) {
				rawTags = [];
			}
			const tags = rawTags
				.filter((t: unknown): t is string => typeof t === 'string')
				.map((t: string) => t.toLowerCase());

			return {
				name: frontmatter.name || 'Unnamed Prompt',
				description: frontmatter.description || '',
				version: frontmatter.version || 1,
				overrideSystemPrompt: frontmatter.override_system_prompt || false,
				tags: tags,
				content: contentWithoutFrontmatter.trim(),
			};
		} catch (error) {
			this.plugin.logger.error('Error loading prompt file:', error);
			return null;
		}
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
		const markdownFiles = this.vault.getMarkdownFiles().filter((file) => file.path.startsWith(promptsDir));

		for (const file of markdownFiles) {
			const prompt = await this.loadPromptFromFile(file.path);
			if (prompt) {
				prompts.push({
					path: file.path,
					name: prompt.name,
					description: prompt.description,
					tags: prompt.tags,
				});
			}
		}

		return prompts;
	}

	// List prompts filtered by a specific tag
	async listPromptsByTag(tag: string): Promise<PromptInfo[]> {
		const normalizedTag = String(tag).toLowerCase();
		const allPrompts = await this.listAvailablePrompts();
		return allPrompts.filter((prompt) =>
			prompt.tags.some((t) => typeof t === 'string' && t.toLowerCase() === normalizedTag)
		);
	}

	// List all selection prompts (vault + bundled)
	async listSelectionPrompts(): Promise<PromptInfo[]> {
		const tag = 'gemini-scribe/selection-prompt';
		const vaultPrompts = await this.listPromptsByTag(tag);

		const bundledPrompts = BundledPromptRegistry.getPrompts()
			.filter((p) => p.tags.includes(tag))
			.map((p) => ({
				path: `bundled:${p.name}`,
				name: p.name,
				description: p.description,
				tags: p.tags,
			}));

		// Merge, vault takes priority if names match
		const result: PromptInfo[] = [...vaultPrompts];
		const vaultNames = new Set(vaultPrompts.map((p) => p.name));

		for (const bp of bundledPrompts) {
			if (!vaultNames.has(bp.name)) {
				result.push(bp);
			}
		}

		return result;
	}

	// Load prompt by path (vault or bundled)
	async loadPrompt(path: string): Promise<CustomPrompt | null> {
		if (path.startsWith('bundled:')) {
			const name = path.slice(8);
			const allBundled = BundledPromptRegistry.getPrompts();
			const bundled = allBundled.find((p) => p.name === name);
			if (!bundled) return null;

			return {
				name: bundled.name,
				description: bundled.description,
				version: 1,
				overrideSystemPrompt: false,
				tags: bundled.tags,
				content: bundled.content,
			};
		}

		return this.loadPromptFromFile(path);
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

		try {
			await this.vault.create(examplePromptPath, exampleContent);
		} catch (error) {
			// Ignore if file was created concurrently (race condition); rethrow otherwise
			if (!(error instanceof Error) || !/exist/i.test(error.message)) {
				throw error;
			}
		}
	}

	// Setup commands for prompt management
	setupPromptCommands(): void {
		this.plugin.addCommand({
			id: 'gemini-scribe-create-custom-prompt',
			name: 'Create New Custom Prompt',
			callback: () => this.createNewCustomPrompt(),
		});
	}

	// Create a new custom prompt file
	async createNewCustomPrompt(): Promise<void> {
		try {
			// Open input modal for prompt name
			const modal = new PromptNameModal(this.plugin.app, async (promptName: string) => {
				if (!promptName || promptName.trim() === '') {
					new Notice('Prompt name cannot be empty');
					return;
				}

				// Sanitize filename (remove special characters, keep alphanumeric, spaces, hyphens, underscores)
				const sanitizedName = promptName
					.trim()
					.replace(/[^\w\s-]/g, '')
					.replace(/\s+/g, '-');
				if (!sanitizedName) {
					new Notice('Invalid prompt name. Please use alphanumeric characters, spaces, hyphens, or underscores.');
					return;
				}

				const promptsDir = this.getPromptsDirectory();
				const fileName = `${sanitizedName.toLowerCase()}.md`;
				const filePath = normalizePath(`${promptsDir}/${fileName}`);

				// Check if file already exists
				const existingFile = this.vault.getAbstractFileByPath(filePath);
				if (existingFile) {
					new Notice(`A prompt file named "${fileName}" already exists.`);
					return;
				}

				// Create template content
				const templateContent = `---
name: "${promptName}"
description: "Brief description of what this prompt does"
version: 1
override_system_prompt: false
tags: ["category", "type"]
---

# Instructions for the AI

Your custom prompt content goes here. This will modify how the AI behaves when applied to a session.

## Tips:
- Be specific about the desired behavior
- Include examples if helpful
- Consider the context this will be used in

## Example Usage:
This prompt will be applied to sessions and will supplement the default system prompt unless override_system_prompt is set to true.`;

				try {
					// Create the file
					const newFile = await this.vault.create(filePath, templateContent);

					// Open the file for editing
					await this.plugin.app.workspace.openLinkText(newFile.path, '', true);

					new Notice(`Created new custom prompt: ${promptName}`);
				} catch (error) {
					this.plugin.logger.error('Error creating prompt file:', error);
					new Notice('Failed to create prompt file');
				}
			});

			modal.open();
		} catch (error) {
			this.plugin.logger.error('Error creating new custom prompt:', error);
			new Notice('Failed to create new custom prompt');
		}
	}
}

class PromptNameModal extends Modal {
	private inputEl!: HTMLInputElement;
	private onSubmit: (promptName: string) => void;

	constructor(app: App, onSubmit: (promptName: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Create New Custom Prompt' });

		const inputContainer = contentEl.createDiv({ cls: 'prompt-input-container' });
		inputContainer.createEl('label', { text: 'Prompt Name:' });

		this.inputEl = inputContainer.createEl('input', {
			type: 'text',
			placeholder: 'Enter a name for your custom prompt...',
		});

		this.inputEl.style.width = '100%';
		this.inputEl.style.marginTop = '8px';
		this.inputEl.style.padding = '8px';
		this.inputEl.style.border = '1px solid var(--background-modifier-border)';
		this.inputEl.style.borderRadius = '4px';

		// Handle Enter key
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.submit();
			} else if (event.key === 'Escape') {
				this.close();
			}
		});

		const buttonContainer = contentEl.createDiv({ cls: 'prompt-button-container' });
		buttonContainer.style.marginTop = '16px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.justifyContent = 'flex-end';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.style.padding = '8px 16px';
		cancelButton.addEventListener('click', () => this.close());

		const createButton = buttonContainer.createEl('button', { text: 'Create' });
		createButton.style.padding = '8px 16px';
		createButton.style.backgroundColor = 'var(--interactive-accent)';
		createButton.style.color = 'var(--text-on-accent)';
		createButton.style.border = 'none';
		createButton.style.borderRadius = '4px';
		createButton.addEventListener('click', () => this.submit());

		// Focus the input
		window.setTimeout(() => this.inputEl.focus(), 100);
	}

	private submit() {
		const promptName = this.inputEl.value.trim();
		if (promptName) {
			this.close();
			this.onSubmit(promptName);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
