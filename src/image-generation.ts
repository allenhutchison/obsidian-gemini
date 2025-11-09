import ObsidianGemini from './main';
import { Notice, App, Modal, Setting, TextAreaComponent } from 'obsidian';
import { GeminiClient } from './api/gemini-client';
import { GeminiPrompts } from './prompts/gemini-prompts';
import { GeminiClientFactory } from './api/simple-factory';
import { BaseModelRequest } from './api/index';

export class ImageGeneration {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private client: GeminiClient;
	private prompts: GeminiPrompts;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
		this.client = new GeminiClient(
			{
				apiKey: plugin.settings.apiKey,
				temperature: plugin.settings.temperature,
				topP: plugin.settings.topP,
				streamingEnabled: false
			},
			this.prompts,
			plugin
		);
	}

	/**
	 * Generate an image and insert it at the cursor position
	 */
	async generateAndInsertImage(prompt: string): Promise<void> {
		const editor = this.plugin.app.workspace.activeEditor?.editor;
		if (!editor) {
			new Notice('No active editor. Please open a note first.');
			return;
		}

		try {
			new Notice('Generating image...');

			// Generate the image
			const base64Data = await this.client.generateImage(prompt);

			// Save the image to vault
			const imagePath = await this.saveImageToVault(base64Data, prompt);

			// Insert markdown link at cursor
			const cursor = editor.getCursor();
			editor.replaceRange(`![[${imagePath}]]`, cursor);

			new Notice('Image generated and inserted successfully!');
		} catch (error) {
			const errorMsg = `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`;
			console.error(errorMsg, error);
			new Notice(errorMsg);
		}
	}

	/**
	 * Generate an image and return the file path
	 * Used by the agent tool
	 * @param prompt - Text description of the image to generate
	 * @param targetNotePath - Optional path to a note to use as reference for attachment folder
	 */
	async generateImage(prompt: string, targetNotePath?: string): Promise<string> {
		try {
			// Generate the image
			const base64Data = await this.client.generateImage(prompt);

			// Save the image to vault
			return await this.saveImageToVault(base64Data, prompt, targetNotePath);
		} catch (error) {
			console.error('Failed to generate image:', error);
			throw error;
		}
	}

	/**
	 * Generate a suggested image prompt based on the current page's content
	 * Uses the summary model to analyze the content and suggest an image prompt
	 */
	async suggestPromptFromPage(): Promise<string> {
		const fileContent = await this.plugin.gfile.getCurrentFileContent(true);
		if (!fileContent) {
			throw new Error('Failed to get file content');
		}

		// Create a summary-specific model API for prompt generation
		const modelApi = GeminiClientFactory.createSummaryModel(this.plugin);

		const request: BaseModelRequest = {
			prompt: this.prompts.imagePromptGenerator({ content: fileContent }),
		};

		const response = await modelApi.generateModelResponse(request);
		return response.markdown.trim();
	}

	/**
	 * Save base64 image data to the vault
	 * @param base64Data - Base64 encoded image data
	 * @param prompt - The prompt used to generate the image
	 * @param targetNotePath - Optional path to a note to use as reference for attachment folder
	 */
	private async saveImageToVault(base64Data: string, prompt: string, targetNotePath?: string): Promise<string> {
		// Create a safe filename from the prompt (truncate and sanitize)
		const sanitizedPrompt = prompt
			.substring(0, 50)
			.replace(/[^a-zA-Z0-9\-_]/g, '-')  // More restrictive: only alphanumeric, hyphens, and underscores
			.replace(/-+/g, '-')  // Collapse multiple dashes
			.replace(/^-|-$/g, '');  // Trim leading/trailing dashes

		const timestamp = Date.now();
		const filename = `generated-${sanitizedPrompt}-${timestamp}.png`;

		// Convert base64 to binary with validation
		let binaryData: string;
		try {
			binaryData = atob(base64Data);
			if (binaryData.length === 0) {
				throw new Error('Empty image data');
			}
		} catch (error) {
			throw new Error(`Invalid base64 image data: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}

		// Convert binary string to Uint8Array
		const bytes = Uint8Array.from(binaryData, c => c.charCodeAt(0));

		// Determine reference note path for attachment folder
		let referenceNotePath: string;
		if (targetNotePath) {
			// Use provided target note path
			referenceNotePath = targetNotePath;
		} else {
			// Fall back to active file
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (!activeFile) {
				throw new Error('No active file and no target note path provided');
			}
			referenceNotePath = activeFile.path;
		}

		// Use Obsidian's built-in method to get the correct path for attachments
		const path = await this.plugin.app.fileManager.getAvailablePathForAttachment(
			filename,
			referenceNotePath
		);

		// Save to vault
		await this.plugin.app.vault.createBinary(path, bytes.buffer);

		return path;
	}

	/**
	 * Setup command palette command for image generation
	 */
	async setupImageGenerationCommand() {
		this.plugin.addCommand({
			id: 'gemini-scribe-generate-image',
			name: 'Generate Image',
			callback: async () => {
				// Prompt user for image description
				const prompt = await this.promptForImageDescription();
				if (prompt) {
					await this.generateAndInsertImage(prompt);
				}
			}
		});
	}

	/**
	 * Prompt the user to enter an image description
	 */
	private async promptForImageDescription(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new ImagePromptModal(this.plugin.app, this, (prompt) => {
				resolve(prompt);
			});
			modal.open();
		});
	}
}

/**
 * Modal for prompting user to enter image description
 */
class ImagePromptModal extends Modal {
	private imageGeneration: ImageGeneration;
	private onSubmit: (prompt: string) => void;
	private prompt = '';
	private textArea: TextAreaComponent | null = null;

	constructor(app: App, imageGeneration: ImageGeneration, onSubmit: (prompt: string) => void) {
		super(app);
		this.imageGeneration = imageGeneration;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Generate Image' });

		new Setting(contentEl)
			.setName('Image description')
			.setDesc('Describe the image you want to generate')
			.addTextArea((text) => {
				this.textArea = text;
				text.setPlaceholder('A serene landscape with mountains and a lake...')
					.setValue(this.prompt)
					.onChange((value) => {
						this.prompt = value;
					});
				text.inputEl.rows = 4;
				text.inputEl.cols = 40;
				// Focus the text area
				setTimeout(() => text.inputEl.focus(), 100);
			});

		// Add "Generate from Page" button
		new Setting(contentEl)
			.setName('Generate prompt from current page')
			.setDesc('Let AI suggest an image prompt based on this page\'s content')
			.addButton((btn) =>
				btn
					.setButtonText('Generate Prompt from Page')
					.setIcon('sparkles')
					.onClick(async () => {
						await this.handleGenerateFromPage(btn.buttonEl);
					})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Generate Image')
					.setCta()
					.onClick(() => {
						if (this.prompt.trim()) {
							this.close();
							this.onSubmit(this.prompt.trim());
						}
					})
			)
			.addButton((btn) =>
				btn.setButtonText('Cancel').onClick(() => {
					this.close();
					this.onSubmit('');
				})
			);
	}

	private async handleGenerateFromPage(buttonEl: HTMLElement) {
		const originalText = buttonEl.textContent;
		try {
			// Show loading state
			buttonEl.textContent = 'Generating...';
			buttonEl.setAttribute('disabled', 'true');

			// Generate suggested prompt
			const suggestedPrompt = await this.imageGeneration.suggestPromptFromPage();

			// Update text area with suggested prompt
			if (this.textArea) {
				this.textArea.setValue(suggestedPrompt);
				this.prompt = suggestedPrompt;
			}

			new Notice('Prompt generated! Feel free to edit it before generating the image.');
		} catch (error) {
			const errorMsg = `Failed to generate prompt: ${error instanceof Error ? error.message : String(error)}`;
			console.error(errorMsg, error);
			new Notice(errorMsg);
		} finally {
			// Restore button state
			buttonEl.textContent = originalText;
			buttonEl.removeAttribute('disabled');
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
