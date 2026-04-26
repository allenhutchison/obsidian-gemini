import type { Mock } from 'vitest';

vi.mock('obsidian', () => ({
	TFile: class TFile {},
	Notice: vi.fn(),
	normalizePath: (p: string) => p,
}));

vi.mock('../../src/services/tool-registrar', () => ({
	ToolRegistrar: vi.fn().mockImplementation(function () {
		return {
			registerAll: vi.fn(),
			unregisterAll: vi.fn(),
		};
	}),
}));
vi.mock('../../src/prompts', () => ({
	GeminiPrompts: vi.fn(),
	PromptManager: vi.fn().mockImplementation(function () {
		return {
			createDefaultPrompts: vi.fn(),
			setupPromptCommands: vi.fn(),
		};
	}),
}));
vi.mock('../../src/files', () => ({ ScribeFile: vi.fn() }));
vi.mock('../../src/services/model-manager', () => ({
	ModelManager: vi.fn().mockImplementation(function () {
		return {
			initialize: vi.fn(),
			updateModels: vi.fn(),
		};
	}),
}));
vi.mock('../../src/history/history', () => ({
	GeminiHistory: vi.fn().mockImplementation(function () {
		return {
			setupHistoryCommands: vi.fn(),
			onLayoutReady: vi.fn(),
			onUnload: vi.fn(),
		};
	}),
}));
vi.mock('../../src/agent/session-manager', () => ({ SessionManager: vi.fn() }));
vi.mock('../../src/agent/session-history', () => ({ SessionHistory: vi.fn() }));
vi.mock('../../src/services/agents-memory', () => ({ AgentsMemory: vi.fn() }));
vi.mock('../../src/services/example-prompts', () => ({ ExamplePromptsManager: vi.fn() }));
vi.mock('../../src/tools/tool-registry', () => ({ ToolRegistry: vi.fn() }));
vi.mock('../../src/tools/execution-engine', () => ({ ToolExecutionEngine: vi.fn() }));
vi.mock('../../src/services/skill-manager', () => ({
	SkillManager: vi.fn().mockImplementation(function () {
		return {};
	}),
}));
vi.mock('../../src/mcp/mcp-manager', () => ({
	MCPManager: vi.fn().mockImplementation(function () {
		return {
			connectAllEnabled: vi.fn(),
			disconnectAll: vi.fn(),
		};
	}),
}));
vi.mock('../../src/services/context-manager', () => ({ ContextManager: vi.fn() }));
vi.mock('../../src/completions', () => ({
	GeminiCompletions: vi.fn().mockImplementation(function () {
		return {
			setupCompletions: vi.fn(),
			setupCompletionsCommands: vi.fn(),
		};
	}),
}));
vi.mock('../../src/summary', () => ({
	GeminiSummary: vi.fn().mockImplementation(function () {
		return {
			setupSummarizationCommand: vi.fn(),
		};
	}),
}));
vi.mock('../../src/services/vault-analyzer', () => ({
	VaultAnalyzer: vi.fn().mockImplementation(function () {
		return {};
	}),
}));
vi.mock('../../src/services/deep-research', () => ({ DeepResearchService: vi.fn() }));
vi.mock('../../src/services/image-generation', () => ({
	ImageGeneration: vi.fn().mockImplementation(function () {
		return {
			setupImageGenerationCommand: vi.fn(),
		};
	}),
}));
vi.mock('../../src/services/selection-action-service', () => ({ SelectionActionService: vi.fn() }));
vi.mock('../../src/services/rag-indexing', () => ({ RagIndexingService: vi.fn() }));
vi.mock('../../src/services/folder-initializer', () => ({
	FolderInitializer: vi.fn().mockImplementation(function () {
		return {
			initializeAll: vi.fn(),
		};
	}),
}));
vi.mock('../../src/agent/agent-event-bus', () => ({
	AgentEventBus: vi.fn().mockImplementation(function () {
		return {
			on: vi.fn().mockReturnValue(() => {}),
			emit: vi.fn().mockResolvedValue(undefined),
			removeAll: vi.fn(),
		};
	}),
}));
vi.mock('../../src/subscribers/tool-execution-logger', () => ({
	ToolExecutionLogger: vi.fn().mockImplementation(function () {
		return {
			destroy: vi.fn(),
		};
	}),
}));
vi.mock('../../src/subscribers/context-tracking-subscriber', () => ({
	ContextTrackingSubscriber: vi.fn().mockImplementation(function () {
		return {
			destroy: vi.fn(),
		};
	}),
}));
vi.mock('../../src/subscribers/accessed-files-subscriber', () => ({
	AccessedFilesSubscriber: vi.fn().mockImplementation(function () {
		return {
			destroy: vi.fn(),
		};
	}),
}));
vi.mock('../../src/subscribers/project-activation-subscriber', () => ({
	ProjectActivationSubscriber: vi.fn().mockImplementation(function () {
		return {
			destroy: vi.fn(),
		};
	}),
}));
vi.mock('../../src/services/project-manager', () => ({
	ProjectManager: vi.fn().mockImplementation(function () {
		return {
			initialize: vi.fn(),
			registerVaultEvents: vi.fn(),
			discoverProjects: vi.fn().mockReturnValue([]),
			destroy: vi.fn(),
		};
	}),
}));
vi.mock('../../src/ui/update-notification-modal', () => ({ UpdateNotificationModal: vi.fn() }));
vi.mock('../../src/services/background-task-manager', () => ({
	BackgroundTaskManager: vi.fn().mockImplementation(function () {
		return {
			destroy: vi.fn(),
			runningCount: 0,
		};
	}),
}));
vi.mock('../../src/services/background-status-bar', () => ({
	BackgroundStatusBar: vi.fn().mockImplementation(function () {
		return {
			setup: vi.fn(),
			update: vi.fn(),
			destroy: vi.fn(),
			setRagProvider: vi.fn(),
			setPendingCatchUpCount: vi.fn(),
		};
	}),
}));
vi.mock('../../src/services/scheduled-task-manager', () => ({
	ScheduledTaskManager: vi.fn().mockImplementation(function () {
		return {
			initialize: vi.fn().mockResolvedValue(undefined),
			start: vi.fn(),
			destroy: vi.fn(),
			detectMissedRuns: vi.fn().mockReturnValue([]),
			runNow: vi.fn().mockResolvedValue('bg-task-1'),
			skipCatchUp: vi.fn().mockResolvedValue(undefined),
			reserveForCatchUp: vi.fn(),
		};
	}),
}));

