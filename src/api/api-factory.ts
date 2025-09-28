import ObsidianGemini from '../main';
import { ModelApi } from './interfaces/model-api';
import { GeminiApiNew } from './implementations/gemini-api-new';
import { GeminiApiConfig } from './implementations/gemini-api-config';
import { OllamaApi } from './implementations/ollama-api';
import { RetryModelApiDecorator } from './retry-model-api-decorator';
import { RetryDecoratorConfig } from './retry-decorator-config';
import { ApiConfig, ModelConfig, RetryConfig } from './config/model-config';
import { GeminiPrompts } from '../prompts';

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
	 * @deprecated Use createApiWithConfig for new code
	 *
	 * @param plugin The plugin instance
	 * @param provider Optional provider to override the settings
	 * @returns An implementation of the ModelApi interface
	 */
	static createApi(plugin: InstanceType<typeof ObsidianGemini>, provider?: ApiProvider): ModelApi {
		// Convert plugin settings to config and delegate to new method
		const config = this.createConfigFromPlugin(plugin, provider ? { provider } : undefined);
		return this.createApiWithConfig(config, plugin);
	}

	/**
	 * Creates an API instance using configuration object
	 * This is the preferred method for creating APIs
	 *
	 * @param config The API configuration
	 * @param plugin Optional plugin instance for backward compatibility
	 * @returns An implementation of the ModelApi interface
	 */
	static createApiWithConfig(config: ApiConfig, plugin?: InstanceType<typeof ObsidianGemini>): ModelApi {
		let apiInstance: ModelApi;

		switch (config.provider) {
			case ApiProvider.OLLAMA:
				// TODO: Create OllamaApiConfig to accept config instead of plugin
				if (plugin) {
					apiInstance = new OllamaApi(plugin);
				} else {
					throw new Error('OllamaApi currently requires plugin instance');
				}
				break;
			case ApiProvider.GEMINI:
			default:
				const prompts = plugin ? new GeminiPrompts(plugin) : undefined;
				apiInstance = new GeminiApiConfig(config.modelConfig, config.features, prompts, plugin);
				break;
		}

		// Apply retry decorator if configured
		if (config.retryConfig) {
			if (plugin) {
				// Use old decorator for backward compatibility
				apiInstance = new RetryModelApiDecorator(apiInstance, plugin);
			} else {
				// Use new config-based decorator
				apiInstance = new RetryDecoratorConfig(apiInstance, config.retryConfig);
			}
		}

		return apiInstance;
	}

	/**
	 * Creates an API configuration from plugin settings
	 *
	 * @param plugin The plugin instance
	 * @param overrides Optional configuration overrides
	 * @returns API configuration object
	 */
	static createConfigFromPlugin(
		plugin: InstanceType<typeof ObsidianGemini>,
		overrides?: Partial<ApiConfig>
	): ApiConfig {
		const provider = overrides?.provider || (plugin.settings.apiProvider as ApiProvider) || ApiProvider.GEMINI;

		// The default model is the chat model, but it can be overridden
		const defaultModel = plugin.settings.chatModelName;

		return {
			provider,
			modelConfig: {
				apiKey: plugin.settings.apiKey,
				model: overrides?.modelConfig?.model || defaultModel,
				temperature: overrides?.modelConfig?.temperature ?? plugin.settings.temperature,
				topP: overrides?.modelConfig?.topP ?? plugin.settings.topP,
			},
			retryConfig: {
				maxRetries: plugin.settings.maxRetries,
				initialBackoffDelay: plugin.settings.initialBackoffDelay,
			},
			features: {
				searchGrounding: plugin.settings.searchGrounding,
				streamingEnabled: plugin.settings.streamingEnabled,
			},
			...overrides,
		};
	}
}
