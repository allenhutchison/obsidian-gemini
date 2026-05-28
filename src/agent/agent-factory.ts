import type ObsidianGemini from '../main';
import { ModelApi } from '../api/interfaces/model-api';
import { ModelClientFactory } from '../api';
import { ChatSession } from '../types/agent';

/**
 * Factory for creating agent-related components
 * Centralizes the creation and configuration of agent mode
 */
export class AgentFactory {
	/**
	 * Create a model API for agent mode with session configuration
	 *
	 * @param plugin The plugin instance
	 * @param session The current chat session
	 * @returns Configured ModelApi instance
	 */
	static createAgentModel(plugin: ObsidianGemini, session: ChatSession): ModelApi {
		return ModelClientFactory.createChatModel(plugin, session.modelConfig);
	}
}
