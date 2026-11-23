import type { ObsidianGemini } from '../types/plugin';
import { ModelApi } from '../api/interfaces/model-api';
import { ModelClientFactory } from '../api';
import { ChatSession } from '../types/agent';
import type { ModelProvider } from '../api/providers/registry';

/**
 * Factory for creating agent-related components
 * Centralizes the creation and configuration of agent mode
 */
export class AgentFactory {
	/**
	 * Create a model API for agent mode.
	 *
	 * @param plugin The plugin instance
	 * @param _session The current chat session. Unused: `session.modelConfig`
	 *   no longer carries anything the client factory needs — the model
	 *   override it used to carry (and, before the settings redesign,
	 *   temperature/topP) is applied at request time by the caller (see
	 *   `agent-view-send.ts` / `agent-view-tool-followup.ts`). Kept as a
	 *   parameter so `AgentLoop`'s default `createModelApi` factory
	 *   (`agent-loop.ts`), which always passes the session, keeps compiling.
	 * @param provider The provider to build the client for. Defaults to the
	 *   session's override; a turn passes the provider from the same config
	 *   snapshot it resolved its model from, so a settings save during the
	 *   turn's setup can't pair one provider's client with another's model id.
	 * @returns Configured ModelApi instance
	 */
	static createAgentModel(
		plugin: ObsidianGemini,
		session: ChatSession,
		provider: ModelProvider | undefined = session.modelConfig?.provider
	): ModelApi {
		return ModelClientFactory.createChatModel(plugin, provider);
	}
}
