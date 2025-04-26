import ObsidianGemini from '../../../main';
import { Notice } from 'obsidian';
import { ModelApi, BaseModelRequest, ExtendedModelRequest, ModelResponse } from '../interfaces/model-api';

/**
 * Implementation of ModelApi for Ollama
 * This is a placeholder implementation that will be filled in later
 */
export class OllamaApi implements ModelApi {
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }

    async generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse> {
        // Placeholder implementation
        new Notice('Ollama API not yet implemented');
        
        return {
            markdown: "Ollama API not yet implemented. Please check back later.",
            rendered: ""
        };
    }
} 