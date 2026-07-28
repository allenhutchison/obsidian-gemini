/**
 * Factory for creating model API clients.
 *
 * Resolves the provider *per use case* (#704) — chat may run on Ollama while
 * summaries run on Gemini — then instantiates the matching client and wraps it
 * in a RetryDecorator. This is the single creation entry point for the agent
 * and all role-specific use cases.
 */

import { GeminiClient } from './providers/gemini/client';
import type { GeminiClientConfig } from './providers/gemini/config';
import { OllamaClient } from './providers/ollama/client';
import type { OllamaClientConfig } from './providers/ollama/config';
import { ModelApi } from './interfaces/model-api';
import { GeminiPrompts } from '../prompts';
import { RetryDecorator } from './retry-decorator';
import { getDefaultModelForRole, getOllamaModelForRole } from '../models';
import type { ObsidianGemini } from '../types/plugin';
import { ModelUseCase } from './model-use-case';
import { resolveProviderOrDefault } from './provider-routing';
import type { ProviderUseCase } from './providers/registry';

/**
 * Which routable use case each model-client use case is billed to.
 *
 * Mapped explicitly rather than reusing the enum's string values: they overlap
 * by coincidence, not by design. `ModelUseCase.SEARCH` is a *thinking-level
 * tier* for query-understanding calls on the chat path — not the `webSearch`
 * capability, which gates the Google Search / URL-context tools. Routing it to
 * `webSearch` would send a local-only install's chat calls looking for a
 * provider that serves web search and find none.
 */
const ROUTING_USE_CASE: Record<ModelUseCase, ProviderUseCase> = {
	[ModelUseCase.CHAT]: 'chat',
	[ModelUseCase.SUMMARY]: 'summary',
	[ModelUseCase.COMPLETIONS]: 'completions',
	[ModelUseCase.REWRITE]: 'rewrite',
	[ModelUseCase.SEARCH]: 'chat',
};

// Re-exported so existing `import { ModelUseCase } from '.../api/factory'` call
// sites keep working after the enum moved to its own (import-free) module.
export { ModelUseCase } from './model-use-case';

/**
 * Factory for creating provider-appropriate ModelApi clients.
 */
export class ModelClientFactory {
	/**
	 * Create a ModelApi client from plugin settings
	 *
	 * @param plugin - Plugin instance with settings
	 * @param useCase - The use case for this model (determines which model to use)
	 * @param overrides - Optional config overrides (for per-session settings)
	 * @returns Configured ModelApi instance wrapped with retry logic
	 */
	static createFromPlugin(
		plugin: ObsidianGemini,
		useCase: ModelUseCase,
		overrides?: Partial<GeminiClientConfig> & Partial<OllamaClientConfig>
	): ModelApi {
		const settings = plugin.settings;
		// Every ModelUseCase maps to a use case that all providers support, so the
		// `null` branch of resolveProvider is unreachable here — capability-gated
		// features (RAG, image generation) never reach the client factory.
		const provider = resolveProviderOrDefault(settings, ROUTING_USE_CASE[useCase]);

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
			useCase,
			temperature: settings.temperature ?? 1.0,
			topP: settings.topP ?? 0.95,
			streamingEnabled: settings.streamingEnabled ?? true,
			useInteractionsApi: settings.useInteractionsApi ?? false,
			...overrides,
		};
		const client = new GeminiClient(config, prompts, plugin);
		return new RetryDecorator(client, retryConfig, plugin.logger);
	}

	/** The model role a use case reads its configured model from. */
	private static roleForUseCase(useCase: ModelUseCase): 'chat' | 'summary' | 'completions' {
		switch (useCase) {
			case ModelUseCase.SUMMARY:
				return 'summary';
			case ModelUseCase.COMPLETIONS:
				return 'completions';
			// Rewrite and search deliberately reuse the chat model rather than
			// carrying their own setting.
			default:
				return 'chat';
		}
	}

	private static resolveModelName(plugin: ObsidianGemini, useCase: ModelUseCase): string {
		const settings = plugin.settings;
		const provider = resolveProviderOrDefault(settings, ROUTING_USE_CASE[useCase]);
		const role = this.roleForUseCase(useCase);

		if (provider === 'ollama') {
			// Ollama keeps one model resident, so the per-use-case fields default
			// to inheriting the chat model rather than forcing a swap (#1077).
			return getOllamaModelForRole(settings, role);
		}

		const configured =
			role === 'summary'
				? settings.summaryModelName
				: role === 'completions'
					? settings.completionsModelName
					: settings.chatModelName;
		return configured || getDefaultModelForRole(role, provider);
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
	 * @returns Configured ModelApi client for chat
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
	 * @returns Configured ModelApi client for summaries
	 */
	static createSummaryModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.SUMMARY);
	}

	/**
	 * Create a completions model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured ModelApi client for completions
	 */
	static createCompletionsModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.COMPLETIONS);
	}

	/**
	 * Create a rewrite model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured ModelApi client for rewriting
	 */
	static createRewriteModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.REWRITE);
	}

	/**
	 * Create a search model
	 *
	 * @param plugin - Plugin instance
	 * @returns Configured ModelApi client for search operations
	 */
	static createSearchModel(plugin: ObsidianGemini): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.SEARCH);
	}
}
