import ObsidianGemini from '../main';
import { ModelApi } from '../api/interfaces/model-api';
import { GeminiClientFactory } from '../api/simple-factory';
import { SessionManager } from './session-manager';
import { AgentView } from '../ui/agent-view/agent-view';
import { ToolExecutionEngine } from '../tools/execution-engine';
import { ToolRegistry } from '../tools/tool-registry';
import { ChatSession, SessionModelConfig } from '../types/agent';
import { App } from 'obsidian';

/**
 * Configuration for creating an agent
 */
export interface AgentConfig {
	session: ChatSession;
	toolRegistry: ToolRegistry;
	executionEngine: ToolExecutionEngine;
	modelConfig?: SessionModelConfig;
}

/**
 * Factory for creating agent-related components
 * Centralizes the creation and configuration of agent mode
 */
export class AgentFactory {
	/**
	 * Create a complete agent setup
	 *
	 * @param plugin The plugin instance
	 * @param app The Obsidian app instance
	 * @returns Agent components
	 */
	static createAgent(
		plugin: InstanceType<typeof ObsidianGemini>,
		app: App
	): {
		sessionManager: SessionManager;
		toolRegistry: ToolRegistry;
		executionEngine: ToolExecutionEngine;
	} {
		// Create session manager
		const sessionManager = new SessionManager(plugin);

		// Create tool registry
		const toolRegistry = new ToolRegistry(plugin);

		// Create execution engine
		const executionEngine = new ToolExecutionEngine(plugin, toolRegistry);

		return {
			sessionManager,
			toolRegistry,
			executionEngine,
		};
	}

	/**
	 * Create an agent view
	 *
	 * @param leaf The workspace leaf
	 * @param plugin The plugin instance
	 * @param sessionManager The session manager
	 * @param executionEngine The tool execution engine
	 * @returns Configured AgentView instance
	 */
	static createAgentView(
		leaf: any,
		plugin: InstanceType<typeof ObsidianGemini>,
		sessionManager: SessionManager,
		executionEngine: ToolExecutionEngine
	): AgentView {
		return new AgentView(leaf, plugin);
	}

	/**
	 * Create a model API for agent mode with session configuration
	 *
	 * @param plugin The plugin instance
	 * @param session The current chat session
	 * @returns Configured ModelApi instance
	 */
	static createAgentModel(plugin: InstanceType<typeof ObsidianGemini>, session: ChatSession): ModelApi {
		// Use session's model configuration if available
		return GeminiClientFactory.createChatModel(plugin, session.modelConfig);
	}

	/**
	 * Create a model API for a specific agent task
	 *
	 * @param plugin The plugin instance
	 * @param config Agent configuration
	 * @param taskType Optional task type for specialized models
	 * @returns Configured ModelApi instance
	 */
	static createAgentTaskModel(
		plugin: InstanceType<typeof ObsidianGemini>,
		config: AgentConfig,
		taskType?: 'summarize' | 'research' | 'code'
	): ModelApi {
		// For now, use the session's model config for all tasks
		// In the future, we might want different models for different tasks
		return this.createAgentModel(plugin, config.session);
	}

	/**
	 * Initialize agent components for the plugin
	 *
	 * @param plugin The plugin instance
	 */
	static async initializeAgent(plugin: InstanceType<typeof ObsidianGemini>): Promise<void> {
		// This would be called during plugin load to set up agent infrastructure
		const { sessionManager, toolRegistry, executionEngine } = this.createAgent(plugin, plugin.app);

		// Store references in the plugin
		(plugin as any).sessionManager = sessionManager;
		(plugin as any).toolRegistry = toolRegistry;
		(plugin as any).executionEngine = executionEngine;

		// Session manager doesn't need initialization
	}
}
