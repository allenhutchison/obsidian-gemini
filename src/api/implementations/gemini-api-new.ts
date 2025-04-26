import { GoogleGenAI } from "@google/genai";
import { logDebugInfo } from "../utils/debug";
import { buildGeminiChatContents } from "../utils/build-contents";
import {
  ModelApi,
  BaseModelRequest,
  ExtendedModelRequest,
  ModelResponse,
} from "../interfaces/model-api";

/**
 * Implementation of ModelApi using the new @google/genai SDK.
 */
export class GeminiApiNew implements ModelApi {
  private ai: GoogleGenAI;
  private model: string;
  private debugMode: boolean;
  private datePrompt?: string;
  private timePrompt?: string;
  private sendContext?: boolean;
  private plugin: any;

  /**
   * @param apiKey Gemini API key
   * @param model Model name/id (optional, defaults to 'gemini-pro')
   */
  constructor(plugin: any, apiKey: string, model: string = "gemini-pro", debugMode: boolean = false, datePrompt?: string, timePrompt?: string, sendContext?: boolean) {
    this.plugin = plugin;
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.debugMode = debugMode;
    this.datePrompt = datePrompt;
    this.timePrompt = timePrompt;
    this.sendContext = sendContext;
  }

  async generateModelResponse(
    request: BaseModelRequest | ExtendedModelRequest
  ): Promise<ModelResponse> {
    const modelToUse = request.model ?? this.model;
    const prompt = "prompt" in request ? request.prompt : "";
    if (!prompt) throw new Error("No prompt provided to generateModelResponse.");

    // Prepare contents: for chat/multi-turn, send as array; else as string
    let contents: any = prompt;
    if ("conversationHistory" in request && Array.isArray(request.conversationHistory)) {
      let fileContext: string | null = null;
      if (this.sendContext && this.plugin?.gfile?.getCurrentFileContent) {
        fileContext = await this.plugin.gfile.getCurrentFileContent(this.plugin.settings.maxContextDepth, true);
      }
      contents = await buildGeminiChatContents({
        prompt,
        userMessage: (request as any).userMessage || prompt,
        conversationHistory: (request as any).conversationHistory,
        datePrompt: this.datePrompt,
        timePrompt: this.timePrompt,
        fileContext,
        sendContext: this.sendContext,
        debugFn: (title: string, data: any) => logDebugInfo(this.debugMode, title, data),
      });
    }

    // Use the new SDK's models.generateContent
    const response = await this.ai.models.generateContent({
      model: modelToUse,
      contents,
    });

    // Extract the text response (handle both getter and fallback)
    let markdown = "";
    // Debug output for model response
    logDebugInfo(this.debugMode, 'Model Response', response);

    if (response && typeof response.text === "string") {
      markdown = response.text;
    } else if (response && typeof (response as any).text === "function") {
      markdown = (response as any).text();
    } else if (response && response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      markdown = candidate?.content?.parts?.[0]?.text ?? "";
    }
    return {
      markdown: markdown ?? "",
      rendered: "",
    };

  }
}
