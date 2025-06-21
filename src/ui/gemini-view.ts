import ObsidianGemini from '../../main';
import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile, setIcon } from 'obsidian';
import { ModelRewriteMode } from '../rewrite';
import { ExtendedModelRequest } from '../api/index';
import { GeminiPrompts } from '../prompts';
import { GEMINI_MODELS } from '../models';
import { GeminiConversationEntry } from '../types/conversation';
import { logDebugInfo } from '../api/utils/debug';
import { CustomPrompt } from '../prompts/types';

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
	private plugin: ObsidianGemini;
	private rewriteMode: ModelRewriteMode;
	private prompts: GeminiPrompts;
	private chatbox: HTMLDivElement;
	private currentFile: TFile | null;
	private observer: MutationObserver | null;
	private shoudRewriteFile: boolean;
	private timerDisplay: HTMLDivElement;
	private timerInterval: NodeJS.Timeout | null = null;
	private startTime: number | null = null;
	private modelPicker: HTMLSelectElement | null;
	private settingsUnsubscribe: (() => void) | null = null;
	private fileOpenHandler: (file: TFile | null) => Promise<void>;
	private currentStreamingResponse: { cancel: () => void } | null = null;
	private scrollTimeout: NodeJS.Timeout | null = null;
	private promptIndicator: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianGemini) {
		super(leaf);
		this.plugin = plugin;
		this.rewriteMode = new ModelRewriteMode(plugin);
		this.prompts = new GeminiPrompts(plugin);
		this.registerLinkClickHandler();
		this.registerSettingsListener();

		// Bind the handler to preserve 'this' context
		this.fileOpenHandler = this.handleFileOpen.bind(this);
	}

	private registerSettingsListener() {
		// Store the original saveSettings function
		const originalSaveSettings = this.plugin.saveSettings.bind(this.plugin);

		// Override with our version that updates the UI
		this.plugin.saveSettings = async () => {
			await originalSaveSettings();
			// When settings save, rebuild the UI and reload data
			await this._rebuildUIDueToSettingsChange();
		};

		// Store the unsubscribe function
		this.settingsUnsubscribe = () => {
			this.plugin.saveSettings = originalSaveSettings;
		};
	}

	private async _rebuildUIDueToSettingsChange() {
		if (!this.contentEl) {
			logDebugInfo(
				this.plugin.settings.debugMode,
				'GeminiView: contentEl not available for UI rebuild on settings change.',
				null
			);
			return;
		}

		logDebugInfo(this.plugin.settings.debugMode, 'GeminiView: Rebuilding UI due to settings change.', null);
		this._buildViewDOM(this.contentEl); // Rebuild DOM

		// Reload chat for current file
		// handleFileOpen will call updateChat which calls clearChat then populates.
		const activeFile = this.plugin.gfile.getActiveFile();
		if (activeFile) {
			await this.handleFileOpen(activeFile); // This will populate the new chatbox
		} else {
			// If no file is active, the new chatbox (created by _buildViewDOM) is empty, which is correct.
			// We ensure chatbox is cleared by _buildViewDOM or if handleFileOpen clears it.
			// If chatbox exists, clear it.
			if (this.chatbox) {
				this.clearChat();
			}
		}
	}

	private _buildViewDOM(container: HTMLElement) {
		container.empty();
		container.createEl('h2', { text: 'Gemini Chat' });
		
		// Prompt indicator
		this.promptIndicator = container.createDiv({ cls: 'gemini-scribe-prompt-indicator' });
		this.promptIndicator.style.display = 'none'; // Hidden by default

		// The top level application
		this.chatbox = container.createDiv({ cls: 'gemini-scribe-chatbox' });

		// User input and send button
		const inputArea = container.createDiv({ cls: 'gemini-scribe-input-area' });
		const userInput = inputArea.createEl('textarea', {
			cls: 'gemini-scribe-chat-input',
			attr: { placeholder: 'Type your message here...' },
		});
		const sendContainer = inputArea.createDiv({
			cls: 'gemini-scribe-send-container',
		});
		const sendButton = sendContainer.createEl('button', {
			text: 'Send',
			cls: 'gemini-scribe-send-button',
		});
		setIcon(sendButton, 'send-horizontal');
		this.timerDisplay = sendContainer.createDiv({ cls: 'gemini-scribe-timer' });

		// Add checkbox container below input area
		if (this.plugin.settings.rewriteFiles) {
			const optionsArea = container.createDiv({
				cls: 'gemini-scribe-options-area',
			});
			const rewriteCheckbox = optionsArea.createEl('input', {
				type: 'checkbox',
				cls: 'gemini-scribe-rewrite-checkbox',
			});
			optionsArea
				.createEl('label', {
					text: 'Rewrite file',
					cls: 'gemini-scribe-rewrite-label',
				})
				.prepend(rewriteCheckbox);

			rewriteCheckbox.addEventListener('change', () => {
				this.shoudRewriteFile = rewriteCheckbox.checked;
			});
		}

		// Model picker area - now below input and options
		if (this.plugin.settings.showModelPicker) {
			const modelPickerArea = container.createDiv({ cls: 'gemini-scribe-model-picker-area' });
			this.modelPicker = modelPickerArea.createEl('select', { cls: 'gemini-scribe-model-picker' });

			// Add model options from shared list
			GEMINI_MODELS.forEach((model) => {
				this.modelPicker!.createEl('option', {
					value: model.value,
					text: model.label,
				});
			});

			// Set the current model
			this.modelPicker!.value = this.plugin.settings.chatModelName;

			// Add change listener
			this.modelPicker!.addEventListener('change', async () => {
				this.plugin.settings.chatModelName = this.modelPicker!.value;
				await this.plugin.saveSettings();
			});
		} else {
			this.modelPicker = null;
		}

		userInput.addEventListener('keydown', async (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				sendButton.click();
			}
		});

		sendButton.addEventListener('click', async () => {
			const userMessage = userInput.value;
			if (userMessage.trim() !== '') {
				this.displayMessage(userMessage, 'user');
				userInput.value = '';
				this.startTimer();

				try {
					await this.sendMessage(userMessage);
				} catch (error) {
					console.error('Error during sendMessage call from button click:', error);
					new Notice('An unexpected error occurred while sending the message.');
				} finally {
					this.stopTimer();
				}
			}
		});

		// Observe changes in the chatbox
		if (this.observer) {
			this.observer.disconnect();
		}
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					this.scrollToBottom();
				}
			}
		});
		this.observer.observe(this.chatbox, {
			childList: true,
			subtree: true,
		});
	}

	registerLinkClickHandler() {
		this.containerEl.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.tagName === 'A' && target.classList.contains('internal-link')) {
				event.preventDefault();
				const filePath = target.getAttribute('href');
				if (filePath) {
					this.app.workspace.openLinkText(filePath, '', true);
				}
			}
		});
	}

	getViewType() {
		return VIEW_TYPE_GEMINI;
	}

	getDisplayText() {
		return 'Gemini Scribe';
	}

	getIcon() {
		return 'sparkles';
	}

	async onOpen() {
		this._buildViewDOM(this.contentEl);

		// Register the file-open handler
		this.registerEvent(this.app.workspace.on('file-open', this.fileOpenHandler));

		// Handle the currently active file
		const activeFile = this.plugin.gfile.getActiveFile();
		if (activeFile) {
			await this.handleFileOpen(activeFile);
		}
	}

	async onClose() {
		this.app.workspace.off('file-open', this.fileOpenHandler);
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		if (this.settingsUnsubscribe) {
			this.settingsUnsubscribe();
			this.settingsUnsubscribe = null;
		}
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
			this.scrollTimeout = null;
		}
	}

	// Update prompt indicator to show active custom prompt
	private async updatePromptIndicator(): Promise<void> {
		if (!this.currentFile || !this.plugin.settings.enableCustomPrompts) {
			this.promptIndicator.style.display = 'none';
			return;
		}

		const customPrompt = await this.plugin.promptManager.getPromptFromNote(this.currentFile);
		
		if (customPrompt) {
			// Show indicator in UI
			this.promptIndicator.setText(`Using prompt: ${customPrompt.name}`);
			this.promptIndicator.style.display = 'block';
		} else {
			this.promptIndicator.style.display = 'none';
		}
	}

	async displayMessage(
		message: string,
		sender: 'user' | 'model' | 'grounding',
		messageContainer?: HTMLDivElement,
		shouldScroll: boolean = true
	): Promise<HTMLDivElement> {
		let newMessageContainer: HTMLDivElement;
		let newMessage: HTMLDivElement;

		if (messageContainer) {
			// Use existing container for streaming updates
			newMessageContainer = messageContainer;
			newMessage = newMessageContainer.querySelector('.gemini-scribe-message') as HTMLDivElement;
		} else {
			// Create new container
			newMessageContainer = this.chatbox.createDiv({
				cls: `gemini-scribe-message-container ${sender}`,
			});
			const senderIndicator = newMessageContainer.createDiv({
				cls: 'gemini-scribe-sender-indicator',
			});
			newMessage = newMessageContainer.createDiv({
				cls: `gemini-scribe-message ${sender}`,
			});

			// Set the icon based on the sender.
			switch (sender) {
				case 'user':
					setIcon(senderIndicator, 'square-user');
					break;
				case 'model':
					setIcon(senderIndicator, 'bot-message-square');
					break;
				case 'grounding':
					setIcon(senderIndicator, 'search');
					break;
			}
		}

		// Google TOS requires that we display the search results in the plugin as the supplied HTML.
		// This is why we don't render the search results as markdown.
		if (sender === 'grounding') {
			newMessage.innerHTML = message;
		} else {
			const sourcePath = this.plugin.gfile.getActiveFile()?.path ?? '';
			await MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);
		}

		// Add a copy button to the message if it was sent by the model.
		if (sender === 'model' && !messageContainer) {
			const copyButton = newMessage.createEl('button', {
				cls: 'gemini-scribe-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Get the current text content for copying
				const currentText = newMessage.innerText || message;
				navigator.clipboard
					.writeText(currentText)
					.then(() => {
						new Notice('Message copied to clipboard.');
					})
					.catch((err) => {
						new Notice('Could not copy message to clipboard. Try selecting and copying manually.');
					});
			});
		}

		// Scroll to the bottom of the chatbox only if requested
		if (shouldScroll) {
			this.scrollToBottom();
		}

		return newMessageContainer;
	}

	async updateStreamingMessage(messageContainer: HTMLDivElement, newChunk: string): Promise<void> {
		const messageDiv = messageContainer.querySelector('.gemini-scribe-message') as HTMLDivElement;
		if (messageDiv) {
			// For streaming, we'll append the new chunk as plain text to avoid re-rendering
			// We'll do a final markdown render when streaming completes
			const textNode = document.createTextNode(newChunk);
			messageDiv.appendChild(textNode);
		}
	}

	async finalizeStreamingMessage(messageContainer: HTMLDivElement, fullMarkdown: string): Promise<void> {
		const messageDiv = messageContainer.querySelector('.gemini-scribe-message') as HTMLDivElement;
		if (messageDiv) {
			// Clear the div and render the final markdown
			messageDiv.empty();
			const sourcePath = this.plugin.gfile.getActiveFile()?.path ?? '';
			await MarkdownRenderer.render(this.app, fullMarkdown, messageDiv, sourcePath, this);

			// Add copy button now that the message is complete
			const copyButton = messageDiv.createEl('button', {
				cls: 'gemini-scribe-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Get the current text content for copying
				const currentText = messageDiv.innerText || fullMarkdown;
				navigator.clipboard
					.writeText(currentText)
					.then(() => {
						new Notice('Message copied to clipboard.');
					})
					.catch((err) => {
						new Notice('Could not copy message to clipboard. Try selecting and copying manually.');
					});
			});
		}
	}

	private async handleFileOpen(file: TFile | null) {
		if (!file) return;

		// Load the file content
		const content = await this.plugin.app.vault.read(file);
		this.currentFile = file;
		
		// Update prompt indicator
		await this.updatePromptIndicator();

		// Load history for this file
		const history = await this.plugin.history.getHistoryForFile(file);

		// Update the chat with the history
		this.updateChat(history);
	}

	private async updateChat(history: GeminiConversationEntry[]) {
		// Clear existing chat
		this.clearChat();

		// Display each message in order
		for (const entry of history) {
			// For model responses, also display any rendered content
			if (entry.role === 'model' && entry.metadata?.rendered) {
				this.displayMessage(entry.message, 'model');
				this.displayMessage(entry.metadata.rendered, 'grounding');
			} else {
				this.displayMessage(entry.message, entry.role);
			}
		}
	}

	clearChat() {
		if (this.chatbox) {
			this.chatbox.empty();
		}
	}

	async sendMessage(userMessage: string) {
		if (userMessage.trim() !== '') {
			if (this.shoudRewriteFile) {
				const history = (await this.plugin.history.getHistoryForFile(this.currentFile!)) ?? [];
				await this.rewriteMode.generateRewriteResponse(userMessage, history);
				return;
			}
			try {
				const history = (await this.plugin.history.getHistoryForFile(this.currentFile!)) ?? [];
				const prompt = this.prompts.generalPrompt({ userMessage: userMessage });
				
				// Get custom prompt if enabled and available
				let customPrompt: CustomPrompt | undefined = undefined;
				if (this.plugin.settings.enableCustomPrompts && this.currentFile) {
					const prompt = await this.plugin.promptManager.getPromptFromNote(this.currentFile);
					customPrompt = prompt || undefined;
				}
				
				const request: ExtendedModelRequest = {
					userMessage: userMessage,
					conversationHistory: history,
					model: this.plugin.settings.chatModelName,
					prompt: prompt,
					renderContent: true,
					customPrompt: customPrompt,
				};
				logDebugInfo(this.plugin.settings.debugMode, 'Sending message', request);

				// Check if streaming is supported
				if (this.plugin.geminiApi.generateStreamingResponse && this.plugin.settings.streamingEnabled !== false) {
					// Use streaming API
					let modelMessageContainer: HTMLDivElement | null = null;
					let accumulatedMarkdown = '';

					// User message already displayed by button handler

					const streamResponse = this.plugin.geminiApi.generateStreamingResponse(request, (chunk) => {
						accumulatedMarkdown += chunk;

						// Create or update the model message container
						if (!modelMessageContainer) {
							// First chunk - create the container with empty content (no copy button yet)
							this.displayMessage('', 'model').then((container) => {
								modelMessageContainer = container;
								// Now add the first chunk
								this.updateStreamingMessage(container, chunk);
							});
						} else {
							// Update existing container with new chunk
							this.updateStreamingMessage(modelMessageContainer, chunk);
							// Use debounced scroll to avoid stuttering
							this.debouncedScrollToBottom();
						}
					});

					// Store the streaming response for potential cancellation
					this.currentStreamingResponse = streamResponse;

					try {
						const botResponse = await streamResponse.complete;
						this.currentStreamingResponse = null;

						// Finalize the streaming message with proper markdown rendering and copy button
						if (modelMessageContainer) {
							await this.finalizeStreamingMessage(modelMessageContainer, botResponse.markdown);
						}

						if (this.plugin.settings.chatHistory) {
							// Store messages first
							await this.plugin.history.appendHistoryForFile(this.currentFile!, {
								role: 'user',
								message: userMessage,
							});

							await this.plugin.history.appendHistoryForFile(this.currentFile!, {
								role: 'model',
								message: botResponse.markdown,
								userMessage: userMessage,
								model: this.plugin.settings.chatModelName,
							});

							// No need to clear and reload - the streaming UI already shows the messages
						}

						// Display grounding content if available
						if (botResponse.rendered) {
							await this.displayMessage(botResponse.rendered, 'grounding');
						}

						// Ensure we're scrolled to bottom after streaming completes
						this.scrollToBottom();
					} catch (error) {
						this.currentStreamingResponse = null;
						throw error;
					}
				} else {
					// Fall back to non-streaming API
					const botResponse = await this.plugin.geminiApi.generateModelResponse(request);

					if (this.plugin.settings.chatHistory) {
						// Store messages first
						await this.plugin.history.appendHistoryForFile(this.currentFile!, {
							role: 'user',
							message: userMessage,
						});

						await this.plugin.history.appendHistoryForFile(this.currentFile!, {
							role: 'model',
							message: botResponse.markdown,
							userMessage: userMessage,
							model: this.plugin.settings.chatModelName,
						});

						// Clear and reload the entire chat from history
						this.clearChat();
						await this.updateChat((await this.plugin.history.getHistoryForFile(this.currentFile!)) ?? []);

						// Only display grounding content as it's not stored in history
						if (botResponse.rendered) {
							this.displayMessage(botResponse.rendered, 'grounding');
						}
					} else {
						// If history is disabled, just display the new model message directly
						this.displayMessage(botResponse.markdown, 'model');
						if (botResponse.rendered) {
							this.displayMessage(botResponse.rendered, 'grounding');
						}
					}
				}
			} catch (error) {
				new Notice('Error getting bot response.');
			}
		}
	}

	private scrollToBottom() {
		const tryScroll = () => {
			const inputArea = this.containerEl.querySelector('.gemini-scribe-input-area');
			if (inputArea) {
				inputArea.scrollIntoView({
					behavior: 'smooth',
					block: 'end',
					inline: 'nearest',
				});
			}
		};

		// Multiple scroll attempts with increasing delays
		tryScroll();
		setTimeout(tryScroll, 50);
		setTimeout(tryScroll, 150);
	}

	private debouncedScrollToBottom() {
		// Clear existing timeout
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
		}

		// Set a new timeout to scroll after a brief delay
		this.scrollTimeout = setTimeout(() => {
			this.scrollToBottom();
			this.scrollTimeout = null;
		}, 50); // 50ms debounce
	}

	private startTimer() {
		this.timerDisplay.style.display = 'block';
		this.startTime = Date.now();
		this.timerDisplay.textContent = '0.0s';

		this.timerInterval = setInterval(() => {
			if (this.startTime) {
				const elapsed = (Date.now() - this.startTime) / 1000;
				this.timerDisplay.textContent = `${elapsed.toFixed(1)}s`;
			}
		}, 100);
	}

	private stopTimer() {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
		setTimeout(() => {
			if (this.timerDisplay) {
				this.timerDisplay.style.display = 'none';
			}
		}, 2000); // Keep displayed for 2 seconds after completion
	}
}
