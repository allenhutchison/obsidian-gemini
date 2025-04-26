import ObsidianGemini from '../../main';
import { ModelApi } from './interfaces/model-api';
import { GeminiApi } from './implementations/gemini-api';
import { GeminiApiNew } from './implementations/gemini-api-new';
import { OllamaApi } from './implementations/ollama-api';
import { GeminiPrompts } from '../prompts';

/**
 * Enum for different API providers
 */
export enum ApiProvider {
    GEMINI = 'gemini',
    GEMINI_NEW = 'gemini-new',
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
            case ApiProvider.GEMINI_NEW:
                // For GeminiApiNew, get API key from plugin settings
                // Build date/time prompts using local GeminiPrompts instance
                const prompts = new GeminiPrompts();
                const datePrompt = prompts.datePrompt({ date: new Date().toDateString() });
                const timePrompt = prompts.timePrompt({ time: new Date().toLocaleTimeString() });
                // Build file context if enabled
                let fileContext: string | null = null;
                
                return new GeminiApiNew(
                    plugin,
                    plugin.settings.apiKey,
                    plugin.settings.chatModelName,
                    plugin.settings.debugMode,
                    datePrompt,
                    timePrompt,
                    plugin.settings.sendContext
                );
            case ApiProvider.GEMINI:
            default:
                return new GeminiApi(plugin);
        }
    }
} 