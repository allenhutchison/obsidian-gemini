import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ChatSession, SessionType } from '../types/agent';
import { GeminiConversationEntry } from '../types/conversation';
import type ObsidianGemini from '../main';
import { FilePickerModal } from './file-picker-modal';
import { ToolConverter } from '../tools/tool-converter';
import { ToolExecutionContext } from '../tools/types';
import { ExtendedModelRequest } from '../api/interfaces/model-api';

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
		this.toolPanel.style.border = '1px solid var(--background-modifier-border)';
		this.toolPanel.style.borderRadius = '6px';
		this.toolPanel.style.padding = '10px';
		this.toolPanel.style.marginBottom = '10px';
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
		
		// Tool execution header
		const header = this.toolPanel.createDiv({ cls: 'gemini-agent-tool-header' });
		header.createEl('h4', { text: 'Tool Execution' });
		
		// Execution status area
		this.toolPanel.createDiv({ cls: 'gemini-agent-tool-status' });
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
				await this.displayMessage(entry);
			}
		} catch (error) {
			console.error('Failed to load session history:', error);
		}
	}

	private async displayMessage(entry: GeminiConversationEntry) {
		const messageDiv = this.chatContainer.createDiv({ 
			cls: `gemini-agent-message gemini-agent-message-${entry.role}`
		});

		const header = messageDiv.createDiv({ cls: 'gemini-agent-message-header' });
		header.createEl('span', { 
			text: entry.role === 'user' ? 'You' : entry.role === 'system' ? 'System' : 'Agent',
			cls: 'gemini-agent-message-role'
		});
		header.createEl('span', { 
			text: entry.created_at.toLocaleTimeString(),
			cls: 'gemini-agent-message-time'
		});

		const content = messageDiv.createDiv({ cls: 'gemini-agent-message-content' });
		
		// Use markdown rendering like the regular chat view
		const sourcePath = this.currentSession?.historyPath || '';
		await MarkdownRenderer.render(this.app, entry.message, content, sourcePath, this);

		// Add a copy button for model messages
		if (entry.role === 'model') {
			const copyButton = content.createEl('button', {
				cls: 'gemini-agent-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Get the current text content for copying
				const currentText = content.innerText || entry.message;
				navigator.clipboard
					.writeText(currentText)
					.then(() => {
						new Notice('Message copied to clipboard.');
					})
					.catch((err) => {
						new Notice('Could not copy message to clipboard. Try selecting and copying manually.');
						console.error(err);
					});
			});
		}

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
		await this.displayMessage(userEntry);

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

			// Get available tools for this session
			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);
			console.log('Available tools from registry:', availableTools);
			console.log('Number of tools:', availableTools.length);
			console.log('Tool names:', availableTools.map(t => t.name));
			
			// Send to AI - disable automatic context since we're providing it
			const originalSendContext = this.plugin.settings.sendContext;
			this.plugin.settings.sendContext = false;
			
			try {
				const request: ExtendedModelRequest = {
					userMessage: message,
					conversationHistory: conversationHistory,
					model: this.plugin.settings.chatModelName,
					prompt: fullPrompt,
					renderContent: false, // We already rendered content above
					availableTools: availableTools // No need to cast to any
				};
				
				// For now, agent view will use non-streaming API since tool calls need the full response
				// TODO: Add streaming support with tool calls
				console.log('Agent view using non-streaming API for tool support');
				const response = await this.plugin.geminiApi.generateModelResponse(request);
				
				// Restore original setting
				this.plugin.settings.sendContext = originalSendContext;

				// Check if the model requested tool calls
				if (response.toolCalls && response.toolCalls.length > 0) {
					// Execute tools and handle results
					await this.handleToolCalls(response.toolCalls, message, conversationHistory, userEntry);
				} else {
					// Normal response without tool calls
					// Display AI response
					const aiEntry: GeminiConversationEntry = {
						role: 'model',
						message: response.markdown,
						notePath: '',
						created_at: new Date()
					};
					await this.displayMessage(aiEntry);

					// Save to history
					if (this.plugin.settings.chatHistory) {
						await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
						await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
						
						// Auto-label session after first exchange
						await this.autoLabelSessionIfNeeded();
					}
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

	getCurrentSessionForToolExecution(): ChatSession | null {
		return this.currentSession;
	}

	async onClose() {
		// Cleanup when view is closed
		if (this.currentStreamingResponse) {
			this.currentStreamingResponse.cancel();
		}
	}

	/**
	 * Auto-label session after first exchange if it still has default title
	 */
	private async autoLabelSessionIfNeeded() {
		if (!this.currentSession) return;
		
		// Check if this is still using a default title
		if (!this.currentSession.title.startsWith('Agent Session') && 
			!this.currentSession.title.startsWith('New Agent Session')) {
			return; // Already has a custom title
		}
		
		// Get the conversation history
		const history = await this.plugin.sessionHistory.getHistoryForSession(this.currentSession);
		
		// Only auto-label after first exchange (2 messages: user + assistant)
		if (history.length !== 2) return;
		
		try {
			// Generate a title based on the conversation
			const titlePrompt = `Based on this conversation, suggest a concise title (max 50 characters) that captures the main topic or purpose. Return only the title text, no quotes or explanation.

Context Files: ${this.currentSession.context.contextFiles.map(f => f.basename).join(', ')}

User: ${history[0].message}`;
			
			// Temporarily disable context to avoid confusion
			const originalSendContext = this.plugin.settings.sendContext;
			this.plugin.settings.sendContext = false;
			
			try {
				// Generate title using the model
				const response = await this.plugin.geminiApi.generateModelResponse({
					userMessage: titlePrompt,
					conversationHistory: [],
					model: this.plugin.settings.chatModelName,
					prompt: titlePrompt,
					renderContent: false
				});
				
				// Restore original setting
				this.plugin.settings.sendContext = originalSendContext;
				
				// Extract and sanitize the title
				const generatedTitle = response.markdown.trim()
					.replace(/^["']+|["']+$/g, '') // Remove quotes
					.substring(0, 50); // Ensure max length
				
				if (generatedTitle && generatedTitle.length > 0) {
					// Update session title
					this.currentSession.title = generatedTitle;
					
					// Update history file name
					const oldPath = this.currentSession.historyPath;
					const newFileName = (this.plugin.sessionManager as any).sanitizeFileName(generatedTitle);
					const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newFileName + '.md';
					
					// Rename the history file
					const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile) {
						await this.plugin.app.fileManager.renameFile(oldFile, newPath);
						this.currentSession.historyPath = newPath;
					}
					
					// Update session metadata
					await this.updateSessionMetadata();
					
					// Update UI
					this.updateSessionHeader();
					
					console.log(`Auto-labeled session: ${generatedTitle}`);
				}
			} catch (error) {
				// Restore setting on error
				this.plugin.settings.sendContext = originalSendContext;
				console.error('Failed to auto-label session:', error);
				// Don't show error to user - auto-labeling is a nice-to-have feature
			}
		} catch (error) {
			console.error('Error in auto-labeling:', error);
		}
	}

	/**
	 * Handle tool calls from the model response
	 */
	private async handleToolCalls(
		toolCalls: any[], 
		userMessage: string,
		conversationHistory: any[],
		userEntry: GeminiConversationEntry
	) {
		if (!this.currentSession) return;

		// Display that we're executing tools
		const toolMessage = `🔧 Executing ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}...`;
		const toolStatusEntry: GeminiConversationEntry = {
			role: 'system',
			message: toolMessage,
			notePath: '',
			created_at: new Date()
		};
		await this.displayMessage(toolStatusEntry);

		// Execute each tool
		const toolResults: any[] = [];
		const context: ToolExecutionContext = {
			plugin: this.plugin,
			session: this.currentSession
		};

		for (const toolCall of toolCalls) {
			try {
				// Show tool execution in UI
				this.showToolExecution(toolCall.name, toolCall.arguments);
				
				// Execute the tool
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, context);
				
				// Show result in UI
				this.showToolResult(toolCall.name, result);
				
				// Format result for the model
				toolResults.push({
					toolName: toolCall.name,
					result: result
				});
			} catch (error) {
				console.error(`Tool execution error for ${toolCall.name}:`, error);
				toolResults.push({
					toolName: toolCall.name,
					result: {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error'
					}
				});
			}
		}

		// Save the original user message and tool calls to history
		if (this.plugin.settings.chatHistory) {
			await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
			
			// Save tool execution as a system message
			const toolExecutionEntry: GeminiConversationEntry = {
				role: 'system',
				message: `Executed tools: ${toolCalls.map(t => t.name).join(', ')}`,
				notePath: '',
				created_at: new Date(),
				metadata: {
					toolCalls: toolCalls,
					toolResults: toolResults
				}
			};
			await this.plugin.sessionHistory.addEntryToSession(this.currentSession, toolExecutionEntry);
		}

		// Continue the conversation with tool results
		// Build a new request that includes the tool results
		const toolResultsMessage = this.formatToolResultsForModel(toolResults);
		
		// Add tool results to conversation history
		const updatedHistory = [...conversationHistory, {
			role: 'user',
			message: userMessage
		}, {
			role: 'system', 
			message: toolResultsMessage
		}];

		// Send another request with the tool results
		try {
			// Get available tools again for the follow-up request
			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);
			
			const followUpRequest: ExtendedModelRequest = {
				userMessage: "Based on the tool execution results above, please provide a response to the user's request.",
				conversationHistory: updatedHistory,
				model: this.plugin.settings.chatModelName,
				prompt: this.plugin.prompts.generalPrompt({ userMessage: "Continue with tool results" }),
				renderContent: false,
				availableTools: availableTools  // Include tools so model can chain calls
			};
			
			const followUpResponse = await this.plugin.geminiApi.generateModelResponse(followUpRequest);
			
			// Check if the follow-up response also contains tool calls
			if (followUpResponse.toolCalls && followUpResponse.toolCalls.length > 0) {
				// Recursively handle additional tool calls
				await this.handleToolCalls(
					followUpResponse.toolCalls, 
					"Based on the tool execution results above, please provide a response to the user's request.", 
					updatedHistory, 
					{
						role: 'system',
						message: 'Continuing with additional tool calls...',
						notePath: '',
						created_at: new Date()
					}
				);
			} else {
				// Display the final response
				const aiEntry: GeminiConversationEntry = {
					role: 'model',
					message: followUpResponse.markdown,
					notePath: '',
					created_at: new Date()
				};
				await this.displayMessage(aiEntry);

				// Save final response to history
				if (this.plugin.settings.chatHistory) {
					await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
					
					// Auto-label session after first exchange
					await this.autoLabelSessionIfNeeded();
				}
			}
		} catch (error) {
			console.error('Failed to process tool results:', error);
			new Notice('Failed to process tool results');
		}
	}

	/**
	 * Format tool results for the model
	 */
	private formatToolResultsForModel(toolResults: any[]): string {
		let formatted = "Tool Execution Results:\n\n";
		
		for (const result of toolResults) {
			formatted += `### ${result.toolName}\n`;
			if (result.result.success) {
				formatted += `✅ Success\n`;
				if (result.result.data) {
					formatted += `\`\`\`json\n${JSON.stringify(result.result.data, null, 2)}\n\`\`\`\n`;
				}
			} else {
				formatted += `❌ Failed\n`;
				formatted += `Error: ${result.result.error}\n`;
			}
			formatted += '\n';
		}
		
		return formatted;
	}

	/**
	 * Show tool execution in the UI
	 */
	public showToolExecution(toolName: string, parameters: any): void {
		// Update the tool panel to show current execution
		if (this.toolPanel) {
			const executionDiv = this.toolPanel.createDiv({ cls: 'gemini-tool-execution-status' });
			executionDiv.createSpan({ text: `🔧 ${toolName}`, cls: 'gemini-tool-name' });
			
			// Show parameters if not too large
			const paramStr = JSON.stringify(parameters, null, 2);
			if (paramStr.length < 200) {
				const paramDiv = executionDiv.createDiv({ cls: 'gemini-tool-params' });
				paramDiv.createEl('pre', { text: paramStr });
			}
		}
	}

	/**
	 * Show tool execution result in the UI
	 */
	public showToolResult(toolName: string, result: any): void {
		// Find the execution status for this tool and update it
		if (this.toolPanel) {
			const executions = this.toolPanel.querySelectorAll('.gemini-tool-execution-status');
			const latestExecution = executions[executions.length - 1] as HTMLElement;
			
			if (latestExecution) {
				const resultDiv = latestExecution.createDiv({ cls: 'gemini-tool-result' });
				const icon = result.success ? '✅' : '❌';
				resultDiv.createSpan({ text: `${icon} ${result.success ? 'Success' : 'Failed'}` });
				
				if (result.error) {
					resultDiv.createDiv({ text: result.error, cls: 'gemini-tool-error' });
				}
			}
		}
	}
}