/**
 * Factory for creating model API clients.
 *
 * Resolves the provider *per feature* (settings redesign; successor to #704's
 * per-use-case routing) — chat may run on Ollama while summaries run on
 * Gemini — then instantiates the matching client and wraps it in a
 * RetryDecorator. This is the single creation entry point for the agent and
 * all role-specific use cases.
 */

import { GeminiClient } from './providers/gemini/client';
import type { GeminiClientConfig } from './providers/gemini/config';
import { OllamaClient } from './providers/ollama/client';
import type { OllamaClientConfig } from './providers/ollama/config';
import { OpenAIClient } from './providers/openai/client';
import { DEFAULT_OPENAI_BASE_URL, type OpenAIClientConfig } from './providers/openai/config';
import { AnthropicClient } from './providers/anthropic/client';
import type { AnthropicClientConfig } from './providers/anthropic/config';
import { ModelApi } from './interfaces/model-api';
import { GeminiPrompts } from '../prompts';
import { RetryDecorator } from './retry-decorator';
import { resolveFeatureModel } from '../models';
import type { ObsidianGemini } from '../types/plugin';
import { ModelUseCase } from './model-use-case';
import { featureProvider, featureRoute } from './feature-routing';
import { FeatureUnavailableError } from './feature-errors';
import type { FeatureId } from '../types/features';

/**
 * Which routable feature each model-client use case is billed to.
 *
 * Mapped explicitly rather than reusing the enum's string values: any overlap
 * between a `ModelUseCase` name and a `FeatureId` name is coincidence, not
 * design. A use-case name that matches a feature must NOT route to that
 * feature unless that is really intended — e.g. a hypothetical `SEARCH`
 * use case is a thinking-level tier for query-understanding calls on the chat
 * path, not the `webSearch` feature, which gates the Google Search /
 * URL-context tools. Routing on the name collision would send a local-only
 * install's chat calls looking for a provider that serves web search and find
 * none. Decide each row by what the call site does, not what the enum arm is
 * called.
 */
const FEATURE_FOR_USE_CASE: Record<ModelUseCase, FeatureId> = {
	[ModelUseCase.CHAT]: 'chat',
	[ModelUseCase.SUMMARY]: 'summary',
	[ModelUseCase.COMPLETIONS]: 'completions',
	[ModelUseCase.REWRITE]: 'rewrite',
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
	 * @throws {FeatureUnavailableError} when the feature this use case bills to
	 *   is routed to `'none'` or to a provider that can't serve it. There is no
	 *   silent fallback to another provider — the caller surfaces this as a
	 *   Notice.
	 */
	static createFromPlugin(
		plugin: ObsidianGemini,
		useCase: ModelUseCase,
		overrides?: Partial<GeminiClientConfig> &
			Partial<OllamaClientConfig> &
			Partial<OpenAIClientConfig> &
			Partial<AnthropicClientConfig>
	): ModelApi {
		const settings = plugin.settings;
		const feature = FEATURE_FOR_USE_CASE[useCase];
		const provider = featureProvider(settings, feature);
		if (!provider) {
			const route = featureRoute(settings, feature);
			const reason = route.provider === 'none' ? 'unconfigured' : 'unsupported';
			throw new FeatureUnavailableError(feature, reason);
		}

		const modelName = resolveFeatureModel(settings, feature);

		const prompts = new GeminiPrompts(plugin);

		if (provider === 'ollama') {
			const config: OllamaClientConfig = {
				baseUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
				model: modelName,
				...overrides,
			};
			const client = new OllamaClient(config, prompts, plugin);
			return new RetryDecorator(client, plugin.logger);
		}

		if (provider === 'openai') {
			const config: OpenAIClientConfig = {
				apiKey: plugin.openaiApiKey,
				baseUrl: settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
				model: modelName,
				...overrides,
			};
			const client = new OpenAIClient(config, prompts, plugin);
			return new RetryDecorator(client, plugin.logger);
		}

		if (provider === 'anthropic') {
			const config: AnthropicClientConfig = {
				apiKey: plugin.anthropicApiKey,
				model: modelName,
				...overrides,
			};
			const client = new AnthropicClient(config, prompts, plugin);
			return new RetryDecorator(client, plugin.logger);
		}

		const config: GeminiClientConfig = {
			apiKey: plugin.apiKey,
			model: modelName,
			useCase,
			...overrides,
		};
		const client = new GeminiClient(config, prompts, plugin);
		return new RetryDecorator(client, plugin.logger);
	}

	/**
	 * Create a chat model.
	 *
	 * @param plugin - Plugin instance
	 * @param _legacySessionConfig - Deprecated: Unused. Kept only so
	 *   `agent-factory.ts` (`createChatModel(plugin, session.modelConfig)`)
	 *   keeps compiling until the settings redesign's agent-view work package
	 *   drops the argument at that call site; the model override it used to
	 *   carry is applied at request time via `session.modelConfig`, and its
	 *   temperature/topP fields no longer exist.
	 * @returns Configured ModelApi client for chat
	 */
	static createChatModel(plugin: ObsidianGemini, _legacySessionConfig?: unknown): ModelApi {
		return this.createFromPlugin(plugin, ModelUseCase.CHAT);
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
}
