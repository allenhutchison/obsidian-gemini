import { GoogleGenAI } from "@google/genai";
import { logDebugInfo } from "../utils/debug";
import {
  ModelApi,
  BaseModelRequest,
  ExtendedModelRequest,
  ModelResponse,
} from "../interfaces/model-api";
import ObsidianGemini from "../../../main";
import { GeminiPrompts } from "../../prompts";

/**
 * Implementation of ModelApi using the new @google/genai SDK.
 */
export class GeminiApiNew implements ModelApi {
  private plugin: ObsidianGemini;
  private ai: GoogleGenAI;
  private prompts: GeminiPrompts;

  /**
   * @param apiKey Gemini API key
   * @param model Model name/id (optional, defaults to 'gemini-pro')
   */
  constructor(plugin: ObsidianGemini) {
    this.plugin = plugin;
    this.ai = new GoogleGenAI({ apiKey: this.plugin.settings.apiKey });
    this.prompts = new GeminiPrompts();
  }

  async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
    logDebugInfo(this.plugin.settings.debugMode, 'Generating model response for request', request);
    const lang = window.localStorage.getItem('language') || 'en';
    const systemInstruction = this.prompts.systemPrompt({
			userName: this.plugin.settings.userName,
			language: lang,
		});
		const modelToUse = request.model ?? this.plugin.settings.chatModelName;
    


    let response: ModelResponse = { markdown: '', rendered: '' };
    if ("conversationHistory" in request) {
      let tools = [];
      if (this.plugin.settings.searchGrounding) {
        tools.push({googleSearch: {}});
      }
      const contents = await this.buildGeminiChatContents(request);
      const result = await this.ai.models.generateContent({
        model: modelToUse,
        config: {
          tools: tools
        },
        contents: contents,
      });
      logDebugInfo(this.plugin.settings.debugMode, 'Model response', result);
      response = this.parseModelResult(result);
    } else {
      const result = await this.ai.models.generateContent({
        model: modelToUse,
        contents: request.prompt,
      });
      response = this.parseModelResult(result);
    }

    return response;
  }

  async buildGeminiChatContents(request: ExtendedModelRequest): Promise<any[]> {
    const prompts = new GeminiPrompts();
    const contents = [];
  
    // First push the base prompt on the stack.
    if (request.prompt != null) {
      contents.push(request.prompt);
    }
  
    // Then push the current date
    const date = prompts.datePrompt({ date: new Date().toDateString() });
    contents.push(date);
  
    // Then push the current time
    const time = prompts.timePrompt({ time: new Date().toLocaleTimeString() });
    contents.push(time);
  
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
		
		// Extract text from the response
		try {
			if (result.text) {
				// New API format
				response.markdown = result.text;
			//} //else if (result.candidates && result.candidates.length > 0) {
				// Another possible format
			//	response.markdown = result.candidates[0].content.parts[0].text;
			} else if (typeof result.text === 'function') {
				// Old API format (keeping for backward compatibility)
				response.markdown = result.text();
			}
			
			// Extract search grounding metadata if available
			if (result.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			} else if (result.response?.candidates?.[0]?.groundingMetadata?.searchEntryPoint) {
				response.rendered = result.response.candidates[0].groundingMetadata.searchEntryPoint.renderedContent ?? '';
			}
		} catch (error) {
			console.error('Error parsing model result:', error);
			console.log('Result:', JSON.stringify(result));
		}
		
		return response;
	}
}
