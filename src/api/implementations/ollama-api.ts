import ollama, { Ollama, ChatResponse, GenerateResponse, ListResponse } from 'ollama';
import { Api, ModelResponse, ModelRequest, ChatModelResponse, GenerateModelResponse } from '../api-interface';
import ObsidianGemini from '../../../main';

export class OllamaApi implements Api {
  private client: Ollama;

  constructor(private plugin: ObsidianGemini) {
    const baseURL = plugin.settings.ollamaBaseUrl || "http://localhost:11434";
    this.client = new ollama.Ollama({ host: baseURL });
  }

  async listModels(): Promise<ListResponse> {
    return this.client.list();
  }

  async generateModelResponse(request: ModelRequest): Promise<ModelResponse> {
    if (request.type === 'chat') {
      const ollamaRequest = {
        model: request.model,
        messages: request.messages,
        stream: request.stream || false,
      };
      const response: ChatResponse = await this.client.chat(ollamaRequest);
      return {
        type: 'chat',
        message: response.message,
        done: response.done,
      } as ChatModelResponse;
    } else if (request.type === 'generate') {
      const ollamaRequest = {
        model: request.model,
        prompt: request.prompt,
        stream: request.stream || false,
      };
      const response: GenerateResponse = await this.client.generate(ollamaRequest);
      return {
        type: 'generate',
        response: response.response,
        done: response.done,
      } as GenerateModelResponse;
    } else {
      // This case should ideally be prevented by TypeScript's type checking
      // if ModelRequest is a discriminated union.
      // However, to satisfy the return type, we must return something.
      // Consider logging an error or throwing a more specific error.
      return {
        type: 'error', // Or some other appropriate error type
        error: 'Invalid request type',
        done: true, // Assuming errors mean the process is "done"
      } as any; // Cast to any if you don't have a specific ErrorModelResponse
    }
  }
}