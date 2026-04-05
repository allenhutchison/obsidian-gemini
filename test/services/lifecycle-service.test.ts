jest.mock('obsidian', () => ({
	TFile: class TFile {},
	Notice: jest.fn(),
}));

jest.mock('../../src/services/tool-registrar', () => ({
	ToolRegistrar: jest.fn().mockImplementation(() => ({
		registerAll: jest.fn(),
		unregisterAll: jest.fn(),
	})),
}));
jest.mock('../../src/prompts', () => ({
	GeminiPrompts: jest.fn(),
	PromptManager: jest.fn().mockImplementation(() => ({
		createDefaultPrompts: jest.fn(),
		setupPromptCommands: jest.fn(),
	})),
}));
jest.mock('../../src/files', () => ({ ScribeFile: jest.fn() }));
jest.mock('../../src/services/model-manager', () => ({
	ModelManager: jest.fn().mockImplementation(() => ({
		initialize: jest.fn(),
		updateModels: jest.fn(),
	})),
}));
jest.mock('../../src/history/history', () => ({
	GeminiHistory: jest.fn().mockImplementation(() => ({
		setupHistoryCommands: jest.fn(),
		onLayoutReady: jest.fn(),
		onUnload: jest.fn(),
	})),
}));
jest.mock('../../src/agent/session-manager', () => ({ SessionManager: jest.fn() }));
jest.mock('../../src/agent/session-history', () => ({ SessionHistory: jest.fn() }));
jest.mock('../../src/services/agents-memory', () => ({ AgentsMemory: jest.fn() }));
jest.mock('../../src/services/example-prompts', () => ({ ExamplePromptsManager: jest.fn() }));
jest.mock('../../src/tools/tool-registry', () => ({ ToolRegistry: jest.fn() }));
jest.mock('../../src/tools/execution-engine', () => ({ ToolExecutionEngine: jest.fn() }));
jest.mock('../../src/services/skill-manager', () => ({
	SkillManager: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../src/mcp/mcp-manager', () => ({
	MCPManager: jest.fn().mockImplementation(() => ({
		connectAllEnabled: jest.fn(),
		disconnectAll: jest.fn(),
	})),
}));
jest.mock('../../src/services/context-manager', () => ({ ContextManager: jest.fn() }));
jest.mock('../../src/completions', () => ({
	GeminiCompletions: jest.fn().mockImplementation(() => ({
		setupCompletions: jest.fn(),
		setupCompletionsCommands: jest.fn(),
	})),
}));
jest.mock('../../src/summary', () => ({
	GeminiSummary: jest.fn().mockImplementation(() => ({
		setupSummarizationCommand: jest.fn(),
	})),
}));
jest.mock('../../src/services/vault-analyzer', () => ({
	VaultAnalyzer: jest.fn().mockImplementation(() => ({
		setupInitCommand: jest.fn(),
	})),
}));
jest.mock('../../src/services/deep-research', () => ({ DeepResearchService: jest.fn() }));
jest.mock('../../src/services/image-generation', () => ({
	ImageGeneration: jest.fn().mockImplementation(() => ({
		setupImageGenerationCommand: jest.fn(),
	})),
}));
jest.mock('../../src/services/selection-action-service', () => ({ SelectionActionService: jest.fn() }));
jest.mock('../../src/services/rag-indexing', () => ({ RagIndexingService: jest.fn() }));
jest.mock('../../src/services/folder-initializer', () => ({
	FolderInitializer: jest.fn().mockImplementation(() => ({
		initializeAll: jest.fn(),
	})),
}));
jest.mock('../../src/agent/agent-event-bus', () => ({
	AgentEventBus: jest.fn().mockImplementation(() => ({
		on: jest.fn().mockReturnValue(() => {}),
		emit: jest.fn().mockResolvedValue(undefined),
		removeAll: jest.fn(),
	})),
}));
jest.mock('../../src/subscribers/tool-execution-logger', () => ({
	ToolExecutionLogger: jest.fn().mockImplementation(() => ({
		destroy: jest.fn(),
	})),
}));
jest.mock('../../src/subscribers/context-tracking-subscriber', () => ({
	ContextTrackingSubscriber: jest.fn().mockImplementation(() => ({
		destroy: jest.fn(),
	})),
}));
jest.mock('../../src/subscribers/accessed-files-subscriber', () => ({
	AccessedFilesSubscriber: jest.fn().mockImplementation(() => ({
		destroy: jest.fn(),
	})),
}));
jest.mock('../../src/subscribers/project-activation-subscriber', () => ({
	ProjectActivationSubscriber: jest.fn().mockImplementation(() => ({
		destroy: jest.fn(),
	})),
}));
jest.mock('../../src/services/project-manager', () => ({
	ProjectManager: jest.fn().mockImplementation(() => ({
		initialize: jest.fn(),
		registerVaultEvents: jest.fn(),
		discoverProjects: jest.fn().mockReturnValue([]),
		destroy: jest.fn(),
	})),
}));
jest.mock('../../src/ui/update-notification-modal', () => ({ UpdateNotificationModal: jest.fn() }));

