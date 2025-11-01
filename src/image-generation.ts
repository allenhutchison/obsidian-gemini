import ObsidianGemini from './main';
import { Notice } from 'obsidian';
import { GeminiClient } from './api/gemini-client';
import { GeminiPrompts } from './prompts';

export class ImageGeneration {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private client: GeminiClient;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		const prompts = new GeminiPrompts(plugin);
		this.client = new GeminiClient(
			{
				apiKey: plugin.settings.apiKey,
				temperature: plugin.settings.temperature,
				topP: plugin.settings.topP,
				streamingEnabled: false
			},
			prompts,
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
	 */
	async generateImage(prompt: string): Promise<string> {
		try {
			// Generate the image
			const base64Data = await this.client.generateImage(prompt);

			// Save the image to vault
			return await this.saveImageToVault(base64Data, prompt);
		} catch (error) {
			console.error('Failed to generate image:', error);
			throw error;
		}
	}

	/**
	 * Save base64 image data to the vault
	 */
	private async saveImageToVault(base64Data: string, prompt: string): Promise<string> {
		// Create a safe filename from the prompt (truncate and sanitize)
		const sanitizedPrompt = prompt
			.substring(0, 50)
			.replace(/[^a-z0-9]/gi, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');

		const timestamp = Date.now();
		const filename = `generated-${sanitizedPrompt}-${timestamp}.png`;

		// Determine where to save (either in attachments folder or root)
		const attachmentFolder = (this.plugin.app.vault as any).getConfig?.('attachmentFolderPath') || '';
		const filePath = attachmentFolder ? `${attachmentFolder}/${filename}` : filename;

		// Ensure the attachment folder exists
		if (attachmentFolder) {
			const folder = this.plugin.app.vault.getAbstractFileByPath(attachmentFolder);
			if (!folder) {
				await this.plugin.app.vault.createFolder(attachmentFolder);
			}
		}

		// Convert base64 to binary
		const binaryData = atob(base64Data);
		const bytes = new Uint8Array(binaryData.length);
		for (let i = 0; i < binaryData.length; i++) {
			bytes[i] = binaryData.charCodeAt(i);
		}

		// Save to vault
		await this.plugin.app.vault.createBinary(filePath, bytes.buffer);

		return filePath;
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
			const modal = new ImagePromptModal(this.plugin.app, (prompt) => {
				resolve(prompt);
			});
			modal.open();
		});
	}
}

/**
 * Modal for prompting user to enter image description
 */
import { App, Modal, Setting } from 'obsidian';

class ImagePromptModal extends Modal {
	private onSubmit: (prompt: string) => void;
	private prompt = '';

	constructor(app: App, onSubmit: (prompt: string) => void) {
		super(app);
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

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('Generate')
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

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
