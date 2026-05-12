import type ObsidianGemini from '../main';
import { Notice, App, MarkdownView, Modal, Setting, TextAreaComponent, TFile, normalizePath } from 'obsidian';
import { BaseModelRequest, GeminiClient, GeminiClientFactory } from '../api';
import { GeminiPrompts } from '../prompts';
import { getErrorMessage } from '../utils/error-utils';
import { ensureFolderExists } from '../utils/file-utils';

export class ImageGeneration {
	private plugin: ObsidianGemini;
	private client: GeminiClient;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
		this.prompts = new GeminiPrompts(plugin);
		this.client = new GeminiClient(
			{
				apiKey: plugin.apiKey,
				temperature: plugin.settings.temperature,
				topP: plugin.settings.topP,
				streamingEnabled: false,
			},
			this.prompts,
			plugin
		);
	}

	/**
	 * Generate an image as a background task and insert the wikilink at the
	 * cursor position when the task completes.
	 *
	 * Captures the target file path and cursor coordinates at submit time so
	 * the insertion lands in the right place even if the user navigates to
	 * another note while waiting (typical: image generation takes 30–90s).
	 *
	 * Behavior on completion:
	 *  - If the captured file is still open in a MarkdownView and the captured
	 *    cursor is still in-bounds → insert there.
	 *  - Otherwise → show a Notice containing the wikilink so the user can
	 *    paste it manually. The image file itself is always saved either way.
	 *
	 * Falls back to the original synchronous flow if `backgroundTaskManager`
	 * is unavailable, so the command keeps working during plugin startup or
	 * if the manager fails to initialise.
	 */
	async generateAndInsertImage(prompt: string): Promise<void> {
		const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active note. Please open a note first.');
			return;
		}

		const targetPath = activeView.file.path;
		const cursor = activeView.editor.getCursor();
		const taskManager = this.plugin.backgroundTaskManager;

		if (!taskManager) {
			await this.generateAndInsertSynchronously(prompt, activeView, cursor);
			return;
		}

		const label = prompt.length > 40 ? prompt.slice(0, 37) + '…' : prompt;
		taskManager.submit('image-generation', label, async (isCancelled) => {
			if (isCancelled()) return undefined;

			const base64Data = await this.client.generateImage(prompt, this.plugin.settings.imageModelName);
			if (isCancelled()) return undefined;

			const imagePath = await this.saveImageToVault(base64Data, prompt);
			if (isCancelled()) return imagePath;

			this.insertWikilinkAtCapturedPosition(targetPath, cursor, imagePath);
			return imagePath;
		});

		new Notice('Image generation submitted — you can keep working.', 3000);
	}

	/**
	 * Synchronous flow used as a fallback when BackgroundTaskManager is not
	 * initialised (e.g. early plugin startup).
	 */
	private async generateAndInsertSynchronously(
		prompt: string,
		activeView: MarkdownView,
		cursor: { line: number; ch: number }
	): Promise<void> {
		try {
			new Notice('Generating image...');
			const base64Data = await this.client.generateImage(prompt, this.plugin.settings.imageModelName);
			const imagePath = await this.saveImageToVault(base64Data, prompt);
			activeView.editor.replaceRange(`![[${imagePath}]]`, cursor);
			new Notice('Image generated and inserted successfully!');
		} catch (error) {
			const errorMsg = `Failed to generate image: ${getErrorMessage(error)}`;
			this.plugin.logger.error(errorMsg, error);
			new Notice(errorMsg);
		}
	}

	/**
	 * Insert a wikilink at the captured (file, cursor) coordinates if the
	 * file is still open in a MarkdownView and the cursor is in-bounds;
	 * otherwise show a Notice with the wikilink so the user can paste it
	 * manually. We don't silently modify a file the user isn't editing.
	 */
	private insertWikilinkAtCapturedPosition(
		targetPath: string,
		cursor: { line: number; ch: number },
		imagePath: string
	): void {
		const wikilink = `![[${imagePath}]]`;
		const file = this.plugin.app.vault.getAbstractFileByPath(targetPath);

		if (!(file instanceof TFile)) {
			this.notifyManualInsertion(wikilink, 'target note no longer exists');
			return;
		}

		let editorView: MarkdownView | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (editorView) return;
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === targetPath) {
				editorView = view;
			}
		});

		if (!editorView) {
			this.notifyManualInsertion(wikilink, 'note is no longer open');
			return;
		}

		const editor = (editorView as MarkdownView).editor;
		if (cursor.line >= editor.lineCount()) {
			this.notifyManualInsertion(wikilink, 'cursor position is no longer valid');
			return;
		}
		const lineLength = editor.getLine(cursor.line).length;
		const safeCh = Math.min(cursor.ch, lineLength);
		editor.replaceRange(wikilink, { line: cursor.line, ch: safeCh });
	}

	private notifyManualInsertion(wikilink: string, reason: string): void {
		new Notice(`Image saved (${reason}). Wikilink: ${wikilink}`, 10000);
	}

	/**
	 * Generate an image and return the file path.
	 * Used by the agent tool.
	 *
	 * @param prompt     - Text description of the image to generate
	 * @param outputPath - Optional: explicit vault path for the output file.
	 *                     When omitted, the image lands in [state-folder]/Background-Tasks/.
	 */
	async generateImage(prompt: string, outputPath?: string): Promise<string> {
		try {
			// Generate the image
			const base64Data = await this.client.generateImage(prompt, this.plugin.settings.imageModelName);

			// Save the image to vault
			return await this.saveImageToVault(base64Data, prompt, outputPath);
		} catch (error) {
			this.plugin.logger.error('Failed to generate image:', error);
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
	 * Resolve the exact vault path an image will be saved at, for either an
	 * explicit caller-supplied path or the Background-Tasks default.
	 *
	 * When `outputPath` is provided, validates it and rewrites the extension
	 * to `.png` (saveImageToVault writes PNG bytes unconditionally). When it
	 * isn't, falls back to [state-folder]/Background-Tasks/<generated-filename>.
	 *
	 * Used by background mode of GenerateImageTool to pre-compute the path at
	 * submit time and return it synchronously — the agent relies on this path
	 * being the exact location it can later `read_file`. Must stay in sync
	 * with saveImageToVault so the promise-at-submit matches the
	 * actual-write.
	 *
	 * Throws synchronously on an invalid explicit path (vault escape,
	 * protected folder, etc.).
	 */
	async resolveOutputPath(prompt: string, outputPath?: string): Promise<string> {
		if (outputPath) {
			// Runs the same validation/normalisation saveImageToVault uses,
			// including rewriting any non-.png extension to .png.
			return this.validateOutputPath(outputPath);
		}
		return this.resolveDefaultOutputPath(prompt);
	}

	/**
	 * Resolve the path the image WOULD be saved at when no explicit `outputPath`
	 * is given. Writes to [state-folder]/Background-Tasks/ so all background
	 * outputs share one predictable location alongside deep-research reports.
	 *
	 * Prefer `resolveOutputPath` for callers that may or may not have an
	 * explicit path — it handles both branches consistently. This method is
	 * kept public for callers that specifically want the default flow.
	 */
	async resolveDefaultOutputPath(prompt: string): Promise<string> {
		const filename = this.buildDefaultFilename(prompt);
		const backgroundTasksFolder = normalizePath(`${this.plugin.settings.historyFolder}/Background-Tasks`);
		return normalizePath(`${backgroundTasksFolder}/${filename}`);
	}

	/**
	 * Build the default filename used when no explicit outputPath is given.
	 * Centralised so resolveDefaultOutputPath and saveImageToVault can't drift.
	 *
	 * Includes a timestamp AND a short random suffix so two concurrent
	 * background tasks can't propose the same path. `vault.createBinary`
	 * throws if the target exists, so two tasks landing on the same name
	 * within the same millisecond would otherwise collide; the random suffix
	 * drops collision probability to ~1-in-2-billion per same-millisecond
	 * submission with the same prompt slice.
	 */
	private buildDefaultFilename(prompt: string): string {
		const sanitizedPrompt = prompt
			.substring(0, 50)
			.replace(/[^a-zA-Z0-9\-_]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
		const randomSuffix = Math.random().toString(36).substring(2, 8);
		return `generated-${sanitizedPrompt}-${Date.now()}-${randomSuffix}.png`;
	}

	/**
	 * Validate and normalize an explicit output path supplied by the caller.
	 * Rejects paths that escape the vault, target protected system folders, or
	 * land inside the plugin state folder — important because GenerateImageTool
	 * can be invoked autonomously by the agent (#634).
	 * Always returns a path ending with ".png" since the code always writes PNG bytes.
	 */
	private validateOutputPath(outputPath: string): string {
		const normalized = normalizePath(outputPath);

		// Reject directory-only paths (empty or trailing slash)
		if (!normalized || normalized.endsWith('/')) {
			throw new Error(`Output path must include a filename: "${outputPath}"`);
		}

		// Reject vault-escaping paths (normalizePath does not resolve ..)
		if (normalized.startsWith('..') || normalized.split('/').includes('..')) {
			throw new Error(`Output path escapes the vault: "${outputPath}"`);
		}

		// Reject paths inside .obsidian/
		if (normalized.split('/').includes('.obsidian')) {
			throw new Error(`Output path cannot be inside the Obsidian configuration folder: "${outputPath}"`);
		}

		// Always ensure the file ends with .png — the code always writes PNG bytes.
		// Rewrite extension before the state-folder check so the validated path
		// matches what will actually be written (e.g. "Background-Tasks" bare →
		// "Background-Tasks.png", which is outside the allowed subfolder).
		const dotIndex = normalized.lastIndexOf('.');
		const slashIndex = normalized.lastIndexOf('/');
		const hasExtension = dotIndex > slashIndex + 1;
		const normalizedFilePath = hasExtension ? normalized.slice(0, dotIndex) + '.png' : normalized + '.png';

		// Reject paths inside the plugin state folder, except for the canonical
		// Background-Tasks/ subfolder which is the designated output location.
		const historyFolder = this.plugin.settings.historyFolder;
		if (historyFolder) {
			const normalizedHistoryFolder = normalizePath(historyFolder);
			const backgroundTasksFolder = normalizePath(`${normalizedHistoryFolder}/Background-Tasks`);
			const insideStateFolder =
				normalizedFilePath === normalizedHistoryFolder || normalizedFilePath.startsWith(normalizedHistoryFolder + '/');
			const insideBackgroundTasks = normalizedFilePath.startsWith(backgroundTasksFolder + '/');
			if (insideStateFolder && !insideBackgroundTasks) {
				throw new Error(`Output path cannot be inside the plugin state folder: "${outputPath}"`);
			}
		}

		return normalizedFilePath;
	}

	/**
	 * Save base64 image data to the vault.
	 *
	 * @param base64Data - Base64 encoded image data
	 * @param prompt     - The prompt used to generate the image (used for filename generation)
	 * @param outputPath - Optional explicit vault path for the file; falls back to the Background-Tasks default
	 */
	private async saveImageToVault(base64Data: string, prompt: string, outputPath?: string): Promise<string> {
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
		const bytes = Uint8Array.from(binaryData, (c) => c.charCodeAt(0));

		let resolvedPath: string;

		if (outputPath) {
			// Caller specified an explicit path — validate and normalize before use.
			// Rejects vault-escaping and protected-folder paths (see validateOutputPath).
			resolvedPath = this.validateOutputPath(outputPath);

			// Ensure the parent folder exists before writing — createBinary will fail
			// if any intermediate directory in the path is missing.
			const parentPath = resolvedPath.includes('/') ? resolvedPath.slice(0, resolvedPath.lastIndexOf('/')) : null;
			if (parentPath) {
				await ensureFolderExists(this.plugin.app.vault, parentPath, 'image output folder', this.plugin.logger);
			}
		} else {
			resolvedPath = await this.resolveDefaultOutputPath(prompt);
		}

		// Save to vault
		await this.plugin.app.vault.createBinary(resolvedPath, bytes.buffer);

		return resolvedPath;
	}

	/**
	 * Prompt the user to enter an image description.
	 *
	 * Public because the command-palette entry for image generation lives in
	 * `main.ts` (so the provider gate stays consistent with the RAG commands)
	 * and drives this dialog directly.
	 */
	async promptForImageDescription(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new ImagePromptModal(this.plugin.app, this.plugin, this, (prompt) => {
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
	private plugin: ObsidianGemini;
	private imageGeneration: ImageGeneration;
	private onSubmit: (prompt: string) => void;
	private prompt = '';
	private textArea: TextAreaComponent | null = null;

	constructor(app: App, plugin: ObsidianGemini, imageGeneration: ImageGeneration, onSubmit: (prompt: string) => void) {
		super(app);
		this.plugin = plugin;
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
				text
					.setPlaceholder('A serene landscape with mountains and a lake...')
					.setValue(this.prompt)
					.onChange((value) => {
						this.prompt = value;
					});
				text.inputEl.rows = 4;
				text.inputEl.cols = 40;
				// Focus the text area
				window.setTimeout(() => text.inputEl.focus(), 100);
			});

		// Add "Generate from Page" button
		new Setting(contentEl)
			.setName('Generate prompt from current page')
			.setDesc("Let AI suggest an image prompt based on this page's content")
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
			const errorMsg = `Failed to generate prompt: ${getErrorMessage(error)}`;
			this.plugin.logger.error(errorMsg, error);
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
