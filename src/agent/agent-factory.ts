import type { ObsidianGemini } from '../types/plugin';
import { ModelApi } from '../api/interfaces/model-api';
import { ModelClientFactory } from '../api';
import { ChatSession } from '../types/agent';

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
	 * @returns Configured ModelApi instance
	 */
	static createAgentModel(plugin: ObsidianGemini, _session: ChatSession): ModelApi {
		return ModelClientFactory.createChatModel(plugin);
	}
}
