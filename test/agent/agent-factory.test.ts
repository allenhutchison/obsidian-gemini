import { AgentFactory } from '../../src/agent/agent-factory';
import { ModelClientFactory } from '../../src/api';
import type { ChatSession, SessionModelConfig } from '../../src/types/agent';

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
		context: { contextFiles: [], requireConfirmation: [] },
		created: new Date(),
		lastActive: new Date(),
		historyPath: 'gemini-scribe/Agent-Sessions/Test Session.md',
		...overrides,
	};
}

describe('AgentFactory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('createAgentModel', () => {
		it('passes no provider for a session that only overrides the model (the model applies per request)', () => {
			const plugin = createMockPlugin();
			const modelConfig: SessionModelConfig = {
				model: 'gemini-2.5-pro',
			};
			const session = createMockSession({ modelConfig });

			AgentFactory.createAgentModel(plugin, session);

			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, undefined);
		});

		it('passes no provider when the session has no modelConfig', () => {
			const plugin = createMockPlugin();
			const session = createMockSession({ modelConfig: undefined });

			AgentFactory.createAgentModel(plugin, session);

			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, undefined);
		});

		it("passes the session's pinned provider (#1679)", () => {
			const plugin = createMockPlugin();
			const session = createMockSession({ modelConfig: { provider: 'anthropic' } });

			AgentFactory.createAgentModel(plugin, session);

			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, 'anthropic');
		});

		it("uses an explicit provider over the session's live one (#1679)", () => {
			const plugin = createMockPlugin();
			const session = createMockSession({ modelConfig: { provider: 'anthropic' } });

			AgentFactory.createAgentModel(plugin, session, 'ollama');

			expect(ModelClientFactory.createChatModel).toHaveBeenCalledWith(plugin, 'ollama');
		});

		it('should return the ModelApi instance from the factory', () => {
			const mockApi = { generateModelResponse: vi.fn() };
			vi.mocked(ModelClientFactory.createChatModel).mockReturnValue(mockApi);

			const plugin = createMockPlugin();
			const session = createMockSession();

			const result = AgentFactory.createAgentModel(plugin, session);

			expect(result).toBe(mockApi);
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
