/**
 * Simplified factory for creating Gemini API clients
 *
 * Replaces the complex ApiFactory and ModelFactory with a single,
 * straightforward approach focused solely on Gemini.
 */

import { GeminiClient, GeminiClientConfig } from './gemini-client';
import { OllamaClient, OllamaClientConfig } from './ollama-client';
import { ModelApi } from './interfaces/model-api';
import { GeminiPrompts } from '../prompts';
import { RetryDecorator } from './retry-decorator';
import { getDefaultModelForRole } from '../models';
import type ObsidianGemini from '../main';

/**
 * Model use cases for the plugin
 */
export enum ModelUseCase {
	CHAT = 'chat',
	SUMMARY = 'summary',
	COMPLETIONS = 'completions',
	REWRITE = 'rewrite',
	SEARCH = 'search',
}

/**
 * Simple factory for creating Gemini API clients
 */
export class GeminiClientFactory {
	/**
	 * Create a GeminiClient from plugin settings
	 *
	 * @param plugin - Plugin instance with settings
	 * @param useCase - The use case for this model (determines which model to use)
	 * @param overrides - Optional config overrides (for per-session settings)
	 * @returns Configured GeminiClient instance
	 */
	static createFromPlugin(
		plugin: ObsidianGemini,
		useCase: ModelUseCase,
		overrides?: Partial<GeminiClientConfig> & Partial<OllamaClientConfig>
	): ModelApi {
		const settings = plugin.settings;
		const provider = settings.provider ?? 'gemini';

		const modelName = this.resolveModelName(plugin, useCase);

		const prompts = new GeminiPrompts(plugin);

		const retryConfig = {
			maxRetries: settings.maxRetries ?? 3,
			initialBackoffDelay: settings.initialBackoffDelay ?? 1000,
		};

		if (provider === 'ollama') {
			const config: OllamaClientConfig = {
				baseUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
				model: modelName,
				temperature: settings.temperature ?? 0.7,
				topP: settings.topP ?? 1,
				streamingEnabled: settings.streamingEnabled ?? true,
				...overrides,
			};
			const client = new OllamaClient(config, prompts, plugin);
			return new RetryDecorator(client, retryConfig, plugin.logger);
		}

		const config: GeminiClientConfig = {
			apiKey: plugin.apiKey,
			model: modelName,
			temperature: settings.temperature ?? 1.0,
			topP: settings.topP ?? 0.95,
			streamingEnabled: settings.streamingEnabled ?? true,
			...overrides,
		};
		const client = new GeminiClient(config, prompts, plugin);
		return new RetryDecorator(client, retryConfig, plugin.logger);
	}

	private static resolveModelName(plugin: ObsidianGemini, useCase: ModelUseCase): string {
		const settings = plugin.settings;
		const provider = settings.provider ?? 'gemini';
		switch (useCase) {
			case ModelUseCase.CHAT:
				return settings.chatModelName || getDefaultModelForRole('chat', provider);
			case ModelUseCase.SUMMARY:
				return settings.summaryModelName || getDefaultModelForRole('summary', provider);
			case ModelUseCase.COMPLETIONS:
				return settings.completionsModelName || getDefaultModelForRole('completions', provider);
			case ModelUseCase.REWRITE:
				return settings.chatModelName || getDefaultModelForRole('chat', provider);
			case ModelUseCase.SEARCH:
				return settings.chatModelName || getDefaultModelForRole('chat', provider);
			default:
				return getDefaultModelForRole('chat', provider);
		}
	}

	/**
	 * Create a GeminiClient with custom configuration
	 *
	 * @param config - Complete client configuration
	 * @param prompts - Optional prompts instance
	 * @param plugin - Optional plugin instance
	 * @returns Configured GeminiClient instance wrapped with retry logic
	 */
	static createCustom(config: GeminiClientConfig, prompts?: GeminiPrompts, plugin?: ObsidianGemini): ModelApi {
		const client = new GeminiClient(config, prompts, plugin);

		// Use retry config from plugin settings if available, otherwise use defaults
		const retryConfig = plugin
			? {
					maxRetries: plugin.settings.maxRetries ?? 3,
					initialBackoffDelay: plugin.settings.initialBackoffDelay ?? 1000,
				}
			: {
					maxRetries: 3,
					initialBackoffDelay: 1000,
				};

		return new RetryDecorator(client, retryConfig, plugin?.logger);
	}

	/**
	 * Create a chat model with optional session-specific overrides
	 *
	 * @param plugin - Plugin instance
	 * @param sessionConfig - Optional session-level config (model, temperature, topP)
	 * @returns Configured GeminiClient for chat
	 */
	static createChatModel(
		plugin: ObsidianGemini,
		sessionConfig?: { model?: string; temperature?: number; topP?: number }
	): ModelApi {
		const overrides: Partial<GeminiClientConfig> = {};

		if (sessionConfig) {
			// Session config takes precedence
			if (sessionConfig.temperature !== undefined) {
				overrides.temperature = sessionConfig.temperature;
			}
			if (sessionConfig.topP !== undefined) {
				overrides.topP = sessionConfig.topP;
			}
			// Note: model override is handled at request time via session.modelConfig
		}

		return this.createFromPlugin(plugin, ModelUseCase.CHAT, overrides);
	}

	/**
	 * Create a summary model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured GeminiClient for summaries
	 */
	static createSummaryModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.SUMMARY);
	}

	/**
	 * Create a completions model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured GeminiClient for completions
	 */
	static createCompletionsModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.COMPLETIONS);
	}

	/**
	 * Create a rewrite model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured GeminiClient for rewriting
	 */
	static createRewriteModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.REWRITE);
	}

	/**
	 * Create a search model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured GeminiClient for search operations
	 */
	static createSearchModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.SEARCH);
	}
}
