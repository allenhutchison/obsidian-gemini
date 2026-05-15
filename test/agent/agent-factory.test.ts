import { AgentFactory } from '../../src/agent/agent-factory';
import { SessionManager } from '../../src/agent/session-manager';
import { ToolRegistry } from '../../src/tools/tool-registry';
import { ToolExecutionEngine } from '../../src/tools/execution-engine';
import { ModelClientFactory } from '../../src/api';
import type { ChatSession, SessionModelConfig } from '../../src/types/agent';

// Mock dependencies at module level
vi.mock('../../src/agent/session-manager');
vi.mock('../../src/tools/tool-registry');
vi.mock('../../src/tools/execution-engine');
vi.mock('../../src/api', () => ({
	ModelClientFactory: {
		createChatModel: vi.fn().mockReturnValue({ generateModelResponse: vi.fn() }),
		createFromPlugin: vi.fn().mockReturnValue({ generateModelResponse: vi.fn() }),
	},
}));

function createMockPlugin(overrides: any = {}): any {
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn(),
			},
			metadataCache: {
				getFileCache: vi.fn(),
			},
		},
		settings: {
			chatModelName: 'gemini-2.0-flash',
			temperature: 1.0,
			topP: 0.95,
			...overrides.settings,
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn().mockReturnThis(),
		},
		manifest: { version: '4.0.0' },
		...overrides,
	};
}

function createMockSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		id: 'test-session-id',
		type: 'agent-session' as any,
		title: 'Test Session',
		context: { contextFiles: [], requireConfirmation: [] } as any,
		created: new Date(),
		lastActive: new Date(),
		historyPath: 'gemini-scribe/Agent-Sessions/Test Session.md',
		...overrides,
	} as ChatSession;
}

describe('AgentFactory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('createAgent', () => {
		it('should return sessionManager, toolRegistry, and executionEngine', () => {
			const plugin = createMockPlugin();

			const result = AgentFactory.createAgent(plugin, plugin.app);

			expect(result).toHaveProperty('sessionManager');
			expect(result).toHaveProperty('toolRegistry');
			expect(result).toHaveProperty('executionEngine');
		});

		it('should create a SessionManager with the plugin', () => {
			const plugin = createMockPlugin();

			AgentFactory.createAgent(plugin, plugin.app);

			expect(SessionManager).toHaveBeenCalledWith(plugin);
		});

		it('should create a ToolRegistry with the plugin', () => {
			const plugin = createMockPlugin();

			AgentFactory.createAgent(plugin, plugin.app);

			expect(ToolRegistry).toHaveBeenCalledWith(plugin);
		});

		it('should create a ToolExecutionEngine with the plugin and toolRegistry', () => {
			const plugin = createMockPlugin();

			AgentFactory.createAgent(plugin, plugin.app);

			// ToolExecutionEngine receives the plugin and the ToolRegistry instance
			expect(ToolExecutionEngine).toHaveBeenCalledWith(plugin, expect.any(Object));
		});
	});

	describe('createAgentModel', () => {
		it('should delegate to ModelClientFactory.createChatModel with session model config', () => {
			const plugin = createMockPlugin();
			const modelConfig: SessionModelConfig = {
				model: 'gemini-2.5-pro',
				temperature: 0.5,
				topP: 0.8,
			};
			const session = createMockSession({ modelConfig });

			AgentFactory.createAgentModel(plugin, session);

			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, modelConfig);
		});

		it('should pass undefined modelConfig when session has none', () => {
			const plugin = createMockPlugin();
			const session = createMockSession({ modelConfig: undefined });

			AgentFactory.createAgentModel(plugin, session);

			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, undefined);
		});

		it('should return the ModelApi instance from the factory', () => {
			const mockApi = { generateModelResponse: vi.fn() };
			vi.mocked(ModelClientFactory.createChatModel).mockReturnValue(mockApi as any);

			const plugin = createMockPlugin();
			const session = createMockSession();

			const result = AgentFactory.createAgentModel(plugin, session);

			expect(result).toBe(mockApi);
		});
	});

	describe('createAgentTaskModel', () => {
		it('should delegate to createAgentModel with the session from config', () => {
			const plugin = createMockPlugin();
			const modelConfig: SessionModelConfig = { model: 'gemini-2.5-pro' };
			const session = createMockSession({ modelConfig });
			const config = {
				session,
				toolRegistry: {} as any,
				executionEngine: {} as any,
				modelConfig,
			};

			AgentFactory.createAgentTaskModel(plugin, config);

			// Should ultimately call createChatModel with the session's modelConfig
			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, modelConfig);
		});

		it('should ignore the taskType parameter (currently unused)', () => {
			const plugin = createMockPlugin();
			const session = createMockSession();
			const config = {
				session,
				toolRegistry: {} as any,
				executionEngine: {} as any,
			};

			// All task types should produce the same result
			AgentFactory.createAgentTaskModel(plugin, config, 'summarize');
			AgentFactory.createAgentTaskModel(plugin, config, 'research');
			AgentFactory.createAgentTaskModel(plugin, config, 'code');

			// All three calls delegate to createChatModel with the same session config
			expect(ModelClientFactory.createChatModel).toHaveBeenCalledTimes(3);
		});
	});

	describe('initializeAgent', () => {
		it('should store sessionManager, toolRegistry, and executionEngine on the plugin', async () => {
			const plugin = createMockPlugin();

			await AgentFactory.initializeAgent(plugin);

			expect((plugin as any).sessionManager).toBeDefined();
			expect((plugin as any).toolRegistry).toBeDefined();
			expect((plugin as any).executionEngine).toBeDefined();
		});
	});

	describe('error handling', () => {
		it('should propagate errors when ModelClientFactory.createChatModel throws', () => {
			vi.mocked(ModelClientFactory.createChatModel).mockImplementation(() => {
				throw new Error('API key missing');
			});

			const plugin = createMockPlugin();
			const session = createMockSession();

			expect(() => AgentFactory.createAgentModel(plugin, session)).toThrow('API key missing');
		});
	});
});