// Must be after all jest.mock calls
import { LifecycleService } from '../../src/services/lifecycle-service';
import { ToolRegistrar } from '../../src/services/tool-registrar';
import { ProjectActivationSubscriber } from '../../src/subscribers/project-activation-subscriber';

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: { on: jest.fn() },
			workspace: { layoutReady: false },
		},
		settings: {
			modelDiscovery: { enabled: false, autoUpdateInterval: 24, lastUpdate: 0 },
			mcpEnabled: false,
			ragIndexing: { enabled: false },
			logToolExecution: true,
			chatHistory: true,
			lastSeenVersion: '1.0.0',
		},
		logger: {
			log: jest.fn(),
			debug: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
		},
		isGeminiInitialized: false,
		manifest: { version: '1.0.0' },
		saveData: jest.fn(),
		registerEvent: jest.fn(),
		...overrides,
	};
}

describe('LifecycleService', () => {
	let lifecycle: LifecycleService;
	let mockPlugin: any;

	beforeEach(() => {
		jest.clearAllMocks();
		mockPlugin = createMockPlugin();
		lifecycle = new LifecycleService(mockPlugin);
	});

	describe('setup', () => {
		it('should create all core services', async () => {
			await lifecycle.setup();

			expect(mockPlugin.prompts).toBeDefined();
			expect(mockPlugin.promptManager).toBeDefined();
			expect(mockPlugin.gfile).toBeDefined();
			expect(mockPlugin.modelManager).toBeDefined();
			expect(mockPlugin.toolRegistry).toBeDefined();
			expect(mockPlugin.toolExecutionEngine).toBeDefined();
			expect(mockPlugin.skillManager).toBeDefined();
			expect(mockPlugin.contextManager).toBeDefined();
			expect(mockPlugin.completions).toBeDefined();
			expect(mockPlugin.summarizer).toBeDefined();
			expect(mockPlugin.selectionActionService).toBeDefined();
		});

		it('should create persistent services on first setup', async () => {
			await lifecycle.setup();

			expect(mockPlugin.history).toBeDefined();
			expect(mockPlugin.sessionManager).toBeDefined();
			expect(mockPlugin.sessionHistory).toBeDefined();
			expect(mockPlugin.agentsMemory).toBeDefined();
			expect(mockPlugin.examplePrompts).toBeDefined();
		});

		it('should not recreate persistent services on re-setup', async () => {
			await lifecycle.setup();

			const firstHistory = mockPlugin.history;
			const firstSessionManager = mockPlugin.sessionManager;

			// Simulate re-initialization
			mockPlugin.isGeminiInitialized = true;
			await lifecycle.setup();

			expect(mockPlugin.history).toBe(firstHistory);
			expect(mockPlugin.sessionManager).toBe(firstSessionManager);
		});

		it('should call teardown before re-setup when already initialized', async () => {
			await lifecycle.setup();
			mockPlugin.isGeminiInitialized = true;

			// Set up MCP manager from first setup
			const mockDisconnectAll = jest.fn();
			mockPlugin.mcpManager = { disconnectAll: mockDisconnectAll };

			await lifecycle.setup();

			expect(mockDisconnectAll).toHaveBeenCalled();
		});

		it('should create ToolExecutionLogger when logToolExecution is enabled', async () => {
			mockPlugin.settings.logToolExecution = true;
			await lifecycle.setup();

			expect(mockPlugin.toolExecutionLogger).toBeDefined();
		});

		it('should not create ToolExecutionLogger when logToolExecution is disabled', async () => {
			mockPlugin.settings.logToolExecution = false;
			await lifecycle.setup();

			expect(mockPlugin.toolExecutionLogger).toBeFalsy();
		});

		it('should register tools via ToolRegistrar', async () => {
			await lifecycle.setup();

			// Access the ToolRegistrar instance created in the LifecycleService constructor
			const registrarInstance = (ToolRegistrar as unknown as jest.Mock).mock.results[0].value;
			expect(registrarInstance.registerAll).toHaveBeenCalledWith(mockPlugin.toolRegistry, mockPlugin.logger);
		});

		it('should create ProjectActivationSubscriber with plugin', async () => {
			await lifecycle.setup();

			expect(ProjectActivationSubscriber).toHaveBeenCalledTimes(1);
			expect(ProjectActivationSubscriber).toHaveBeenCalledWith(mockPlugin);
		});
	});

	describe('teardown', () => {
		it('should null out completions and summarizer', async () => {
			await lifecycle.setup();
			expect(mockPlugin.completions).toBeDefined();
			expect(mockPlugin.summarizer).toBeDefined();

			await lifecycle.teardown();
			expect(mockPlugin.completions).toBeNull();
			expect(mockPlugin.summarizer).toBeNull();
		});

		it('should disconnect MCP servers', async () => {
			const mockDisconnectAll = jest.fn();
			mockPlugin.mcpManager = { disconnectAll: mockDisconnectAll };

			await lifecycle.teardown();

			expect(mockDisconnectAll).toHaveBeenCalled();
			expect(mockPlugin.mcpManager).toBeNull();
		});
	});

	describe('onLayoutReady', () => {
		it('should set up prompts and history', async () => {
			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(mockPlugin.promptManager.createDefaultPrompts).toHaveBeenCalled();
			expect(mockPlugin.promptManager.setupPromptCommands).toHaveBeenCalled();
			expect(mockPlugin.history.onLayoutReady).toHaveBeenCalled();
		});
	});

	describe('onUnload', () => {
		it('should clean up MCP servers', async () => {
			const mockDisconnectAll = jest.fn().mockResolvedValue(undefined);
			mockPlugin.mcpManager = { disconnectAll: mockDisconnectAll };

			await lifecycle.onUnload();

			expect(mockDisconnectAll).toHaveBeenCalled();
			expect(mockPlugin.mcpManager).toBeNull();
		});

		it('should call destroy on ToolExecutionLogger', async () => {
			const mockDestroy = jest.fn();
			mockPlugin.toolExecutionLogger = { destroy: mockDestroy };

			await lifecycle.onUnload();

			expect(mockDestroy).toHaveBeenCalled();
			expect(mockPlugin.toolExecutionLogger).toBeNull();
		});

		it('should call destroy on ProjectActivationSubscriber', async () => {
			await lifecycle.setup();
			const instance = (ProjectActivationSubscriber as unknown as jest.Mock).mock.results[0].value;

			// Clear services that would interfere with onUnload
			mockPlugin.mcpManager = null;
			mockPlugin.ragIndexing = null;

			await lifecycle.onUnload();

			expect(instance.destroy).toHaveBeenCalled();
		});

		it('should handle missing services gracefully', async () => {
			mockPlugin.history = null;
			mockPlugin.mcpManager = null;
			mockPlugin.ragIndexing = null;

			await expect(lifecycle.onUnload()).resolves.not.toThrow();
		});
	});
});
