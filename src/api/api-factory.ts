import ObsidianGemini from '../main';
import { ModelApi } from './interfaces/model-api';
import { GeminiApiNew } from './implementations/gemini-api-new';
import { OllamaApi } from './implementations/ollama-api';
import { RetryModelApiDecorator } from './retry-model-api-decorator';

/**
 * Enum for different API providers
 */
export enum ApiProvider {
	GEMINI = 'gemini',
	OLLAMA = 'ollama',
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
	static createApi(plugin: InstanceType<typeof ObsidianGemini>, provider?: ApiProvider): ModelApi {
		// Use the provider argument or get from settings
		const apiProvider = provider || (plugin.settings.apiProvider as ApiProvider) || ApiProvider.GEMINI;

		let apiInstance: ModelApi;

		switch (apiProvider) {
			case ApiProvider.OLLAMA:
				apiInstance = new OllamaApi(plugin);
				break;
			case ApiProvider.GEMINI:
			default:
				apiInstance = new GeminiApiNew(plugin);
				break;
		}

		// Wrap the created API instance with the RetryModelApiDecorator
		const retryDecoratedApi = new RetryModelApiDecorator(apiInstance, plugin);

		return retryDecoratedApi;
	}
}
