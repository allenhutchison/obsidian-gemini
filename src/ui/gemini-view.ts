import ObsidianGemini from '../../main';
import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile, setIcon } from 'obsidian';
import { ModelRewriteMode } from '../rewrite';
import { ExtendedModelRequest } from '../api';
import { GeminiPrompts } from '../prompts';
import { GEMINI_MODELS } from '../models';

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
	private plugin: ObsidianGemini;
	private rewriteMode: ModelRewriteMode;
	private prompts: GeminiPrompts;
	private chatbox: HTMLDivElement;
	private currentFile: TFile | null;
	private observer: MutationObserver;
	private shoudRewriteFile: boolean;
	private timerDisplay: HTMLDivElement;
	private timerInterval: NodeJS.Timeout | null = null;
	private startTime: number | null = null;
	private modelPicker: HTMLSelectElement | null = null;
	private settingsUnsubscribe: (() => void) | null = null;
	private fileOpenHandler: (file: TFile | null) => Promise<void>;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianGemini) {
		super(leaf);
		this.plugin = plugin;
		this.rewriteMode = new ModelRewriteMode(plugin);
		this.prompts = new GeminiPrompts();
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
			await this.updateModelPickerUI();
		};
		
		// Store the unsubscribe function
		this.settingsUnsubscribe = () => {
			this.plugin.saveSettings = originalSaveSettings;
		};
	}

	private async updateModelPickerUI() {
		// Find the existing model picker area
		const existingPickerArea = this.containerEl.querySelector('.gemini-scribe-model-picker-area');
		
		// If the setting is enabled and there's no picker, create it
		if (this.plugin.settings.showModelPicker && !existingPickerArea) {
			const container = this.containerEl.children[1];
			const modelPickerArea = container.createDiv({ cls: 'gemini-scribe-model-picker-area' });
			this.modelPicker = modelPickerArea.createEl('select', { cls: 'gemini-scribe-model-picker' });
			
			// Add model options from shared list
			GEMINI_MODELS.forEach(model => {
				this.modelPicker?.createEl('option', { 
					value: model.value, 
					text: model.label 
				});
			});

			// Set the current model
			if (this.modelPicker) {
				this.modelPicker.value = this.plugin.settings.chatModelName;
			}

			// Add change listener
			this.modelPicker?.addEventListener('change', async () => {
				if (this.modelPicker) {
					this.plugin.settings.chatModelName = this.modelPicker.value;
					await this.plugin.saveSettings();
				}
			});
		}
		// If the setting is disabled and there is a picker, remove it
		else if (!this.plugin.settings.showModelPicker && existingPickerArea) {
			existingPickerArea.remove();
			this.modelPicker = null;
		}
		// If the setting is enabled and there is a picker, update its value
		else if (this.plugin.settings.showModelPicker && this.modelPicker) {
			this.modelPicker.value = this.plugin.settings.chatModelName;
		}
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
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl('h2', { text: 'Gemini Chat' });

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

		// Update model picker UI based on settings
		await this.updateModelPickerUI();

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
					this.stopTimer();
				} catch (error) {
					this.stopTimer();
					console.error(error);
				}
			}
		});

		// Observe changes in the chatbox
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

		// Register the file-open handler
		this.registerEvent(
			this.app.workspace.on('file-open', async (file) => {
				console.log('File open event:', file?.path);  // Debug log
				await this.handleFileOpen(file);
			})
		);

		// Handle the currently active file
		const activeFile = this.plugin.gfile.getActiveFile();
		if (activeFile) {
			console.log('Loading active file:', activeFile.path);  // Debug log
			await this.handleFileOpen(activeFile);
		}
	}

	async onClose() {
		this.app.workspace.off('file-open', this.fileOpenHandler);
		this.observer.disconnect();
		if (this.settingsUnsubscribe) {
			this.settingsUnsubscribe();
		}
	}

	async displayMessage(message: string, sender: 'user' | 'model' | 'grounding') {
		const newMessageContainer = this.chatbox.createDiv({
			cls: `gemini-scribe-message-container ${sender}`,
		});
		const senderIndicator = newMessageContainer.createDiv({
			cls: 'gemini-scribe-sender-indicator',
		});
		const newMessage = newMessageContainer.createDiv({
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

		// Google TOS requires that we display the search results in the plugin as the supplied HTML.
		// This is why we don't render the search results as markdown.
		if (sender === 'grounding') {
			newMessage.innerHTML = message;
		} else {
			const sourcePath = this.plugin.gfile.getActiveFile()?.path ?? '';
			await MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);
		}

		// Add a copy button to the message if it was sent by the model.
		if (sender === 'model') {
			const copyButton = newMessage.createEl('button', {
				cls: 'gemini-scribe-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				navigator.clipboard
					.writeText(message)
					.then(() => {
						new Notice('Message copied to clipboard.');
					})
					.catch((err) => {
						new Notice('Could not copy message to clipboard. Try selecting and copying manually.');
						console.error('Failed to copy: ', err);
					});
			});
		}

		// Scroll to the bottom of the chatbox
		this.scrollToBottom();
	}

	// This will be called when a file is opened or made active in the view.
	// file can be null if it's the new file tab.
	async handleFileOpen(file: TFile | null) {
		if (!file) {
			this.currentFile = null;
			this.clearChat();
			return;
		}

		// Only reload if it's a different file
		if (!this.currentFile || this.currentFile.path !== file.path) {
			this.currentFile = file;
			this.clearChat();
			
			// Load and display history
			const history = await this.plugin.history.getHistoryForFile(file);
			if (history && history.length > 0) {
				console.log('Loading history:', history.length, 'messages');  // Debug log
				for (const entry of history) {
					await this.displayMessage(entry.message, entry.role);
				}
			}
		}
	}

	clearChat() {
		this.chatbox.empty();
	}

	async reloadChatFromHistory() {
		if (!this.currentFile) return;
		const history = await this.plugin.history.getHistoryForFile(this.currentFile);
		if (history && history.length > 0) {
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
				const prompt = this.prompts.generalPrompt({ userMessage: userMessage});
				const request: ExtendedModelRequest = {
					userMessage: userMessage,
					conversationHistory: history,
					model: this.plugin.settings.chatModelName,
					prompt: prompt,
					renderContent: true,
				};
				const botResponse = await this.plugin.geminiApi.generateModelResponse(request);

				// Store messages first
				await this.plugin.history.appendHistoryForFile(this.currentFile!, {
					role: 'user',
					message: userMessage,
				});

				await this.plugin.history.appendHistoryForFile(this.currentFile!, {
					role: 'model',
					message: botResponse.markdown,
					userMessage: userMessage,
					model: this.plugin.settings.chatModelName
				});

				// Clear and reload the entire chat
				this.clearChat();
				await this.reloadChatFromHistory();

				// Only display grounding content as it's not stored in history
				if (botResponse.rendered) {
					this.displayMessage(botResponse.rendered, 'grounding');
				}
			} catch (error) {
				new Notice('Error getting bot response.');
				console.error(error);
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
