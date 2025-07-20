import ObsidianGemini from '../main';
import { ModelApi } from './interfaces/model-api';
import { ApiFactory } from './api-factory';
import { ApiConfig } from './config/model-config';
import { SessionModelConfig } from '../types/agent';

/**
 * Model types for different use cases
 */
export enum ModelType {
	CHAT = 'chat',
	SUMMARY = 'summary',
	COMPLETIONS = 'completions',
	REWRITE = 'rewrite',
}

/**
 * Factory for creating model instances for specific use cases
 * This provides a higher-level abstraction over ApiFactory
 */
export class ModelFactory {
	/**
	 * Create a model API for a specific use case
	 *
	 * @param plugin The plugin instance
	 * @param type The model type/use case
	 * @param sessionConfig Optional session-specific configuration
	 * @returns Configured ModelApi instance
	 */
	static createModel(
		plugin: InstanceType<typeof ObsidianGemini>,
		type: ModelType,
		sessionConfig?: SessionModelConfig
	): ModelApi {
		// Get the appropriate model name based on type
		const modelName = this.getModelNameForType(plugin, type);
		
		// Create config with type-specific model and session overrides
		const config = ApiFactory.createConfigFromPlugin(plugin, {
			modelConfig: {
				apiKey: plugin.settings.apiKey,
				model: sessionConfig?.model || modelName,
				temperature: sessionConfig?.temperature ?? plugin.settings.temperature,
				topP: sessionConfig?.topP ?? plugin.settings.topP,
			},
		});

		// Create and return the API instance
		return ApiFactory.createApiWithConfig(config, plugin);
	}

	/**
	 * Create a chat model with optional session configuration
	 */
	static createChatModel(
		plugin: InstanceType<typeof ObsidianGemini>,
		sessionConfig?: SessionModelConfig
	): ModelApi {
		return this.createModel(plugin, ModelType.CHAT, sessionConfig);
	}

	/**
	 * Create a summary model
	 */
	static createSummaryModel(plugin: InstanceType<typeof ObsidianGemini>): ModelApi {
		return this.createModel(plugin, ModelType.SUMMARY);
	}

	/**
	 * Create a completions model
	 */
	static createCompletionsModel(plugin: InstanceType<typeof ObsidianGemini>): ModelApi {
		return this.createModel(plugin, ModelType.COMPLETIONS);
	}

	/**
	 * Create a rewrite model
	 */
	static createRewriteModel(plugin: InstanceType<typeof ObsidianGemini>): ModelApi {
		// Rewrite typically uses the summary model
		return this.createModel(plugin, ModelType.SUMMARY);
	}

	/**
	 * Get the model name for a specific type from settings
	 */
	private static getModelNameForType(
		plugin: InstanceType<typeof ObsidianGemini>,
		type: ModelType
	): string {
		switch (type) {
			case ModelType.CHAT:
				return plugin.settings.chatModelName;
			case ModelType.SUMMARY:
			case ModelType.REWRITE:
				return plugin.settings.summaryModelName;
			case ModelType.COMPLETIONS:
				return plugin.settings.completionsModelName;
			default:
				return plugin.settings.chatModelName;
		}
	}

	/**
	 * Create a model with custom configuration
	 * Useful for testing or special use cases
	 */
	static createCustomModel(config: ApiConfig): ModelApi {
		return ApiFactory.createApiWithConfig(config);
	}
}