// Must be after all vi.mock calls
import { LifecycleService } from '../../src/services/lifecycle-service';
import { BackgroundTaskManager } from '../../src/services/background-task-manager';
import { BackgroundStatusBar } from '../../src/services/background-status-bar';
import { ScheduledTaskManager } from '../../src/services/scheduled-task-manager';
import { ToolRegistrar } from '../../src/services/tool-registrar';
import { ProjectActivationSubscriber } from '../../src/subscribers/project-activation-subscriber';

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: { on: vi.fn() },
			workspace: { layoutReady: false },
		},
		settings: {
			mcpEnabled: false,
			ragIndexing: { enabled: false },
			logToolExecution: true,
			chatHistory: true,
			lastSeenVersion: '1.0.0',
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		},
		isGeminiInitialized: false,
		manifest: { version: '1.0.0' },
		saveData: vi.fn(),
		registerEvent: vi.fn(),
		addStatusBarItem: vi.fn().mockReturnValue({
			addClass: vi.fn(),
			removeClass: vi.fn(),
			createSpan: vi.fn().mockReturnValue({ setText: vi.fn() }),
			addEventListener: vi.fn(),
			remove: vi.fn(),
			style: {},
			querySelector: vi.fn().mockReturnValue(null),
		}),
		...overrides,
	};
}

