import { GoogleGenAI } from '@google/genai';
import { logDebugInfo } from '../utils/debug';
import {
	ModelApi,
	BaseModelRequest,
	ExtendedModelRequest,
	ModelResponse,
	StreamCallback,
	StreamingModelResponse,
	ToolCall,
} from '../interfaces/model-api';
import ObsidianGemini from '../../../main';
import { GeminiPrompts } from '../../prompts';
import { ToolConverter } from '../../tools/tool-converter';

/**
 * Implementation of ModelApi using the new @google/genai SDK.
 */
export class GeminiApiNew implements ModelApi {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private ai: GoogleGenAI;
	private prompts: GeminiPrompts;

	/**
	 * @param apiKey Gemini API key
	 * @param model Model name/id (optional, defaults to 'gemini-pro')
	 */
	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
		this.ai = new GoogleGenAI({ apiKey: this.plugin.settings.apiKey });
		this.prompts = new GeminiPrompts(plugin);
	}

	generateStreamingResponse(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse {
		let cancelled = false;

		const complete = (async (): Promise<ModelResponse> => {
			console.log('DEBUG: generateStreamingResponse called with request:', request);
			logDebugInfo(this.plugin.settings.debugMode, 'Generating streaming response for request', request);

			// Get system instruction with optional custom prompt and tools
			const customPrompt = 'customPrompt' in request ? request.customPrompt : undefined;
			const hasTools = 'availableTools' in request && request.availableTools && request.availableTools.length > 0;
			
			let systemInstruction: string;
			if (hasTools) {
				// Use tools-aware system prompt
				systemInstruction = this.prompts.getSystemPromptWithTools(request.availableTools!);
				if (customPrompt) {
					// Append custom prompt if provided
					if (customPrompt.overrideSystemPrompt) {
						systemInstruction = customPrompt.content;
					} else {
						systemInstruction += `\n\n## Additional Instructions\n\n${customPrompt.content}`;
					}
				}
			} else {
				// Use regular system prompt
				systemInstruction = await this.prompts.getSystemPromptWithCustom(customPrompt);
			}

			const modelToUse = request.model ?? this.plugin.settings.chatModelName;

			let fullMarkdown = '';
			let rendered = '';
			const toolCalls: ToolCall[] = [];

			try {
				if ('conversationHistory' in request) {
					let tools: any[] = [];
					
					// Check if we have custom tools
					const hasCustomTools = request.availableTools && request.availableTools.length > 0;
					
					// Google Search and function calling are mutually exclusive in the Gemini API
					// Error: "Tool use with function calling is unsupported" when both are used
					// Only add Google Search if we don't have custom tools
					if (this.plugin.settings.searchGrounding && !hasCustomTools) {
						tools.push({ googleSearch: {} });
					}
					
					// Add available custom tools if provided
					if (hasCustomTools) {
						console.log('DEBUG: Available tools from request:', request.availableTools);
						console.log('DEBUG: Google Search disabled due to custom tools');
						logDebugInfo(this.plugin.settings.debugMode, 'Available tools from request', request.availableTools);
						
						// Convert tools to function declarations format
						// The SDK expects function_declarations to be part of the tools array
						const functionDeclarations = request.availableTools!.map(tool => ({
							name: tool.name,
							description: tool.description,
							parameters: {
								type: 'object' as const,
								properties: tool.parameters.properties || {},
								required: tool.parameters.required || []
							}
						}));
						
						console.log('DEBUG: Function declarations:', JSON.stringify(functionDeclarations, null, 2));
						
						// Add function declarations as a single tool entry
						if (functionDeclarations.length > 0) {
							tools.push({
								functionDeclarations: functionDeclarations  // Note: camelCase!
							});
							console.log('DEBUG: Tools array after adding functionDeclarations:', JSON.stringify(tools, null, 2));
							logDebugInfo(this.plugin.settings.debugMode, 'Function declarations added to tools', functionDeclarations);
						}
					} else {
						console.log('DEBUG: No available tools in request');
						logDebugInfo(this.plugin.settings.debugMode, 'No available tools in request', request.availableTools);
					}
					
					const contents = await this.buildGeminiChatContents(request);

					// Build config object
					const config: any = {
						systemInstruction: systemInstruction,
						temperature: request.temperature ?? this.plugin.settings.temperature,
						topP: request.topP ?? this.plugin.settings.topP,
					};
					
					// Only add tools if we have any
					if (tools.length > 0) {
						config.tools = tools;
						console.log('DEBUG: Final tools array before API call:', JSON.stringify(tools, null, 2));
						logDebugInfo(this.plugin.settings.debugMode, 'Final tools array before API call', tools);
					}

					console.log('DEBUG: About to call generateContentStream with config:', JSON.stringify(config, null, 2));
					const streamingResult = await this.ai.models.generateContentStream({
						model: modelToUse,
						config: config,
						contents: contents,
					});
					console.log('DEBUG: generateContentStream called');

					// Process streaming chunks
					let finalResponse;
					for await (const chunk of streamingResult) {
						if (cancelled) {
							break;
						}
						finalResponse = chunk;
						
						// Handle text parts in the chunk
						if (chunk.text) {
							const decodedText = this._decodeHtmlEntities(chunk.text);
							fullMarkdown += decodedText;
							onChunk(decodedText);
						}
						
						// Check for function calls in the chunk
						if (chunk.candidates?.[0]?.content?.parts) {
							for (const part of chunk.candidates[0].content.parts) {
								// Handle function calls
								if (part.functionCall && part.functionCall.name) {
									toolCalls.push({
										name: part.functionCall.name,
										arguments: part.functionCall.args || {}
									});
								}
							}
						}
					}
					
					logDebugInfo(this.plugin.settings.debugMode, 'Streaming response complete', { 
						text: fullMarkdown, 
						toolCalls,
						finalResponse: finalResponse
					});
				} else {
					const streamingResult = await this.ai.models.generateContentStream({
						model: modelToUse,
						contents: request.prompt,
						config: {
							temperature: request.temperature ?? this.plugin.settings.temperature,
							topP: request.topP ?? this.plugin.settings.topP,
						},
					});

					for await (const chunk of streamingResult) {
						if (cancelled) {
							break;
						}

						const chunkText = chunk.text;
						if (chunkText) {
							const decodedChunk = this._decodeHtmlEntities(chunkText);
							fullMarkdown += decodedChunk;
							onChunk(decodedChunk);
						}
					}
				}
			} catch (error) {
				console.error('Error during streaming:', error);
				throw error;
			}

			return { markdown: fullMarkdown, rendered, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
		})();

		return {
			complete,
			cancel: () => {
				cancelled = true;
			},
		};
	}

	async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
		logDebugInfo(this.plugin.settings.debugMode, 'Generating model response for request', request);

		// Get system instruction with optional custom prompt and tools
		const customPrompt = 'customPrompt' in request ? request.customPrompt : undefined;
		const hasTools = 'availableTools' in request && request.availableTools && request.availableTools.length > 0;
		
		let systemInstruction: string;
		if (hasTools) {
			// Use tools-aware system prompt
			systemInstruction = this.prompts.getSystemPromptWithTools(request.availableTools!);
			if (customPrompt) {
				// Append custom prompt if provided
				if (customPrompt.overrideSystemPrompt) {
					systemInstruction = customPrompt.content;
				} else {
					systemInstruction += `\n\n## Additional Instructions\n\n${customPrompt.content}`;
				}
			}
		} else {
			// Use regular system prompt
			systemInstruction = await this.prompts.getSystemPromptWithCustom(customPrompt);
		}

		const modelToUse = request.model ?? this.plugin.settings.chatModelName;

		console.log('DEBUG: generateModelResponse called with request:', request);
		let response: ModelResponse = { markdown: '', rendered: '' };
		if ('conversationHistory' in request) {
			let tools: any[] = [];
			
			// Check if we have custom tools
			const hasCustomTools = request.availableTools && request.availableTools.length > 0;
			
			// Google Search and function calling are mutually exclusive in the Gemini API
			// Error: "Tool use with function calling is unsupported" when both are used
			// Only add Google Search if we don't have custom tools
			if (this.plugin.settings.searchGrounding && !hasCustomTools) {
				tools.push({ googleSearch: {} });
			}
			
			// Add available custom tools if provided
			if (hasCustomTools) {
				// Convert tools to function declarations format
				const functionDeclarations = request.availableTools!.map(tool => ({
					name: tool.name,
					description: tool.description,
					parameters: {
						type: 'object' as const,
						properties: tool.parameters.properties || {},
						required: tool.parameters.required || []
					}
				}));
				
				// Add function declarations as a single tool entry
				if (functionDeclarations.length > 0) {
					tools.push({
						functionDeclarations: functionDeclarations  // Note: camelCase!
					});
					logDebugInfo(this.plugin.settings.debugMode, 'Tools being sent to Gemini (non-streaming)', tools);
				}
			}
			
			const contents = await this.buildGeminiChatContents(request);
			
			// Build config object
			const config: any = {
				systemInstruction: systemInstruction,
				temperature: request.temperature ?? this.plugin.settings.temperature,
				topP: request.topP ?? this.plugin.settings.topP,
			};
			
			// Only add tools if we have any
			if (tools.length > 0) {
				config.tools = tools;
			}
			
			console.log('DEBUG: About to call generateContent with config:', JSON.stringify(config, null, 2));
			const result = await this.ai.models.generateContent({
				model: modelToUse,
				config: config,
				contents: contents,
			});
			console.log('DEBUG: generateContent called');
			logDebugInfo(this.plugin.settings.debugMode, 'Model response', result);
			response = this.parseModelResult(result);
		} else {
			const result = await this.ai.models.generateContent({
				model: modelToUse,
				contents: request.prompt,
				config: {
					temperature: request.temperature ?? this.plugin.settings.temperature,
					topP: request.topP ?? this.plugin.settings.topP,
				},
			});
			response = this.parseModelResult(result);
		}

		return response;
	}

	async buildGeminiChatContents(request: ExtendedModelRequest): Promise<any[]> {
		const contents = [];

		// First push the base prompt on the stack.
		if (request.prompt != null) {
			contents.push(request.prompt);
		}

		// Then push the file context.
		const depth = this.plugin.settings.maxContextDepth;
		const renderContent = request.renderContent ?? true;
		const fileContent = await this.plugin.gfile.getCurrentFileContent(depth, renderContent);
		if (fileContent != null) {
			contents.push(fileContent);
		}

		// Now the entire conversation history.
		const history = request.conversationHistory ?? [];
		history.forEach((entry) => {
			contents.push(entry.message);
		});

		// Finally, the latest user message.
		contents.push(request.userMessage);
		logDebugInfo(this.plugin.settings.debugMode, 'Chat contents', contents);
		return contents;
	}

	private parseModelResult(result: any): ModelResponse {
		let response: ModelResponse = { markdown: '', rendered: '' };
		const toolCalls: ToolCall[] = [];

		// Extract text from the response
		try {
			// Check for function calls in the response
			if (result.candidates?.[0]?.content?.parts) {
				for (const part of result.candidates[0].content.parts) {
					// Handle text parts
					if (part.text) {
						response.markdown += this._decodeHtmlEntities(part.text);
					}
					
					// Handle function calls
					if (part.functionCall) {
						toolCalls.push({
							name: part.functionCall.name,
							arguments: part.functionCall.args || {}
						});
					}
				}
			} else {
				// Fallback to old parsing logic
				let rawMarkdown = '';
				if (result.text && typeof result.text === 'string') {
					// Check if result.text is a string
					// New API format
					rawMarkdown = result.text;
				} else if (typeof result.text === 'function') {
					// Old API format (keeping for backward compatibility)
					const textContent = result.text();
					if (typeof textContent === 'string') {
						// Ensure the function returns a string
						rawMarkdown = textContent;
					}
				}
				// ... (other conditions for extracting text if any) ...

				if (rawMarkdown) {
					// Check if rawMarkdown has content
					response.markdown = this._decodeHtmlEntities(rawMarkdown);
				} else {
					response.markdown = ''; // Ensure markdown is empty string if no text extracted
				}
			}

			// Extract search grounding metadata if available
			if (result.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			} else if (result.response?.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			}
			
			// Add tool calls if any were found
			if (toolCalls.length > 0) {
				response.toolCalls = toolCalls;
			}
		} catch (error) {
			console.error('Error parsing model result:', error);
			console.log('Result:', JSON.stringify(result));
		}

		return response;
	}

	private _decodeHtmlEntities(encodedString: string): string {
		if (typeof document !== 'undefined') {
			const textarea = document.createElement('textarea');
			textarea.innerHTML = encodedString;
			return textarea.value;
		}
		// Fallback for environments where document is not available,
		// though for an Obsidian plugin, 'document' should typically exist.
		// This fallback could be simpler or more complex depending on requirements.
		// For now, let's assume 'document' is available and not overcomplicate the fallback.
		// If a more robust non-DOM fallback is needed, a library like 'he' would be better.
		console.warn('HTML entity decoding attempted in an environment without `document`. Returning original string.');
		return encodedString;
	}
}
