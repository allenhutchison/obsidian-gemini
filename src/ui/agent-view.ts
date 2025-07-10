import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { ChatSession, SessionType } from '../types/agent';
import { GeminiConversationEntry } from '../types/conversation';
import type ObsidianGemini from '../main';
import { FilePickerModal } from './file-picker-modal';

export const VIEW_TYPE_AGENT = 'gemini-agent-view';

export class AgentView extends ItemView {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private currentSession: ChatSession | null = null;
	private chatContainer: HTMLElement;
	private userInput: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private contextPanel: HTMLElement;
	private toolPanel: HTMLElement;
	private sessionHeader: HTMLElement;
	private currentStreamingResponse: { cancel: () => void } | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: InstanceType<typeof ObsidianGemini>) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AGENT;
	}

	getDisplayText(): string {
		return 'Agent Mode';
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('gemini-agent-container');

		this.createAgentInterface(container as HTMLElement);
		
		// Create default agent session
		await this.createNewSession();
	}

	private createAgentInterface(container: HTMLElement) {
		// Session header with session info and controls
		this.sessionHeader = container.createDiv({ cls: 'gemini-agent-header' });
		this.createSessionHeader();

		// Context management panel
		this.contextPanel = container.createDiv({ cls: 'gemini-agent-context-panel' });
		this.createContextPanel();

		// Tool execution panel
		this.toolPanel = container.createDiv({ cls: 'gemini-agent-tool-panel' });
		this.toolPanel.style.display = 'none'; // Hidden by default
		this.createToolPanel();

		// Chat container
		this.chatContainer = container.createDiv({ cls: 'gemini-agent-chat' });

		// Input area
		const inputArea = container.createDiv({ cls: 'gemini-agent-input-area' });
		this.createInputArea(inputArea);
	}

	private createSessionHeader() {
		this.sessionHeader.empty();

		// Session title and info
		const titleSection = this.sessionHeader.createDiv({ cls: 'gemini-agent-title-section' });
		
		const title = titleSection.createEl('h2', { 
			text: this.currentSession?.title || 'New Agent Session',
			cls: 'gemini-agent-title'
		});

		const sessionInfo = titleSection.createDiv({ cls: 'gemini-agent-session-info' });
		if (this.currentSession) {
			sessionInfo.createSpan({ 
				text: `Context: ${this.currentSession.context.contextFiles.length} files`,
				cls: 'gemini-agent-context-count'
			});
			sessionInfo.createSpan({ 
				text: `Depth: ${this.currentSession.context.contextDepth}`,
				cls: 'gemini-agent-depth'
			});
		}

		// Session controls
		const controls = this.sessionHeader.createDiv({ cls: 'gemini-agent-controls' });
		
		const newSessionBtn = controls.createEl('button', { 
			text: 'New Session',
			cls: 'gemini-agent-btn gemini-agent-btn-secondary'
		});
		newSessionBtn.addEventListener('click', () => this.createNewSession());

		const sessionsBtn = controls.createEl('button', { 
			text: 'Sessions',
			cls: 'gemini-agent-btn gemini-agent-btn-secondary'
		});
		sessionsBtn.addEventListener('click', () => this.showSessionsList());
	}

	private createContextPanel() {
		this.contextPanel.empty();

		const header = this.contextPanel.createDiv({ cls: 'gemini-agent-panel-header' });
		header.createEl('h3', { text: 'Context Files' });

		const addButton = header.createEl('button', {
			text: 'Add Files',
			cls: 'gemini-agent-btn gemini-agent-btn-primary'
		});
		addButton.addEventListener('click', () => this.showFilePicker());

		// Context files list
		const filesList = this.contextPanel.createDiv({ cls: 'gemini-agent-files-list' });
		this.updateContextFilesList(filesList);

		// Context depth control
		const depthControl = this.contextPanel.createDiv({ cls: 'gemini-agent-depth-control' });
		depthControl.createEl('label', { text: 'Context Depth:' });
		
		const depthSlider = depthControl.createEl('input', {
			type: 'range',
			attr: { min: '0', max: '5', step: '1' }
		}) as HTMLInputElement;
		
		const depthValue = depthControl.createEl('span', { 
			text: this.currentSession?.context.contextDepth.toString() || '2'
		});
		
		depthSlider.value = this.currentSession?.context.contextDepth.toString() || '2';
		depthSlider.addEventListener('input', () => {
			const depth = parseInt(depthSlider.value);
			depthValue.textContent = depth.toString();
			if (this.currentSession) {
				this.currentSession.context.contextDepth = depth;
				this.updateSessionMetadata();
			}
		});
	}

	private createToolPanel() {
		this.toolPanel.empty();
		this.toolPanel.createEl('h4', { text: 'Tool Execution' });
		// Tool execution status will be shown here dynamically
	}

	private createInputArea(container: HTMLElement) {
		this.userInput = container.createEl('textarea', {
			placeholder: 'Message the agent... (Shift+Enter for new line)',
			cls: 'gemini-agent-input'
		});

		this.sendButton = container.createEl('button', {
			text: 'Send',
			cls: 'gemini-agent-btn gemini-agent-btn-primary gemini-agent-send-btn'
		});

		// Event listeners
		this.userInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		this.sendButton.addEventListener('click', () => this.sendMessage());
	}

	private updateContextFilesList(container: HTMLElement) {
		container.empty();

		if (!this.currentSession || this.currentSession.context.contextFiles.length === 0) {
			container.createEl('p', { 
				text: 'No context files selected',
				cls: 'gemini-agent-empty-state'
			});
			return;
		}

		this.currentSession.context.contextFiles.forEach(file => {
			const fileItem = container.createDiv({ cls: 'gemini-agent-file-item' });
			
			const fileName = fileItem.createEl('span', { 
				text: file.basename,
				cls: 'gemini-agent-file-name'
			});

			const removeBtn = fileItem.createEl('button', {
				text: '×',
				cls: 'gemini-agent-remove-btn'
			});

			removeBtn.addEventListener('click', () => {
				this.removeContextFile(file);
			});
		});
	}

	private async showFilePicker() {
		if (!this.currentSession) return;

		const modal = new FilePickerModal(
			this.app,
			(selectedFiles) => {
				selectedFiles.forEach(file => {
					if (!this.currentSession!.context.contextFiles.includes(file)) {
						this.currentSession!.context.contextFiles.push(file);
					}
				});
				this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
				this.updateSessionHeader();
				this.updateSessionMetadata();
			}
		);

		modal.open();
	}

	private removeContextFile(file: TFile) {
		if (!this.currentSession) return;

		const index = this.currentSession.context.contextFiles.indexOf(file);
		if (index > -1) {
			this.currentSession.context.contextFiles.splice(index, 1);
			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			this.updateSessionHeader();
			this.updateSessionMetadata();
		}
	}

	private async createNewSession() {
		try {
			this.currentSession = await this.plugin.sessionManager.createAgentSession();
			
			// Load existing history
			await this.loadSessionHistory();
			
			// Update UI
			this.createSessionHeader();
			this.updateContextFilesList(this.contextPanel.querySelector('.gemini-agent-files-list') as HTMLElement);
			
			new Notice('New agent session created');
		} catch (error) {
			console.error('Failed to create agent session:', error);
			new Notice('Failed to create agent session');
		}
	}

	private async loadSessionHistory() {
		if (!this.currentSession) return;

		try {
			const history = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			this.chatContainer.empty();

			for (const entry of history) {
				this.displayMessage(entry);
			}
		} catch (error) {
			console.error('Failed to load session history:', error);
		}
	}

	private displayMessage(entry: GeminiConversationEntry) {
		const messageDiv = this.chatContainer.createDiv({ 
			cls: `gemini-agent-message gemini-agent-message-${entry.role}`
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', { 
			text: entry.role === 'user' ? 'You' : 'Agent',
			cls: 'gemini-agent-message-role'
		});
		header.createEl('span', { 
			text: entry.created_at.toLocaleTimeString(),
			cls: 'gemini-agent-message-time'
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });
		content.textContent = entry.message;

		// Auto-scroll to bottom
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	private async sendMessage() {
		if (!this.currentSession) {
			new Notice('No active session');
			return;
		}

		const message = this.userInput.value.trim();
		if (!message) return;

		// Clear input
		this.userInput.value = '';
		this.sendButton.disabled = true;

		// Display user message
		const userEntry: GeminiConversationEntry = {
			role: 'user',
			message,
			notePath: '',
			created_at: new Date()
		};
		this.displayMessage(userEntry);

		try {
			// Get conversation history
			const conversationHistory = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
			
			// Build context for AI request 
			const contextInfo = await this.plugin.gfile.buildFileContext(
				this.currentSession.context.contextFiles,
				this.currentSession.context.contextDepth,
				true // renderContent
			);
			
			// Create prompt that includes the context
			let fullPrompt = this.plugin.prompts.generalPrompt({ 
				userMessage: message
			});
			
			// Add context information if available
			if (contextInfo) {
				fullPrompt = `${fullPrompt}\n\n${contextInfo}\n\nUser: ${message}`;
			} else {
				fullPrompt = `${fullPrompt}\n\nUser: ${message}`;
			}

			// Send to AI - disable automatic context since we're providing it
			const originalSendContext = this.plugin.settings.sendContext;
			this.plugin.settings.sendContext = false;
			
			try {
				const response = await this.plugin.geminiApi.generateModelResponse({
					userMessage: message,
					conversationHistory: conversationHistory,
					model: this.plugin.settings.chatModelName,
					prompt: fullPrompt,
					renderContent: false // We already rendered content above
				});
				
				// Restore original setting
				this.plugin.settings.sendContext = originalSendContext;

				// Display AI response
				const aiEntry: GeminiConversationEntry = {
					role: 'model',
					message: response.markdown,
					notePath: '',
					created_at: new Date()
				};
				this.displayMessage(aiEntry);

				// Save to history
				if (this.plugin.settings.chatHistory) {
					await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
					await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
				}
			} catch (error) {
				// Make sure to restore setting even if there's an error
				this.plugin.settings.sendContext = originalSendContext;
				throw error;
			}

		} catch (error) {
			console.error('Failed to send message:', error);
			new Notice('Failed to send message');
		} finally {
			this.sendButton.disabled = false;
		}
	}

	private async updateSessionMetadata() {
		if (!this.currentSession) return;

		try {
			await this.plugin.sessionHistory.updateSessionMetadata(this.currentSession);
		} catch (error) {
			console.error('Failed to update session metadata:', error);
		}
	}

	private updateSessionHeader() {
		this.createSessionHeader();
	}

	private async showSessionsList() {
		// TODO: Implement session selection modal
		new Notice('Session selection coming soon');
	}

	// Tool execution feedback methods
	showToolExecution(toolName: string, parameters: any): void {
		this.toolPanel.style.display = 'block';
		this.toolPanel.empty();
		
		this.toolPanel.createEl('h4', { text: 'Tool Execution' });
		const executionItem = this.toolPanel.createDiv({ cls: 'gemini-agent-tool-execution' });
		executionItem.createSpan({ text: `🔧 Executing: ${toolName}` });
		
		if (Object.keys(parameters).length > 0) {
			const paramDiv = executionItem.createDiv({ cls: 'gemini-agent-tool-params' });
			paramDiv.createEl('pre', { text: JSON.stringify(parameters, null, 2) });
		}
	}

	showToolResult(toolName: string, result: any): void {
		const executionItem = this.toolPanel.querySelector('.gemini-agent-tool-execution') as HTMLElement;
		if (!executionItem) return;
		
		const resultDiv = executionItem.createDiv({ cls: 'gemini-agent-tool-result' });
		const icon = result.success ? '✅' : '❌';
		const status = result.success ? 'Success' : 'Failed';
		
		resultDiv.createSpan({ text: `${icon} ${status}` });
		
		if (result.error) {
			resultDiv.createDiv({ text: result.error, cls: 'gemini-agent-tool-error' });
		}
		
		// Hide panel after 3 seconds
		setTimeout(() => {
			this.toolPanel.style.display = 'none';
		}, 3000);
	}

	getCurrentSessionForToolExecution(): ChatSession | null {
		return this.currentSession;
	}

	async onClose() {
		// Cleanup when view is closed
		if (this.currentStreamingResponse) {
			this.currentStreamingResponse.cancel();
		}
	}
}