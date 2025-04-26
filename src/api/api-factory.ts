import ObsidianGemini from '../../main';
import { ModelApi } from './interfaces/model-api';
import { GeminiApi } from './implementations/gemini-api';
import { OllamaApi } from './implementations/ollama-api';

/**
 * Enum for different API providers
 */
export enum ApiProvider {
    GEMINI = 'gemini',
    OLLAMA = 'ollama'
}

/**
 * Factory for creating API implementations
 */
export class ApiFactory {
    /**
     * Creates and returns the appropriate API implementation
     * 
     * @param plugin The plugin instance
     * @param provider Optional provider to override the settings
     * @returns An implementation of the ModelApi interface
     */
    static createApi(plugin: ObsidianGemini, provider?: ApiProvider): ModelApi {
        // Use the provider argument or get from settings
        const apiProvider = provider || (plugin.settings.apiProvider as ApiProvider) || ApiProvider.GEMINI;
        
        switch (apiProvider) {
            case ApiProvider.OLLAMA:
                return new OllamaApi(plugin);
            case ApiProvider.GEMINI:
            default:
                return new GeminiApi(plugin);
        }
    }
} 