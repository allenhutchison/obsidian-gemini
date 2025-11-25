import { App, setIcon, TFile, MarkdownRenderer } from 'obsidian';
import type ObsidianGemini from '../../main';
import { ChatSession } from '../../types/agent';
import { GeminiConversationEntry } from '../../types/conversation';
import { ToolExecutionContext, ToolResult } from '../../tools/types';
import { ExtendedModelRequest } from '../../api/interfaces/model-api';
import { CustomPrompt } from '../../prompts/types';
import { AgentFactory } from '../../agent/agent-factory';
import { generateToolDescription } from '../../utils/text-generation';
import { formatFileSize } from '../../utils/format-utils';

// Tool execution result messages
const TOOL_EXECUTION_FAILED_DEFAULT_MSG = 'Tool execution failed (no error message provided)';
const OPERATION_COMPLETED_SUCCESSFULLY_MSG = 'Operation completed successfully';

/**
 * Callbacks and state access that AgentViewTools needs from AgentView
 */
export interface AgentViewContext {
	getCurrentSession(): ChatSession | null;
	isCancellationRequested(): boolean;
	updateProgress(statusText: string, state?: 'thinking' | 'tool' | 'waiting' | 'streaming'): void;
	hideProgress(): void;
	displayMessage(entry: GeminiConversationEntry): Promise<void>;
	autoLabelSessionIfNeeded(): Promise<void>;
}

/**
 * Manages tool execution display and handling for the Agent View
 */
export class AgentViewTools {
	private currentExecutingTool: string | null = null;
	private lastCompletedTool: string | null = null;

	constructor(
		private app: App,
		private chatContainer: HTMLElement,
		private plugin: ObsidianGemini,
		private context: AgentViewContext
	) {}

	/**
	 * Sort tool calls to ensure safe execution order
	 * Prioritizes reads before writes/deletes to prevent race conditions
	 */
	private sortToolCallsByPriority(toolCalls: any[]): any[] {
		// Define priority order (lower number = higher priority)
		const toolPriority: Record<string, number> = {
			'read_file': 1,
			'list_files': 2,
			'search_files': 3,
			'google_search': 4,
			'web_fetch': 5,
			'write_file': 6,
			'create_folder': 7,
			'move_file': 8,
			'delete_file': 9  // Destructive operations last
		};

		// Sort by priority, maintaining original order for same priority
		return [...toolCalls].sort((a, b) => {
			const priorityA = toolPriority[a.name] || 10;
			const priorityB = toolPriority[b.name] || 10;
			return priorityA - priorityB;
		});
	}