describe('LifecycleService', () => {
	let lifecycle: LifecycleService;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
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
			const mockDisconnectAll = vi.fn();
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
			const registrarInstance = (ToolRegistrar as unknown as Mock).mock.results[0].value;
			expect(registrarInstance.registerAll).toHaveBeenCalledWith(
				mockPlugin.toolRegistry,
				mockPlugin.logger,
				mockPlugin
			);
		});

		it('should create ProjectActivationSubscriber with plugin', async () => {
			await lifecycle.setup();

			expect(ProjectActivationSubscriber).toHaveBeenCalledTimes(1);
			expect(ProjectActivationSubscriber).toHaveBeenCalledWith(mockPlugin);
		});

		it('should create backgroundTaskManager and backgroundStatusBar on first setup', async () => {
			await lifecycle.setup();

			expect(mockPlugin.backgroundTaskManager).toBeDefined();
			expect(mockPlugin.backgroundStatusBar).toBeDefined();
			expect(BackgroundTaskManager).toHaveBeenCalledTimes(1);
			expect(BackgroundStatusBar).toHaveBeenCalledTimes(1);
			expect(mockPlugin.backgroundStatusBar.setup).toHaveBeenCalledTimes(1);
		});

		it('should not recreate backgroundTaskManager or backgroundStatusBar on re-setup', async () => {
			await lifecycle.setup();

			const firstManager = mockPlugin.backgroundTaskManager;
			const firstStatusBar = mockPlugin.backgroundStatusBar;

			mockPlugin.isGeminiInitialized = true;
			await lifecycle.setup();

			expect(mockPlugin.backgroundTaskManager).toBe(firstManager);
			expect(mockPlugin.backgroundStatusBar).toBe(firstStatusBar);
			expect(BackgroundTaskManager).toHaveBeenCalledTimes(1);
			expect(BackgroundStatusBar).toHaveBeenCalledTimes(1);
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
			const mockDisconnectAll = vi.fn();
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

	describe('catch-up handling on layout ready', () => {
		const missedTask = (slug: string) => ({ task: { slug }, missedAt: new Date(Date.now() - 60_000) });

		// Wires the ScheduledTaskManager mock so `detectMissedRuns` returns the
		// supplied entries on the next instantiation. Returns the live mock
		// instance once setup() has run, so tests can assert on its methods.
		async function withMissedRuns(entries: ReturnType<typeof missedTask>[], settingsOverride: any = {}) {
			Object.assign(mockPlugin.settings, settingsOverride);
			(ScheduledTaskManager as unknown as Mock).mockImplementationOnce(function () {
				return {
					initialize: vi.fn().mockResolvedValue(undefined),
					start: vi.fn(),
					destroy: vi.fn(),
					detectMissedRuns: vi.fn().mockReturnValue(entries),
					runNow: vi.fn().mockResolvedValue('bg-task-1'),
					skipCatchUp: vi.fn().mockResolvedValue(undefined),
					reserveForCatchUp: vi.fn(),
				};
			});
			await lifecycle.setup();
			return mockPlugin.scheduledTaskManager;
		}

		it('auto-runs every missed task when autoRunCatchUp is true', async () => {
			const mgr = await withMissedRuns([missedTask('task-a'), missedTask('task-b')], { autoRunCatchUp: true });

			await lifecycle.onLayoutReady();

			expect(mgr.runNow).toHaveBeenCalledTimes(2);
			expect(mgr.runNow).toHaveBeenCalledWith('task-a');
			expect(mgr.runNow).toHaveBeenCalledWith('task-b');
			expect(mgr.reserveForCatchUp).not.toHaveBeenCalled();
			expect(mockPlugin.backgroundStatusBar.setPendingCatchUpCount).not.toHaveBeenCalled();
		});

		it('reserves slugs and surfaces a badge when autoRunCatchUp is false', async () => {
			const mgr = await withMissedRuns([missedTask('task-a'), missedTask('task-b')], { autoRunCatchUp: false });

			await lifecycle.onLayoutReady();

			expect(mgr.runNow).not.toHaveBeenCalled();
			expect(mgr.reserveForCatchUp).toHaveBeenCalledWith(['task-a', 'task-b']);
			expect(mockPlugin.backgroundStatusBar.setPendingCatchUpCount).toHaveBeenCalledWith(2);
		});

		it('is a no-op when no missed runs are detected', async () => {
			const mgr = await withMissedRuns([], { autoRunCatchUp: false });

			await lifecycle.onLayoutReady();

			expect(mgr.runNow).not.toHaveBeenCalled();
			expect(mgr.reserveForCatchUp).not.toHaveBeenCalled();
			expect(mockPlugin.backgroundStatusBar.setPendingCatchUpCount).not.toHaveBeenCalled();
		});

		it('continues catch-up after a single runNow failure', async () => {
			const mgr = await withMissedRuns([missedTask('boom'), missedTask('ok')], { autoRunCatchUp: true });
			mgr.runNow.mockRejectedValueOnce(new Error('submit failed')).mockResolvedValueOnce('bg-task-2');

			await lifecycle.onLayoutReady();

			expect(mgr.runNow).toHaveBeenCalledTimes(2);
			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Auto catch-up failed for "boom"'),
				expect.any(Error)
			);
		});
	});

	describe('onUnload', () => {
		it('should clean up MCP servers', async () => {
			const mockDisconnectAll = vi.fn().mockResolvedValue(undefined);
			mockPlugin.mcpManager = { disconnectAll: mockDisconnectAll };

			await lifecycle.onUnload();

			expect(mockDisconnectAll).toHaveBeenCalled();
			expect(mockPlugin.mcpManager).toBeNull();
		});

		it('should call destroy on ToolExecutionLogger', async () => {
			const mockDestroy = vi.fn();
			mockPlugin.toolExecutionLogger = { destroy: mockDestroy };

			await lifecycle.onUnload();

			expect(mockDestroy).toHaveBeenCalled();
			expect(mockPlugin.toolExecutionLogger).toBeNull();
		});

		it('should call destroy on ProjectActivationSubscriber', async () => {
			await lifecycle.setup();
			const instance = (ProjectActivationSubscriber as unknown as Mock).mock.results[0].value;

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

		it('should destroy backgroundTaskManager and backgroundStatusBar on unload', async () => {
			await lifecycle.setup();

			const manager = mockPlugin.backgroundTaskManager;
			const statusBar = mockPlugin.backgroundStatusBar;

			mockPlugin.mcpManager = null;
			mockPlugin.ragIndexing = null;

			await lifecycle.onUnload();

			expect(manager.destroy).toHaveBeenCalledTimes(1);
			expect(statusBar.destroy).toHaveBeenCalledTimes(1);
			expect(mockPlugin.backgroundTaskManager).toBeNull();
			expect(mockPlugin.backgroundStatusBar).toBeNull();
		});
	});
});
