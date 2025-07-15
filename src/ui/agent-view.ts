import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, setIcon } from 'obsidian';
import { ChatSession, SessionType } from '../types/agent';
import { GeminiConversationEntry } from '../types/conversation';
import type ObsidianGemini from '../main';
import { FilePickerModal } from './file-picker-modal';
import { SessionListModal } from './session-list-modal';
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
		// Add the main container class
		container.addClass('gemini-agent-container');
		
		// Session header with session info and controls
		this.sessionHeader = container.createDiv({ cls: 'gemini-agent-header' });
		this.createSessionHeader();

		// Context management panel
		this.contextPanel = container.createDiv({ cls: 'gemini-agent-context-panel' });
		this.createContextPanel();

		// Chat container
		this.chatContainer = container.createDiv({ cls: 'gemini-agent-chat' });
		this.showEmptyState();

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
		
		// Make title editable on double-click
		title.addEventListener('dblclick', () => {
			if (!this.currentSession) return;
			
			const input = titleSection.createEl('input', {
				type: 'text',
				value: this.currentSession.title,
				cls: 'gemini-agent-title-input'
			});
			
			title.style.display = 'none';
			input.focus();
			input.select();
			
			const saveTitle = async () => {
				const newTitle = input.value.trim();
				if (newTitle && newTitle !== this.currentSession!.title) {
					// Update session title
					const oldPath = this.currentSession!.historyPath;
					const sanitizedTitle = (this.plugin.sessionManager as any).sanitizeFileName(newTitle);
					const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + sanitizedTitle + '.md';
					
					// Rename file if it exists
					const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
					if (oldFile) {
						await this.plugin.app.fileManager.renameFile(oldFile, newPath);
						this.currentSession!.historyPath = newPath;
					}
					
					this.currentSession!.title = newTitle;
					await this.updateSessionMetadata();
				}
				
				title.textContent = this.currentSession!.title;
				title.style.display = '';
				input.remove();
			};
			
			input.addEventListener('blur', saveTitle);
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					saveTitle();
				} else if (e.key === 'Escape') {
					title.style.display = '';
					input.remove();
				}
			});
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
			cls: 'gemini-agent-btn gemini-agent-btn-primary'
		});
		setIcon(addButton, 'plus');
		addButton.createSpan({ text: ' Add Files' });
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
			
			// Add file icon
			const fileIcon = fileItem.createEl('span', { cls: 'gemini-agent-file-icon' });
			setIcon(fileIcon, 'file-text');
			
			const fileName = fileItem.createEl('span', { 
				text: file.basename,
				cls: 'gemini-agent-file-name',
				title: file.path // Show full path on hover
			});

			const removeBtn = fileItem.createEl('button', {
				text: '×',
				cls: 'gemini-agent-remove-btn',
				title: 'Remove file'
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
			// Clear current session
			this.currentSession = null;
			this.chatContainer.empty();
			
			// Create new session
			this.currentSession = await this.plugin.sessionManager.createAgentSession();
			
			// Update UI (no history to load for new session)
			this.createSessionHeader();
			this.createContextPanel();
			
			// Focus on input
			this.userInput.focus();
			
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
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}
		
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
		
		// Preserve line breaks in the message
		// Convert single newlines to double newlines for proper markdown rendering
		// But preserve existing double newlines and table formatting
		let formattedMessage = entry.message;
		if (entry.role === 'model' || entry.role === 'assistant') {
			// Split by lines to handle tables specially
			const lines = entry.message.split('\n');
			const formattedLines: string[] = [];
			let inTable = false;
			let previousLineWasEmpty = true;
			
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const nextLine = lines[i + 1];
				const trimmedLine = line.trim();
				
				// Improved table detection
				// A table row must have at least one pipe that's not escaped
				const hasUnescapedPipe = line.split('\\|').join('').includes('|');
				const isTableDivider = /^\s*\|?\s*[:?\-]+\s*\|/.test(line);
				const isTableRow = hasUnescapedPipe && !isTableDivider && trimmedLine !== '|';
				
				// Check if we're starting a table
				if ((isTableRow || isTableDivider) && !inTable) {
					inTable = true;
					// Add empty line before table if needed
					if (!previousLineWasEmpty && formattedLines.length > 0) {
						formattedLines.push('');
					}
				}
				
				// Add the current line
				formattedLines.push(line);
				
				// Check if we're ending a table
				if (inTable && !hasUnescapedPipe && trimmedLine !== '') {
					inTable = false;
					// Add empty line after table
					formattedLines.push('');
				} else if (inTable && trimmedLine === '') {
					// Empty line also ends a table
					inTable = false;
				}
				
				// For non-table content, add empty line between paragraphs
				if (!inTable && !hasUnescapedPipe && trimmedLine !== '' && 
					nextLine && nextLine.trim() !== '' && !nextLine.includes('|')) {
					formattedLines.push('');
				}
				
				previousLineWasEmpty = trimmedLine === '';
			}
			
			formattedMessage = formattedLines.join('\n');
			
			// Debug logging for table formatting
			if (this.plugin.settings.debugMode && formattedMessage.includes('|')) {
				console.log('Table formatting debug:');
				console.log('Original message:', entry.message);
				console.log('Formatted message:', formattedMessage);
			}
		}
		
		// Use markdown rendering like the regular chat view
		const sourcePath = this.currentSession?.historyPath || '';
		await MarkdownRenderer.render(this.app, formattedMessage, content, sourcePath, this);

		// Add a copy button for model messages
		if (entry.role === 'model') {
			const copyButton = content.createEl('button', {
				cls: 'gemini-agent-copy-button',
			});
			setIcon(copyButton, 'copy');

			copyButton.addEventListener('click', () => {
				// Use the original message text to preserve formatting
				navigator.clipboard
					.writeText(entry.message)
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
		
		// Show thinking indicator
		const thinkingMessage = this.chatContainer.createDiv({ 
			cls: 'gemini-agent-message gemini-agent-message-model gemini-agent-thinking'
		});
		const thinkingContent = thinkingMessage.createDiv({ cls: 'gemini-agent-message-content' });
		thinkingContent.createSpan({ text: 'Thinking', cls: 'gemini-agent-thinking-text' });
		for (let i = 0; i < 3; i++) {
			thinkingContent.createSpan({ text: '.', cls: `gemini-agent-thinking-dot gemini-agent-thinking-dot-${i + 1}` });
		}
		
		// Scroll to thinking message
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

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
				
				// Remove thinking indicator
				thinkingMessage.remove();

				// Check if the model requested tool calls
				if (response.toolCalls && response.toolCalls.length > 0) {
					// Execute tools and handle results
					await this.handleToolCalls(response.toolCalls, message, conversationHistory, userEntry);
				} else {
					// Normal response without tool calls
					// Only display if response has content
					if (response.markdown && response.markdown.trim()) {
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
					} else {
						// Empty response - might be thinking tokens
						console.warn('Model returned empty response');
						new Notice('Model returned an empty response. This might happen with thinking models. Try rephrasing your question.');
						
						// Still save the user message to history
						if (this.plugin.settings.chatHistory) {
							await this.plugin.sessionHistory.addEntryToSession(this.currentSession, userEntry);
						}
					}
				}
			} catch (error) {
				// Make sure to restore setting even if there's an error
				this.plugin.settings.sendContext = originalSendContext;
				// Remove thinking indicator on error
				thinkingMessage.remove();
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
		const modal = new SessionListModal(
			this.app,
			this.plugin,
			{
				onSelect: async (session: ChatSession) => {
					await this.loadSession(session);
				},
				onDelete: (session: ChatSession) => {
					// If the deleted session is the current one, create a new session
					if (this.currentSession && this.currentSession.id === session.id) {
						this.createNewSession();
					}
				}
			},
			this.currentSession?.id || null
		);
		modal.open();
	}

	private async loadSession(session: ChatSession) {
		try {
			this.currentSession = session;
			
			// Clear chat and reload history
			this.chatContainer.empty();
			await this.loadSessionHistory();
			
			// Update UI
			this.createSessionHeader();
			this.createContextPanel();
			
			new Notice(`Loaded session: ${session.title}`);
		} catch (error) {
			console.error('Failed to load session:', error);
			new Notice('Failed to load session');
		}
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


		// Execute each tool
		const toolResults: any[] = [];
		const context: ToolExecutionContext = {
			plugin: this.plugin,
			session: this.currentSession
		};

		for (const toolCall of toolCalls) {
			try {
				// Show tool execution in UI
				await this.showToolExecution(toolCall.name, toolCall.arguments);
				
				// Execute the tool
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, context);
				
				// Show result in UI
				await this.showToolResult(toolCall.name, result);
				
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
			
			// Don't save tool execution as separate system messages anymore
			// The tool UI elements themselves serve as the visual record
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
				// Display the final response only if it has content
				if (followUpResponse.markdown && followUpResponse.markdown.trim()) {
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
				} else {
					// Model returned empty response - this might happen with thinking tokens
					console.warn('Model returned empty response after tool execution');
					// Try a simpler prompt to get a response
					const retryRequest: ExtendedModelRequest = {
						userMessage: "Please summarize what you just did with the tools.",
						conversationHistory: updatedHistory,
						model: this.plugin.settings.chatModelName,
						prompt: "Please summarize what you just did with the tools.",
						renderContent: false
					};
					
					const retryResponse = await this.plugin.geminiApi.generateModelResponse(retryRequest);
					
					if (retryResponse.markdown && retryResponse.markdown.trim()) {
						const aiEntry: GeminiConversationEntry = {
							role: 'model',
							message: retryResponse.markdown,
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
	 * Show tool execution in the UI as a chat message
	 */
	public async showToolExecution(toolName: string, parameters: any): Promise<void> {
		// Remove empty state if it exists
		const emptyState = this.chatContainer.querySelector('.gemini-agent-empty-chat');
		if (emptyState) {
			emptyState.remove();
		}
		
		// Create collapsible tool message
		const toolMessage = this.chatContainer.createDiv({ 
			cls: 'gemini-agent-message gemini-agent-message-tool'
		});
		
		const toolContent = toolMessage.createDiv({ cls: 'gemini-agent-tool-message' });
		
		// Header with toggle
		const header = toolContent.createDiv({ cls: 'gemini-agent-tool-header' });
		
		const toggle = header.createEl('button', { cls: 'gemini-agent-tool-toggle' });
		setIcon(toggle, 'chevron-right');
		
		const icon = header.createSpan({ cls: 'gemini-agent-tool-icon' });
		// Use tool-specific icons
		const toolIcons: Record<string, string> = {
			'read_file': 'file-text',
			'write_file': 'file-edit',
			'list_files': 'folder-open',
			'create_folder': 'folder-plus',
			'delete_file': 'trash-2',
			'move_file': 'file-symlink',
			'search_files': 'search',
			'google_search': 'globe'
		};
		setIcon(icon, toolIcons[toolName] || 'wrench');
		
		header.createSpan({ 
			text: `Executing: ${toolName}`,
			cls: 'gemini-agent-tool-title'
		});
		
		const status = header.createSpan({ 
			text: 'Running...',
			cls: 'gemini-agent-tool-status gemini-agent-tool-status-running'
		});
		
		// Details (hidden by default)
		const details = toolContent.createDiv({ cls: 'gemini-agent-tool-details' });
		details.style.display = 'none';
		
		// Parameters section
		if (parameters && Object.keys(parameters).length > 0) {
			const paramsSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			paramsSection.createEl('h4', { text: 'Parameters' });
			
			const paramsList = paramsSection.createDiv({ cls: 'gemini-agent-tool-params-list' });
			for (const [key, value] of Object.entries(parameters)) {
				const paramItem = paramsList.createDiv({ cls: 'gemini-agent-tool-param-item' });
				paramItem.createSpan({ 
					text: key,
					cls: 'gemini-agent-tool-param-key' 
				});
				
				const valueStr = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
				const valueEl = paramItem.createEl('code', { 
					text: valueStr,
					cls: 'gemini-agent-tool-param-value' 
				});
				
				// Truncate long values
				if (valueStr.length > 100) {
					valueEl.textContent = valueStr.substring(0, 100) + '...';
					valueEl.title = valueStr; // Show full value on hover
				}
			}
		}
		
		// Toggle functionality
		let isExpanded = false;
		const toggleDetails = () => {
			isExpanded = !isExpanded;
			details.style.display = isExpanded ? 'block' : 'none';
			setIcon(toggle, isExpanded ? 'chevron-down' : 'chevron-right');
			toolContent.toggleClass('gemini-agent-tool-expanded', isExpanded);
		};
		
		// Make both toggle button and header clickable
		toggle.addEventListener('click', (e) => {
			e.stopPropagation();
			toggleDetails();
		});
		header.addEventListener('click', toggleDetails);
		
		// Store reference to update with result
		toolMessage.dataset.toolName = toolName;
		
		// Auto-scroll to new message
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Show tool execution result in the UI as a chat message
	 */
	public async showToolResult(toolName: string, result: any): Promise<void> {
		// Find the existing tool message
		const toolMessages = this.chatContainer.querySelectorAll('.gemini-agent-message-tool');
		let toolMessage: HTMLElement | null = null;
		
		for (const msg of Array.from(toolMessages)) {
			if ((msg as HTMLElement).dataset.toolName === toolName) {
				toolMessage = msg as HTMLElement;
				break;
			}
		}
		
		if (!toolMessage) {
			console.warn(`Tool message not found for ${toolName}`);
			return;
		}
		
		// Update status
		const statusEl = toolMessage.querySelector('.gemini-agent-tool-status') as HTMLElement;
		if (statusEl) {
			statusEl.textContent = result.success ? 'Completed' : 'Failed';
			statusEl.classList.remove('gemini-agent-tool-status-running');
			statusEl.classList.add(result.success ? 'gemini-agent-tool-status-success' : 'gemini-agent-tool-status-error');
			
			// Add completion animation
			toolMessage.classList.add('gemini-agent-tool-completed');
			setTimeout(() => {
				toolMessage.classList.remove('gemini-agent-tool-completed');
			}, 500);
		}
		
		// Update icon
		const iconEl = toolMessage.querySelector('.gemini-agent-tool-icon');
		if (iconEl) {
			setIcon(iconEl, result.success ? 'check-circle' : 'x-circle');
		}
		
		// Add result to details
		const details = toolMessage.querySelector('.gemini-agent-tool-details');
		if (details) {
			// Add result section
			const resultSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			resultSection.createEl('h4', { text: 'Result' });
			
			if (result.success && result.data) {
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });
				
				// Handle different types of results
				if (typeof result.data === 'string') {
					// For string results (like file content)
					if (result.data.length > 500) {
						// Large content - show in a code block with truncation
						const codeBlock = resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
						const code = codeBlock.createEl('code');
						code.textContent = result.data.substring(0, 500) + '\n\n... (truncated)';
						
						// Add button to expand full content
						const expandBtn = resultContent.createEl('button', {
							text: 'Show full content',
							cls: 'gemini-agent-tool-expand-content'
						});
						expandBtn.addEventListener('click', () => {
							code.textContent = result.data;
							expandBtn.remove();
						});
					} else {
						resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
							.createEl('code', { text: result.data });
					}
				} else if (Array.isArray(result.data)) {
					// For arrays (like file lists)
					if (result.data.length === 0) {
						resultContent.createEl('p', { 
							text: 'No results found',
							cls: 'gemini-agent-tool-empty-result'
						});
					} else {
						const list = resultContent.createEl('ul', { cls: 'gemini-agent-tool-result-list' });
						result.data.slice(0, 10).forEach(item => {
							list.createEl('li', { text: item });
						});
						if (result.data.length > 10) {
							resultContent.createEl('p', { 
								text: `... and ${result.data.length - 10} more`,
								cls: 'gemini-agent-tool-more-items'
							});
						}
					}
				} else if (typeof result.data === 'object') {
					// Special handling for read_file results
					if (result.data.content && result.data.path) {
						// This is a file read result
						const fileInfo = resultContent.createDiv({ cls: 'gemini-agent-tool-file-info' });
						fileInfo.createEl('strong', { text: 'File: ' });
						fileInfo.createSpan({ text: result.data.path });
						
						if (result.data.size) {
							fileInfo.createSpan({ 
								text: ` (${this.formatFileSize(result.data.size)})`,
								cls: 'gemini-agent-tool-file-size'
							});
						}
						
						const content = result.data.content;
						if (content.length > 500) {
							// Large content - show in a code block with truncation
							const codeBlock = resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' });
							const code = codeBlock.createEl('code');
							code.textContent = content.substring(0, 500) + '\n\n... (truncated)';
							
							// Add button to expand full content
							const expandBtn = resultContent.createEl('button', {
								text: 'Show full content',
								cls: 'gemini-agent-tool-expand-content'
							});
							expandBtn.addEventListener('click', () => {
								code.textContent = content;
								expandBtn.remove();
							});
						} else {
							resultContent.createEl('pre', { cls: 'gemini-agent-tool-code-result' })
								.createEl('code', { text: content });
						}
					} else {
						// For other objects, show key-value pairs
						const resultList = resultContent.createDiv({ cls: 'gemini-agent-tool-result-object' });
						for (const [key, value] of Object.entries(result.data)) {
							if (key === 'content' && typeof value === 'string' && value.length > 100) {
								// Skip long content in generic display
								continue;
							}
							
							const item = resultList.createDiv({ cls: 'gemini-agent-tool-result-item' });
							item.createSpan({ 
								text: key + ':',
								cls: 'gemini-agent-tool-result-key' 
							});
							
							const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
							item.createSpan({ 
								text: valueStr.length > 100 ? valueStr.substring(0, 100) + '...' : valueStr,
								cls: 'gemini-agent-tool-result-value' 
							});
						}
					}
				}
			} else if (result.error) {
				const errorContent = resultSection.createDiv({ cls: 'gemini-agent-tool-error-content' });
				errorContent.createEl('p', { 
					text: result.error,
					cls: 'gemini-agent-tool-error-message'
				});
			}
		}
		
		// Auto-expand if there was an error
		if (!result.success) {
			const toggle = toolMessage.querySelector('.gemini-agent-tool-toggle') as HTMLElement;
			const toolContent = toolMessage.querySelector('.gemini-agent-tool-message');
			if (toggle && details && toolContent) {
				setIcon(toggle, 'chevron-down');
				(details as HTMLElement).style.display = 'block';
				toolContent.classList.add('gemini-agent-tool-expanded');
			}
		}
	}
	
	private showEmptyState() {
		if (this.chatContainer.children.length === 0) {
			const emptyState = this.chatContainer.createDiv({ cls: 'gemini-agent-empty-chat' });
			
			const icon = emptyState.createDiv({ cls: 'gemini-agent-empty-icon' });
			setIcon(icon, 'bot');
			
			emptyState.createEl('h3', { 
				text: 'Start a conversation',
				cls: 'gemini-agent-empty-title'
			});
			
			emptyState.createEl('p', { 
				text: 'Ask questions, get help with your notes, or use tools to manage your vault.',
				cls: 'gemini-agent-empty-desc'
			});
			
			const suggestions = emptyState.createDiv({ cls: 'gemini-agent-suggestions' });
			const suggestionTexts = [
				'What files are in my vault?',
				'Search for notes about "project"',
				'Create a summary of my recent notes'
			];
			
			suggestionTexts.forEach(text => {
				const suggestion = suggestions.createDiv({ 
					text,
					cls: 'gemini-agent-suggestion'
				});
				suggestion.addEventListener('click', () => {
					this.userInput.value = text;
					this.userInput.focus();
				});
			});
		}
	}
	
	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}
}