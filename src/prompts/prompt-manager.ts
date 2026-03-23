import { Vault, TFile, TFolder, normalizePath, Notice, Modal, App } from 'obsidian';
import ObsidianGemini from '../main';
import { CustomPrompt, PromptInfo } from './types';
import { ensureFolderExists } from '../utils/file-utils';

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
		await ensureFolderExists(this.vault, this.plugin.settings.historyFolder, 'plugin state', this.plugin.logger);
		await ensureFolderExists(this.vault, this.getPromptsDirectory(), 'prompts', this.plugin.logger);
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

	// Create default selection action prompts on first use
	async createDefaultSelectionPrompts(): Promise<void> {
		const promptsDir = this.getPromptsDirectory();
		await this.ensurePromptsDirectory();

		const defaultPrompts = [
			{
				filename: 'explain-selection.md',
				content: `---
name: "Explain Selection"
description: "Get a clear explanation of the selected text"
version: 1
override_system_prompt: false
tags: ["selection-action", "explain"]
---

Please explain the following text in a clear and accessible way:

- Break down any complex concepts
- Define technical terms if present
- Provide relevant context if helpful
- Use examples to illustrate key points`,
			},
			{
				filename: 'explain-code.md',
				content: `---
name: "Explain Code"
description: "Get a detailed walkthrough of selected code"
version: 1
override_system_prompt: false
tags: ["selection-action", "code", "explain"]
---

Please provide a detailed explanation of this code:

- Explain what the code does step by step
- Describe the purpose of key variables and functions
- Note any patterns or techniques being used
- Mention potential edge cases or considerations
- Suggest improvements if appropriate`,
			},
			{
				filename: 'summarize-selection.md',
				content: `---
name: "Summarize Selection"
description: "Get a concise summary of the selected text"
version: 1
override_system_prompt: false
tags: ["selection-action", "summarize"]
---

Please provide a concise summary of the following text:

- Capture the main points and key takeaways
- Keep it brief but comprehensive
- Preserve the essential meaning
- Use bullet points if appropriate`,
			},
		];

		for (const prompt of defaultPrompts) {
			const promptPath = normalizePath(`${promptsDir}/${prompt.filename}`);
			const existingFile = this.vault.getAbstractFileByPath(promptPath);
			if (!existingFile) {
				try {
					const createdFile = await this.vault.create(promptPath, prompt.content);
					// Wait for metadata cache to index the new file
					await this.waitForMetadataCache(createdFile);
				} catch (error) {
					// Ignore if file was created concurrently (race condition); rethrow otherwise
					if (!(error instanceof Error) || !/exist/i.test(error.message)) {
						throw error;
					}
				}
			}
		}
	}

	// Wait for metadata cache to index a file
	private waitForMetadataCache(file: TFile): Promise<void> {
		return new Promise((resolve) => {
			// Check if already cached
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				resolve();
				return;
			}

			// Wait for the cache to be updated
			const onCacheChange = (changedFile: TFile) => {
				if (changedFile.path === file.path) {
					this.plugin.app.metadataCache.off('changed', onCacheChange);
					resolve();
				}
			};

			this.plugin.app.metadataCache.on('changed', onCacheChange);

			// Timeout after 2 seconds to prevent hanging
			setTimeout(() => {
				this.plugin.app.metadataCache.off('changed', onCacheChange);
				resolve();
			}, 2000);
		});
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
			// Ensure prompts directory exists
			await this.ensurePromptsDirectory();

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
	private inputEl: HTMLInputElement;
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
		setTimeout(() => this.inputEl.focus(), 100);
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
