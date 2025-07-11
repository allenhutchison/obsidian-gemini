import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
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
		
		// Add a toggle to show/hide tool testing interface
		const header = this.toolPanel.createDiv({ cls: 'gemini-agent-tool-header' });
		header.createEl('h4', { text: 'Tool Execution' });
		
		const testToggle = header.createEl('button', {
			text: '🧪 Test Tools',
			cls: 'gemini-agent-btn gemini-agent-btn-secondary'
		});
		
		const testPanel = this.toolPanel.createDiv({ cls: 'gemini-agent-tool-test-panel' });
		testPanel.style.display = 'none';
		
		testToggle.addEventListener('click', () => {
			if (testPanel.style.display === 'none') {
				testPanel.style.display = 'block';
				this.toolPanel.style.display = 'block';
				this.createToolTestInterface(testPanel);
			} else {
				testPanel.style.display = 'none';
			}
		});
		
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

			// Get available tools for this session
			const toolContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: this.currentSession
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);
			console.log('Available tools from registry:', availableTools);
			
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
					this.displayMessage(aiEntry);

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

	/**
	 * Create tool testing interface
	 */
	private createToolTestInterface(container: HTMLElement) {
		container.empty();
		
		// Get available tools
		const tools = this.plugin.toolRegistry.getAllTools();
		
		// Tool selector
		const selectorDiv = container.createDiv({ cls: 'gemini-agent-tool-selector' });
		selectorDiv.createEl('label', { text: 'Select Tool:' });
		
		const toolSelect = selectorDiv.createEl('select', { cls: 'gemini-agent-tool-select' });
		toolSelect.createEl('option', { value: '', text: '-- Select a tool --' });
		
		tools.forEach(tool => {
			toolSelect.createEl('option', { 
				value: tool.name, 
				text: `${tool.name} (${tool.category})`
			});
		});
		
		// Parameters input area
		const paramsDiv = container.createDiv({ cls: 'gemini-agent-tool-params-input' });
		const paramsLabel = paramsDiv.createEl('label', { text: 'Parameters (JSON):' });
		const paramsTextarea = paramsDiv.createEl('textarea', {
			cls: 'gemini-agent-tool-params-textarea',
			attr: { placeholder: '{\n  "param": "value"\n}' }
		});
		paramsTextarea.style.height = '100px';
		paramsTextarea.style.fontFamily = 'monospace';
		
		// Tool description
		const descDiv = container.createDiv({ cls: 'gemini-agent-tool-description' });
		
		// Update description and default params when tool is selected
		toolSelect.addEventListener('change', () => {
			const selectedTool = tools.find(t => t.name === toolSelect.value);
			if (selectedTool) {
				descDiv.empty();
				descDiv.createEl('strong', { text: 'Description: ' });
				descDiv.createSpan({ text: selectedTool.description });
				
				// Set default parameters based on tool
				const defaultParams = this.getDefaultParamsForTool(selectedTool.name);
				paramsTextarea.value = JSON.stringify(defaultParams, null, 2);
			} else {
				descDiv.empty();
				paramsTextarea.value = '';
			}
		});
		
		// Execute button
		const executeBtn = container.createEl('button', {
			text: 'Execute Tool',
			cls: 'gemini-agent-btn gemini-agent-btn-primary'
		});
		
		// Results area
		const resultsDiv = container.createDiv({ cls: 'gemini-agent-tool-results' });
		
		executeBtn.addEventListener('click', async () => {
			const toolName = toolSelect.value;
			if (!toolName) {
				new Notice('Please select a tool');
				return;
			}
			
			try {
				// Parse parameters
				const params = paramsTextarea.value.trim() ? 
					JSON.parse(paramsTextarea.value) : {};
				
				// Clear previous results
				resultsDiv.empty();
				resultsDiv.createEl('h5', { text: 'Executing...' });
				
				// Execute through the execution engine
				const context = {
					session: this.currentSession!,
					plugin: this.plugin
				};
				
				const toolCall = {
					name: toolName,
					arguments: params
				};
				
				// This will also trigger the UI feedback
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, context);
				
				// Display results
				resultsDiv.empty();
				resultsDiv.createEl('h5', { text: 'Result:' });
				
				const resultPre = resultsDiv.createEl('pre', {
					cls: 'gemini-agent-tool-result-pre'
				});
				resultPre.style.whiteSpace = 'pre-wrap';
				resultPre.style.wordWrap = 'break-word';
				resultPre.textContent = JSON.stringify(result, null, 2);
				
				// Color based on success
				if (result.success) {
					resultPre.style.color = 'var(--text-success)';
				} else {
					resultPre.style.color = 'var(--text-error)';
				}
				
			} catch (error) {
				resultsDiv.empty();
				resultsDiv.createEl('h5', { text: 'Error:' });
				const errorDiv = resultsDiv.createDiv({ cls: 'gemini-agent-tool-error' });
				errorDiv.style.color = 'var(--text-error)';
				errorDiv.textContent = error.message;
			}
		});
	}

	/**
	 * Get default parameters for a tool to make testing easier
	 */
	private getDefaultParamsForTool(toolName: string): any {
		const contextFiles = this.currentSession?.context.contextFiles || [];
		const firstFile = contextFiles[0];
		
		switch (toolName) {
			case 'read_file':
				return {
					path: firstFile?.path || 'example.md'
				};
			case 'write_file':
				return {
					path: 'test-file.md',
					content: '# Test File\n\nThis is a test file created by the tool system.'
				};
			case 'append_to_file':
				return {
					path: firstFile?.path || 'example.md',
					content: '\n\n## Appended Section\n\nThis content was appended.'
				};
			case 'search_vault':
				return {
					query: 'test',
					limit: 5
				};
			case 'list_files':
				return {
					path: '/'
				};
			case 'get_file_info':
				return {
					path: firstFile?.path || 'example.md'
				};
			default:
				return {};
		}
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
		this.displayMessage(toolStatusEntry);

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
			const followUpRequest: ExtendedModelRequest = {
				userMessage: "Based on the tool execution results above, please provide a response to the user's request.",
				conversationHistory: updatedHistory,
				model: this.plugin.settings.chatModelName,
				prompt: this.plugin.prompts.generalPrompt({ userMessage: "Continue with tool results" }),
				renderContent: false
			};
			
			const followUpResponse = await this.plugin.geminiApi.generateModelResponse(followUpRequest);
			
			// Display the final response
			const aiEntry: GeminiConversationEntry = {
				role: 'model',
				message: followUpResponse.markdown,
				notePath: '',
				created_at: new Date()
			};
			this.displayMessage(aiEntry);

			// Save final response to history
			if (this.plugin.settings.chatHistory) {
				await this.plugin.sessionHistory.addEntryToSession(this.currentSession, aiEntry);
				
				// Auto-label session after first exchange
				await this.autoLabelSessionIfNeeded();
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