	/**
	 * Handle tool calls from the model response
	 */
	public async handleToolCalls(
		toolCalls: any[],
		userMessage: string,
		conversationHistory: any[],
		userEntry: GeminiConversationEntry,
		customPrompt?: CustomPrompt
	) {
		const currentSession = this.context.getCurrentSession();
		if (!currentSession) return;

		// Execute each tool
		const toolResults: any[] = [];
		const toolContext: ToolExecutionContext = {
			plugin: this.plugin,
			session: currentSession
		};

		// Sort tool calls to prioritize reads before destructive operations
		const sortedToolCalls = this.sortToolCallsByPriority(toolCalls);

		for (const toolCall of sortedToolCalls) {
			// Check if cancellation was requested
			if (this.context.isCancellationRequested()) {
				this.plugin.logger.debug('[AgentViewTools] Cancellation detected, stopping tool execution');
				break;
			}

			try {
				// Generate unique ID for this tool execution
				const toolExecutionId = `${toolCall.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

				// Update progress for this tool with human-friendly description
				const tool = this.plugin.toolRegistry.getTool(toolCall.name);
				const displayName = tool?.displayName || toolCall.name;

				// Use tool's own progress description if available, otherwise use fallback
				let toolDescription: string;
				if (tool?.getProgressDescription) {
					toolDescription = tool.getProgressDescription(toolCall.arguments);
				} else {
					toolDescription = generateToolDescription(this.plugin, toolCall.name, toolCall.arguments, displayName);
				}

				this.context.updateProgress(toolDescription, 'tool');

				// Show tool execution in UI
				await this.showToolExecution(toolCall.name, toolCall.arguments, toolExecutionId);

				// Track current executing tool
				this.currentExecutingTool = toolCall.name;

				// Execute the tool
				// Note: Don't pass 'this' (AgentViewTools) - let execution engine get AgentView from plugin
				const result = await this.plugin.toolExecutionEngine.executeTool(toolCall, toolContext);

				// Track as last completed tool
				this.lastCompletedTool = toolCall.name;
				this.currentExecutingTool = null;

				// Show result in UI
				await this.showToolResult(toolCall.name, result, toolExecutionId);

				// Format result for the model - store original tool call with result
				toolResults.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments,
					result: result
				});
			} catch (error) {
				this.plugin.logger.error(`Tool execution error for ${toolCall.name}:`, error);
				toolResults.push({
					toolName: toolCall.name,
					toolArguments: toolCall.arguments || {},
					result: {
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error'
					}
				});
			}
		}

		// Note: User message was already saved to history before calling handleToolCalls
		// Don't save it again here to avoid duplicates

		// Build updated conversation history with proper Gemini API format:
		// 1. Previous conversation history
		// 2. User message (only if non-empty)
		// 3. Model response with tool calls (as functionCall parts)
		// 4. Tool results (as functionResponse parts)

		// Debug logging for thought signature handling
		this.plugin.logger.debug(
			`[AgentViewTools] Building tool call parts: ${toolCalls.length} calls, ` +
			`${toolCalls.filter(tc => tc.thoughtSignature).length} with signatures`
		);

		const updatedHistory = [
			...conversationHistory,
			// Model's tool calls
			{
				role: 'model',
				parts: toolCalls.map(tc => ({
					functionCall: {
						name: tc.name,
						args: tc.arguments || {}
					},
					...(tc.thoughtSignature && { thoughtSignature: tc.thoughtSignature })
				}))
			},
			// Tool results as functionResponse
			{
				role: 'user',
				parts: toolResults.map(tr => ({
					functionResponse: {
						name: tr.toolName,
						response: tr.result
					}
				}))
			}
		];

		// Only add user message if it's non-empty
		// On recursive calls, userMessage will be empty since the message is already in conversationHistory
		if (userMessage && userMessage.trim()) {
			// Insert user message before the model's tool calls
			updatedHistory.splice(conversationHistory.length, 0, {
				role: 'user',
				parts: [{ text: userMessage }]
			});
		}

		// Check if cancellation was requested before sending follow-up request
		if (this.context.isCancellationRequested()) {
			this.plugin.logger.debug('[AgentViewTools] Cancellation detected, skipping follow-up request');
			return;
		}

		// Send another request with the tool results
		try {
			// Get available tools again for the follow-up request
			const availableToolsContext: ToolExecutionContext = {
				plugin: this.plugin,
				session: currentSession
			};
			const availableTools = this.plugin.toolRegistry.getEnabledTools(availableToolsContext);

			// Get model config from session or use defaults
			const modelConfig = currentSession?.modelConfig || {};

			const followUpRequest: ExtendedModelRequest = {
				userMessage: "", // Empty since tool results are already in conversation history
				conversationHistory: updatedHistory,
				model: modelConfig.model || this.plugin.settings.chatModelName,
				temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
				topP: modelConfig.topP ?? this.plugin.settings.topP,
				prompt: this.plugin.prompts.generalPrompt({ userMessage: "Respond to the user based on the tool execution results" }),
				customPrompt: customPrompt, // Pass custom prompt through to follow-up requests
				renderContent: false,
				availableTools: availableTools  // Include tools so model can chain calls
			};

			// Update progress to show we're processing tool results
			this.context.updateProgress('Processing results...', 'waiting');

			// Use the same model API for follow-up requests
			const modelApi = AgentFactory.createAgentModel(this.plugin, currentSession);

			// Update progress to show we're thinking about the response
			this.context.updateProgress('Thinking...', 'thinking');

			const followUpResponse = await modelApi.generateModelResponse(followUpRequest);

			// Check if the follow-up response also contains tool calls
			if (followUpResponse.toolCalls && followUpResponse.toolCalls.length > 0) {
				// Check if cancellation was requested before recursive call
				if (this.context.isCancellationRequested()) {
					this.plugin.logger.debug('[AgentViewTools] Cancellation detected, skipping recursive tool call');
					return;
				}

				// Recursively handle additional tool calls
				// Don't pass a user message since the tool results are already in history
				await this.handleToolCalls(
					followUpResponse.toolCalls,
					"", // Empty message - tool results already in history
					updatedHistory,
					{
						role: 'system',
						message: 'Continuing with additional tool calls...',
						notePath: '',
						created_at: new Date()
					},
					customPrompt // Pass custom prompt through recursive calls
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
					await this.context.displayMessage(aiEntry);

					// Save final response to history
					if (this.plugin.settings.chatHistory) {
						await this.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);

						// Auto-label session after first exchange
						await this.context.autoLabelSessionIfNeeded();
					}

					// Hide progress bar after successful response
					this.context.hideProgress();
				} else {
					// Model returned empty response - this might happen with thinking tokens
					this.plugin.logger.warn('Model returned empty response after tool execution');

					// Check if cancellation was requested before retry
					if (this.context.isCancellationRequested()) {
						this.plugin.logger.debug('[AgentViewTools] Cancellation detected, skipping retry request');
						return;
					}

					// Try a simpler prompt to get a response
					const retryRequest: ExtendedModelRequest = {
						userMessage: "Please summarize what you just did with the tools.",
						conversationHistory: updatedHistory,
						model: modelConfig.model || this.plugin.settings.chatModelName,
						temperature: modelConfig.temperature ?? this.plugin.settings.temperature,
						topP: modelConfig.topP ?? this.plugin.settings.topP,
						prompt: "Please summarize what you just did with the tools.",
						renderContent: false
					};

					// Use the same model API for retry requests
					const modelApi2 = AgentFactory.createAgentModel(this.plugin, currentSession);
					const retryResponse = await modelApi2.generateModelResponse(retryRequest);

					if (retryResponse.markdown && retryResponse.markdown.trim()) {
						const aiEntry: GeminiConversationEntry = {
							role: 'model',
							message: retryResponse.markdown,
							notePath: '',
							created_at: new Date()
						};
						await this.context.displayMessage(aiEntry);

						// Save final response to history
						if (this.plugin.settings.chatHistory) {
							await this.plugin.sessionHistory.addEntryToSession(currentSession, aiEntry);

							// Auto-label session after first exchange
							await this.context.autoLabelSessionIfNeeded();
						}

						// Hide progress bar after successful retry response
						this.context.hideProgress();
					} else {
						// Always hide progress even if retry returns empty
						this.plugin.logger.warn('Model returned empty response after retry');
						this.context.hideProgress();

						// Show error message to user
						const errorEntry: GeminiConversationEntry = {
							role: 'model',
							message: 'I completed the requested actions but had trouble generating a summary. The tools were executed successfully.',
							notePath: '',
							created_at: new Date()
						};
						await this.context.displayMessage(errorEntry);
					}
				}
			}
		} catch (error) {
			this.plugin.logger.error('Failed to process tool results:', error);
			// Hide progress bar on error
			this.context.hideProgress();
		}
	}

	/**
	 * Show tool execution in the UI as a chat message
	 */
	public async showToolExecution(toolName: string, parameters: any, executionId?: string): Promise<void> {
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

		// Get display name for tool
		const tool = this.plugin.toolRegistry.getTool(toolName);
		const displayName = tool?.displayName || toolName;

		header.createSpan({
			text: `Executing: ${displayName}`,
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
		if (executionId) {
			toolMessage.dataset.executionId = executionId;
		}

		// Auto-scroll to new message
		this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
	}

	/**
	 * Show tool execution result in the UI as a chat message
	 */
	public async showToolResult(toolName: string, result: ToolResult, executionId?: string): Promise<void> {
		// Find the existing tool message
		const toolMessages = this.chatContainer.querySelectorAll('.gemini-agent-message-tool');
		let toolMessage: HTMLElement | null = null;

		if (executionId) {
			// Use execution ID for precise matching
			for (const msg of Array.from(toolMessages)) {
				if ((msg as HTMLElement).dataset.executionId === executionId) {
					toolMessage = msg as HTMLElement;
					break;
				}
			}
		} else {
			// Fallback to tool name (for backward compatibility)
			for (const msg of Array.from(toolMessages)) {
				if ((msg as HTMLElement).dataset.toolName === toolName) {
					toolMessage = msg as HTMLElement;
					break;
				}
			}
		}

		if (!toolMessage) {
			this.plugin.logger.warn(`Tool message not found for ${toolName}`);
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
				if (toolMessage) {
					toolMessage.classList.remove('gemini-agent-tool-completed');
				}
			}, 500);
		}

		// Update icon
		const iconEl = toolMessage.querySelector('.gemini-agent-tool-icon') as HTMLElement;
		if (iconEl) {
			setIcon(iconEl, result.success ? 'check-circle' : 'x-circle');
		}

		// Add result to details
		const details = toolMessage.querySelector('.gemini-agent-tool-details');
		if (details) {
			// Add result section
			const resultSection = details.createDiv({ cls: 'gemini-agent-tool-section' });
			resultSection.createEl('h4', { text: 'Result' });

			// Always show error first if the tool failed
			// Defensive check: handle both false and undefined success values
			if (result.success === false || result.success === undefined) {
				const errorContent = resultSection.createDiv({ cls: 'gemini-agent-tool-error-content' });
				const errorMessage = result.error || TOOL_EXECUTION_FAILED_DEFAULT_MSG;
				errorContent.createEl('p', {
					text: errorMessage,
					cls: 'gemini-agent-tool-error-message'
				});
			} else if (result.data) {
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
						result.data.slice(0, 10).forEach((item: any) => {
							list.createEl('li', { text: String(item) });
						});
						if (result.data.length > 10) {
							resultContent.createEl('p', {
								text: `... and ${result.data.length - 10} more`,
								cls: 'gemini-agent-tool-more-items'
							});
						}
					}
				} else if (typeof result.data === 'object') {
					// Debug logging
					this.plugin.logger.log('Tool result is object for:', toolName);
					this.plugin.logger.log('Result data keys:', Object.keys(result.data));

					// Special handling for google_search results with citations
					if (result.data.answer && result.data.citations && toolName === 'google_search') {
						this.plugin.logger.log('Handling google_search result with citations');
						// Display the answer
						const answerDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-search-answer' });
						answerDiv.createEl('h5', { text: 'Answer:' });

						// Render the answer with markdown links
						const answerPara = answerDiv.createEl('p');
						// Parse markdown links in the answer
						const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
						let lastIndex = 0;
						let match;

						while ((match = linkRegex.exec(result.data.answer)) !== null) {
							// Add text before the link
							if (match.index > lastIndex) {
								answerPara.appendText(result.data.answer.substring(lastIndex, match.index));
							}

							// Add the link
							const link = answerPara.createEl('a', {
								text: match[1],
								href: match[2]
							});
							link.setAttribute('target', '_blank');

							lastIndex = linkRegex.lastIndex;
						}

						// Add any remaining text
						if (lastIndex < result.data.answer.length) {
							answerPara.appendText(result.data.answer.substring(lastIndex));
						}

						// Display citations if available
						if (result.data.citations.length > 0) {
							const citationsDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-citations' });
							citationsDiv.createEl('h5', { text: 'Sources:' });

							const citationsList = citationsDiv.createEl('ul', { cls: 'gemini-agent-tool-citations-list' });
							for (const citation of result.data.citations) {
								const citationItem = citationsList.createEl('li');
								const link = citationItem.createEl('a', {
									text: citation.title || citation.url,
									href: citation.url,
									cls: 'gemini-agent-tool-citation-link'
								});
								link.setAttribute('target', '_blank');

								if (citation.snippet) {
									citationItem.createEl('p', {
										text: citation.snippet,
										cls: 'gemini-agent-tool-citation-snippet'
									});
								}
							}
						}
					// Special handling for generate_image results
					} else if (result.data.path && result.data.wikilink && toolName === 'generate_image') {
						// Display the generated image
						const imageDiv = resultContent.createDiv({ cls: 'gemini-agent-tool-image-result' });
						imageDiv.createEl('h5', { text: 'Generated Image:' });

						// Get the image file from vault
						const imageFile = this.plugin.app.vault.getAbstractFileByPath(result.data.path);
						if (imageFile instanceof TFile) {
							// Create image element
							const imgContainer = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-container' });
							const img = imgContainer.createEl('img', {
								cls: 'gemini-agent-tool-image'
							});

							// Add loading states and error handling
							img.onloadstart = () => imgContainer.addClass('loading');
							img.onload = () => imgContainer.removeClass('loading');
							img.onerror = () => {
								img.style.display = 'none';
								imgContainer.removeClass('loading');
								imgContainer.createEl('p', {
									text: 'Failed to load image preview',
									cls: 'gemini-agent-tool-image-error'
								});
							};

							// Get the image URL from Obsidian's resource path
							try {
								img.src = this.plugin.app.vault.getResourcePath(imageFile);
								img.alt = result.data.prompt || 'Generated image';
							} catch (error) {
								this.plugin.logger.error('Failed to get resource path for image:', error);
								img.onerror?.(new Event('error'));
							}

							// Add image info
							const imageInfo = imageDiv.createDiv({ cls: 'gemini-agent-tool-image-info' });
							imageInfo.createEl('strong', { text: 'Path: ' });
							imageInfo.createSpan({ text: result.data.path });

							// Add wikilink for easy copying
							imageInfo.createEl('br');
							imageInfo.createEl('strong', { text: 'Wikilink: ' });
							const wikilinkCode = imageInfo.createEl('code', {
								text: result.data.wikilink,
								cls: 'gemini-agent-tool-wikilink'
							});

							// Add copy button for wikilink
							const copyBtn = imageInfo.createEl('button', {
								text: 'Copy',
								cls: 'gemini-agent-tool-copy-wikilink'
							});
							copyBtn.addEventListener('click', () => {
								navigator.clipboard.writeText(result.data.wikilink).then(() => {
									copyBtn.textContent = 'Copied!';
									setTimeout(() => {
										copyBtn.textContent = 'Copy';
									}, 2000);
								});
							});
						} else {
							imageDiv.createEl('p', {
								text: `Image saved to: ${result.data.path}`,
								cls: 'gemini-agent-tool-image-path'
							});
						}
					// Special handling for read_file results
					} else if (result.data.content && result.data.path) {
						// This is a file read result
						const fileInfo = resultContent.createDiv({ cls: 'gemini-agent-tool-file-info' });
						fileInfo.createEl('strong', { text: 'File: ' });
						fileInfo.createSpan({ text: result.data.path });

						if (result.data.size) {
							fileInfo.createSpan({
								text: ` (${formatFileSize(result.data.size)})`,
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
							// Skip undefined/null values
							if (value === undefined || value === null) {
								continue;
							}

							if (key === 'content' && typeof value === 'string' && value.length > 100) {
								// Skip long content in generic display
								continue;
							}

							const item = resultList.createDiv({ cls: 'gemini-agent-tool-result-item' });
							item.createSpan({
								text: key + ':',
								cls: 'gemini-agent-tool-result-key'
							});

							const valueStr = typeof value === 'string' ? value : JSON.stringify(value) || String(value);
							item.createSpan({
								text: valueStr.length > 100 ? valueStr.substring(0, 100) + '...' : valueStr,
								cls: 'gemini-agent-tool-result-value'
							});
						}
					}
				}
			} else {
				// Success but no data - show a success message with tool name for context
				const resultContent = resultSection.createDiv({ cls: 'gemini-agent-tool-result-content' });
				resultContent.createEl('p', {
					text: `${toolName}: ${OPERATION_COMPLETED_SUCCESSFULLY_MSG}`,
					cls: 'gemini-agent-tool-success-message'
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

	/**
	 * Get current executing tool
	 */
	public getCurrentExecutingTool(): string | null {
		return this.currentExecutingTool;
	}

	/**
	 * Get last completed tool
	 */
	public getLastCompletedTool(): string | null {
		return this.lastCompletedTool;
	}
}
