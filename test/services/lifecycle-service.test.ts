import type { Mock } from 'vitest';

const { mockPlatform, mockCatchUpModal, MockCatchUpModalClass, mockUpdateModal, MockUpdateModalClass } = vi.hoisted(
	() => {
		const mockCatchUpModal = { open: vi.fn() };
		// Must use a regular function (not arrow) so it can be called with `new`
		function MockCatchUpModalClass() {
			return mockCatchUpModal;
		}
		const mockUpdateModal = { open: vi.fn() };
		function MockUpdateModalClass() {
			return mockUpdateModal;
		}
		return {
			mockPlatform: { isMobile: false },
			mockCatchUpModal,
			MockCatchUpModalClass: vi.fn().mockImplementation(MockCatchUpModalClass),
			mockUpdateModal,
			MockUpdateModalClass: vi.fn().mockImplementation(MockUpdateModalClass),
		};
	}
);

vi.mock('obsidian', () => ({
	TFile: class TFile {},
	Notice: vi.fn(),
	normalizePath: (p: string) => p,
	Platform: mockPlatform,
}));

vi.mock('../../src/ui/catch-up-modal', () => ({ CatchUpModal: MockCatchUpModalClass }));

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
vi.mock('../../src/services/rag-indexing', () => ({
	RagIndexingService: vi.fn().mockImplementation(function () {
		return {
			initialize: vi.fn().mockResolvedValue(undefined),
			destroy: vi.fn().mockResolvedValue(undefined),
			onFileCreate: vi.fn(),
			onFileModify: vi.fn(),
			onFileDelete: vi.fn(),
			onFileRename: vi.fn(),
		};
	}),
}));
vi.mock('../../src/tools/rag-search-tool', () => ({
	getRagTools: vi.fn().mockReturnValue([{ name: 'rag_search', execute: vi.fn() }]),
}));
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
vi.mock('../../src/ui/update-notification-modal', () => ({ UpdateNotificationModal: MockUpdateModalClass }));
vi.mock('../../src/services/background-task-manager', () => ({
	BackgroundTaskManager: vi.fn().mockImplementation(function () {
		return {
			destroy: vi.fn(),
			runningCount: 0,
			getActiveTasks: vi.fn().mockReturnValue([]),
			cancel: vi.fn(),
			drain: vi.fn().mockResolvedValue(undefined),
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
vi.mock('../../src/services/hook-manager', () => ({
	HookManager: vi.fn().mockImplementation(function () {
		return {
			initialize: vi.fn().mockResolvedValue(undefined),
			destroy: vi.fn(),
		};
	}),
}));

// Must be after all vi.mock calls
import { LifecycleService } from '../../src/services/lifecycle-service';
import { BackgroundTaskManager } from '../../src/services/background-task-manager';
import { BackgroundStatusBar } from '../../src/services/background-status-bar';
import { ScheduledTaskManager } from '../../src/services/scheduled-task-manager';
import { HookManager } from '../../src/services/hook-manager';
import { ToolRegistrar } from '../../src/services/tool-registrar';
import { ProjectActivationSubscriber } from '../../src/subscribers/project-activation-subscriber';
// import { ModelManager } from '../../src/services/model-manager';
import { ToolExecutionLogger } from '../../src/subscribers/tool-execution-logger';

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

		beforeEach(() => {
			mockPlatform.isMobile = false;
			MockCatchUpModalClass.mockClear();
			mockCatchUpModal.open.mockClear();
		});

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

		it('opens CatchUpModal directly on mobile when autoRunCatchUp is false', async () => {
			mockPlatform.isMobile = true;
			await withMissedRuns([missedTask('task-a'), missedTask('task-b')], { autoRunCatchUp: false });

			await lifecycle.onLayoutReady();

			expect(MockCatchUpModalClass).toHaveBeenCalledTimes(1);
			expect(MockCatchUpModalClass).toHaveBeenCalledWith(
				mockPlugin.app,
				mockPlugin,
				expect.arrayContaining([
					expect.objectContaining({ task: { slug: 'task-a' } }),
					expect.objectContaining({ task: { slug: 'task-b' } }),
				])
			);
			expect(mockCatchUpModal.open).toHaveBeenCalledTimes(1);
		});

		it('does not open CatchUpModal on desktop when autoRunCatchUp is false', async () => {
			mockPlatform.isMobile = false;
			await withMissedRuns([missedTask('task-a')], { autoRunCatchUp: false });

			await lifecycle.onLayoutReady();

			expect(MockCatchUpModalClass).not.toHaveBeenCalled();
			expect(mockCatchUpModal.open).not.toHaveBeenCalled();
			// Badge is still set so the desktop status-bar entry point works
			expect(mockPlugin.backgroundStatusBar.setPendingCatchUpCount).toHaveBeenCalledWith(1);
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

	describe('setup – scheduled-task re-init orchestration', () => {
		it('should cancel scheduled-task background tasks, drain, reinitialize and start on re-init', async () => {
			await lifecycle.setup();

			// Simulate re-init: layout is ready and scheduledTaskManager exists
			mockPlugin.isGeminiInitialized = true;
			mockPlugin.app.workspace.layoutReady = true;

			const mockCancel = vi.fn();
			const mockDrain = vi.fn().mockResolvedValue(undefined);
			mockPlugin.backgroundTaskManager = {
				getActiveTasks: vi.fn().mockReturnValue([
					{ type: 'scheduled-task', id: 't1' },
					{ type: 'deep-research', id: 't2' },
					{ type: 'scheduled-task', id: 't3' },
				]),
				cancel: mockCancel,
				drain: mockDrain,
				destroy: vi.fn(),
				runningCount: 0,
			};

			const scheduledMgr = mockPlugin.scheduledTaskManager;

			await lifecycle.setup();

			// Should only cancel scheduled-task type tasks
			expect(mockCancel).toHaveBeenCalledTimes(2);
			expect(mockCancel).toHaveBeenCalledWith('t1');
			expect(mockCancel).toHaveBeenCalledWith('t3');
			// Should drain scheduled-task type
			expect(mockDrain).toHaveBeenCalledWith('scheduled-task');
			// Should reinitialize and start
			expect(scheduledMgr.initialize).toHaveBeenCalledWith({ refresh: true });
			expect(scheduledMgr.start).toHaveBeenCalled();
		});
	});

	describe('setup – hook manager refresh on re-init', () => {
		it('should call hookManager.initialize({ refresh: true }) when layoutReady on re-init', async () => {
			await lifecycle.setup();

			mockPlugin.isGeminiInitialized = true;
			mockPlugin.app.workspace.layoutReady = true;

			// backgroundTaskManager needs getActiveTasks for the scheduled-task re-init block
			mockPlugin.backgroundTaskManager.getActiveTasks = vi.fn().mockReturnValue([]);
			mockPlugin.backgroundTaskManager.cancel = vi.fn();
			mockPlugin.backgroundTaskManager.drain = vi.fn().mockResolvedValue(undefined);

			const hookMgr = mockPlugin.hookManager;

			await lifecycle.setup();

			expect(hookMgr.initialize).toHaveBeenCalledWith({ refresh: true });
		});
	});

	describe('setup – MCP connection', () => {
		it('should call mcpManager.connectAllEnabled() when mcpEnabled is true', async () => {
			mockPlugin.settings.mcpEnabled = true;
			await lifecycle.setup();

			expect(mockPlugin.mcpManager.connectAllEnabled).toHaveBeenCalled();
		});

		it('should not call mcpManager.connectAllEnabled() when mcpEnabled is false', async () => {
			mockPlugin.settings.mcpEnabled = false;
			await lifecycle.setup();

			expect(mockPlugin.mcpManager.connectAllEnabled).not.toHaveBeenCalled();
		});
	});

	describe('setup – image generation provider gating', () => {
		it('should skip image generation when provider is ollama', async () => {
			mockPlugin.settings.provider = 'ollama';
			await lifecycle.setup();

			expect(mockPlugin.imageGeneration).toBeUndefined();
		});

		it('should create image generation when provider is not ollama', async () => {
			mockPlugin.settings.provider = 'gemini';
			await lifecycle.setup();

			expect(mockPlugin.imageGeneration).toBeDefined();
		});
	});

	describe('setup – HookManager and ScheduledTaskManager created once', () => {
		it('should create HookManager once in core services', async () => {
			await lifecycle.setup();

			expect(HookManager).toHaveBeenCalledTimes(1);
			expect(mockPlugin.hookManager).toBeDefined();
		});

		it('should not recreate HookManager on re-setup', async () => {
			await lifecycle.setup();
			const first = mockPlugin.hookManager;

			mockPlugin.isGeminiInitialized = true;
			await lifecycle.setup();

			expect(mockPlugin.hookManager).toBe(first);
			expect(HookManager).toHaveBeenCalledTimes(1);
		});

		it('should create ScheduledTaskManager once in core services', async () => {
			await lifecycle.setup();

			expect(ScheduledTaskManager).toHaveBeenCalledTimes(1);
			expect(mockPlugin.scheduledTaskManager).toBeDefined();
		});

		it('should not recreate ScheduledTaskManager on re-setup', async () => {
			await lifecycle.setup();
			const first = mockPlugin.scheduledTaskManager;

			mockPlugin.isGeminiInitialized = true;
			await lifecycle.setup();

			expect(mockPlugin.scheduledTaskManager).toBe(first);
			expect(ScheduledTaskManager).toHaveBeenCalledTimes(1);
		});
	});

	describe('onLayoutReady – deferred init', () => {
		it('should initialize projectManager and register vault events', async () => {
			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(mockPlugin.projectManager.initialize).toHaveBeenCalled();
			expect(mockPlugin.projectManager.registerVaultEvents).toHaveBeenCalled();
		});

		it('should call folderInitializer.initializeAll', async () => {
			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(mockPlugin.folderInitializer.initializeAll).toHaveBeenCalled();
		});

		it('should call hookManager.initialize on layout ready', async () => {
			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(mockPlugin.hookManager.initialize).toHaveBeenCalled();
		});

		it('should initialize and start scheduledTaskManager on layout ready', async () => {
			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(mockPlugin.scheduledTaskManager.initialize).toHaveBeenCalled();
			expect(mockPlugin.scheduledTaskManager.start).toHaveBeenCalled();
		});
	});

	describe('syncModels', () => {
		it('should return early when modelManager is null', async () => {
			await lifecycle.setup();
			mockPlugin.modelManager = null;

			// Should not throw
			await lifecycle.syncModels();
			expect(mockPlugin.saveData).not.toHaveBeenCalled();
		});

		it('should save settings when updateModels returns settingsChanged: true', async () => {
			await lifecycle.setup();

			const updatedSettings = { ...mockPlugin.settings, chatModelName: 'new-model' };
			mockPlugin.modelManager.updateModels = vi.fn().mockResolvedValue({
				settingsChanged: true,
				updatedSettings,
				changedSettingsInfo: ['chat model'],
			});

			await lifecycle.syncModels();

			expect(mockPlugin.settings).toBe(updatedSettings);
			expect(mockPlugin.saveData).toHaveBeenCalledWith(updatedSettings);
			expect(mockPlugin.logger.log).toHaveBeenCalledWith(
				'Model settings updated:',
				expect.stringContaining('chat model')
			);
		});

		it('should not save settings when updateModels returns settingsChanged: false', async () => {
			await lifecycle.setup();

			mockPlugin.modelManager.updateModels = vi.fn().mockResolvedValue({
				settingsChanged: false,
				updatedSettings: mockPlugin.settings,
				changedSettingsInfo: [],
			});

			// Reset saveData calls from setup
			mockPlugin.saveData.mockClear();

			await lifecycle.syncModels();

			expect(mockPlugin.saveData).not.toHaveBeenCalled();
		});

		it('should log warning when updateModels throws', async () => {
			await lifecycle.setup();

			const error = new Error('network failure');
			mockPlugin.modelManager.updateModels = vi.fn().mockRejectedValue(error);

			await lifecycle.syncModels();

			expect(mockPlugin.logger.warn).toHaveBeenCalledWith('Failed to sync models:', error);
		});
	});

	describe('syncToolExecutionLogger', () => {
		it('should create logger when logToolExecution=true and no logger exists', async () => {
			await lifecycle.setup();
			// Ensure agentEventBus exists (setup creates it)
			mockPlugin.toolExecutionLogger = null;
			mockPlugin.settings.logToolExecution = true;

			lifecycle.syncToolExecutionLogger();

			expect(mockPlugin.toolExecutionLogger).toBeDefined();
			expect(ToolExecutionLogger).toHaveBeenCalled();
		});

		it('should destroy and null logger when logToolExecution=false and logger exists', async () => {
			await lifecycle.setup();
			// setup() should have created a logger since logToolExecution defaults to true
			const existingLogger = mockPlugin.toolExecutionLogger;
			expect(existingLogger).toBeDefined();

			mockPlugin.settings.logToolExecution = false;
			lifecycle.syncToolExecutionLogger();

			expect(existingLogger.destroy).toHaveBeenCalled();
			expect(mockPlugin.toolExecutionLogger).toBeNull();
		});

		it('should be a no-op when logToolExecution=true and logger already exists', async () => {
			await lifecycle.setup();
			const existingLogger = mockPlugin.toolExecutionLogger;
			expect(existingLogger).toBeDefined();

			const callsBefore = (ToolExecutionLogger as unknown as Mock).mock.calls.length;

			mockPlugin.settings.logToolExecution = true;
			lifecycle.syncToolExecutionLogger();

			// No new logger created
			expect((ToolExecutionLogger as unknown as Mock).mock.calls.length).toBe(callsBefore);
			expect(mockPlugin.toolExecutionLogger).toBe(existingLogger);
		});

		it('should be a no-op when logToolExecution=false and no logger exists', async () => {
			await lifecycle.setup();
			mockPlugin.toolExecutionLogger = null;
			mockPlugin.settings.logToolExecution = false;

			lifecycle.syncToolExecutionLogger();

			expect(mockPlugin.toolExecutionLogger).toBeNull();
		});
	});

	describe('checkForUpdates (via onLayoutReady)', () => {
		beforeEach(() => {
			MockUpdateModalClass.mockClear();
			mockUpdateModal.open.mockClear();
		});

		it('should show UpdateNotificationModal when version differs and lastSeenVersion is not 0.0.0', async () => {
			mockPlugin.manifest.version = '2.0.0';
			mockPlugin.settings.lastSeenVersion = '1.0.0';

			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(MockUpdateModalClass).toHaveBeenCalledWith(mockPlugin.app, '2.0.0');
			expect(mockUpdateModal.open).toHaveBeenCalled();
			expect(mockPlugin.settings.lastSeenVersion).toBe('2.0.0');
			expect(mockPlugin.saveData).toHaveBeenCalledWith(mockPlugin.settings);
		});

		it('should not show modal when version differs but lastSeenVersion is 0.0.0 (first install)', async () => {
			mockPlugin.manifest.version = '1.0.0';
			mockPlugin.settings.lastSeenVersion = '0.0.0';

			await lifecycle.setup();
			await lifecycle.onLayoutReady();

			expect(MockUpdateModalClass).not.toHaveBeenCalled();
			expect(mockPlugin.settings.lastSeenVersion).toBe('1.0.0');
			expect(mockPlugin.saveData).toHaveBeenCalledWith(mockPlugin.settings);
		});

		it('should take no action when version equals lastSeenVersion', async () => {
			mockPlugin.manifest.version = '1.0.0';
			mockPlugin.settings.lastSeenVersion = '1.0.0';

			await lifecycle.setup();
			// Clear any saveData calls from setup
			mockPlugin.saveData.mockClear();

			await lifecycle.onLayoutReady();

			expect(MockUpdateModalClass).not.toHaveBeenCalled();
			// saveData should not have been called for update check (may be called for other reasons)
		});
	});

	describe('onUnload – additional paths', () => {
		it('should destroy scheduledTaskManager and hookManager', async () => {
			await lifecycle.setup();

			const scheduledMgr = mockPlugin.scheduledTaskManager;
			const hookMgr = mockPlugin.hookManager;

			mockPlugin.mcpManager = null;
			mockPlugin.ragIndexing = null;

			await lifecycle.onUnload();

			expect(scheduledMgr.destroy).toHaveBeenCalled();
			expect(mockPlugin.scheduledTaskManager).toBeNull();
			expect(hookMgr.destroy).toHaveBeenCalled();
			expect(mockPlugin.hookManager).toBeNull();
		});

		it('should log error and still null mcpManager when disconnect throws', async () => {
			const disconnectError = new Error('mcp disconnect failed');
			mockPlugin.mcpManager = {
				disconnectAll: vi.fn().mockRejectedValue(disconnectError),
			};
			mockPlugin.ragIndexing = null;

			await lifecycle.onUnload();

			expect(mockPlugin.logger.error).toHaveBeenCalledWith('Error disconnecting MCP servers:', disconnectError);
			expect(mockPlugin.mcpManager).toBeNull();
		});

		it('should flush and destroy fileLogWriter when it exists', async () => {
			const mockDestroy = vi.fn().mockResolvedValue(undefined);
			mockPlugin.fileLogWriter = { destroy: mockDestroy };
			mockPlugin.mcpManager = null;
			mockPlugin.ragIndexing = null;

			await lifecycle.onUnload();

			expect(mockDestroy).toHaveBeenCalled();
			expect(mockPlugin.fileLogWriter).toBeNull();
		});

		it('should handle missing fileLogWriter gracefully', async () => {
			mockPlugin.fileLogWriter = null;
			mockPlugin.mcpManager = null;
			mockPlugin.ragIndexing = null;

			await expect(lifecycle.onUnload()).resolves.not.toThrow();
		});
	});

	describe('initializePluginFolders – direct calls', () => {
		it('calls folderInitializer.initializeAll when folderInitializer exists', async () => {
			const plugin = createMockPlugin();
			plugin.folderInitializer = { initializeAll: vi.fn().mockResolvedValue(undefined) };
			const service = new LifecycleService(plugin);

			await service.initializePluginFolders();

			expect(plugin.folderInitializer.initializeAll).toHaveBeenCalled();
		});

		it('is a no-op when folderInitializer is null', async () => {
			const plugin = createMockPlugin();
			plugin.folderInitializer = null;
			const service = new LifecycleService(plugin);

			// Should not throw
			await service.initializePluginFolders();
		});
	});

	describe('syncToolExecutionLogger – destroy path without setup()', () => {
		it('destroys existing logger and nulls it when logging is disabled', () => {
			const plugin = createMockPlugin();
			plugin.settings.logToolExecution = false;
			// Pre-assign a mock logger directly (not via setup)
			const mockLogger = { destroy: vi.fn() };
			plugin.toolExecutionLogger = mockLogger;
			// agentEventBus must be truthy for shouldRun to depend solely on logToolExecution
			plugin.agentEventBus = { on: vi.fn(), emit: vi.fn(), removeAll: vi.fn() };

			const service = new LifecycleService(plugin);
			service.syncToolExecutionLogger();

			expect(mockLogger.destroy).toHaveBeenCalled();
			expect(plugin.toolExecutionLogger).toBeNull();
		});

		it('destroys existing logger when agentEventBus is falsy', () => {
			const plugin = createMockPlugin();
			plugin.settings.logToolExecution = true;
			const mockLogger = { destroy: vi.fn() };
			plugin.toolExecutionLogger = mockLogger;
			plugin.agentEventBus = null;

			const service = new LifecycleService(plugin);
			service.syncToolExecutionLogger();

			expect(mockLogger.destroy).toHaveBeenCalled();
			expect(plugin.toolExecutionLogger).toBeNull();
		});
	});

	describe('handleCatchUp – auto-run logger.log verification', () => {
		const missedTask = (slug: string) => ({ task: { slug }, missedAt: new Date(Date.now() - 60_000) });

		it('logs each successfully auto-run catch-up task', async () => {
			const plugin = createMockPlugin();
			plugin.settings.autoRunCatchUp = true;

			(ScheduledTaskManager as unknown as Mock).mockImplementationOnce(function () {
				return {
					initialize: vi.fn().mockResolvedValue(undefined),
					start: vi.fn(),
					destroy: vi.fn(),
					detectMissedRuns: vi.fn().mockReturnValue([missedTask('daily-note'), missedTask('weekly-review')]),
					runNow: vi.fn().mockResolvedValue('bg-task-1'),
					skipCatchUp: vi.fn().mockResolvedValue(undefined),
					reserveForCatchUp: vi.fn(),
				};
			});

			const service = new LifecycleService(plugin);
			await service.setup();
			await service.onLayoutReady();

			expect(plugin.logger.log).toHaveBeenCalledWith(expect.stringContaining('Auto catch-up: submitted "daily-note"'));
			expect(plugin.logger.log).toHaveBeenCalledWith(
				expect.stringContaining('Auto catch-up: submitted "weekly-review"')
			);
		});
	});

	describe('checkForUpdates – error path', () => {
		it('logs error when saveData rejects during version update', async () => {
			const plugin = createMockPlugin();
			plugin.manifest.version = '2.0.0';
			plugin.settings.lastSeenVersion = '1.0.0';
			plugin.saveData = vi.fn().mockRejectedValue(new Error('save failed'));

			const service = new LifecycleService(plugin);
			await service.setup();
			await service.onLayoutReady();

			expect(plugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Error checking for updates'),
				expect.any(Error)
			);
		});
	});

	describe('initializeRagIndexing – coverage', () => {
		let RagIndexingServiceMock: Mock;

		beforeEach(async () => {
			const ragModule = await import('../../src/services/rag-indexing');
			RagIndexingServiceMock = ragModule.RagIndexingService as unknown as Mock;
			RagIndexingServiceMock.mockClear();
		});

		it('cleans up existing RAG when provider is ollama', async () => {
			const plugin = createMockPlugin();
			plugin.settings.provider = 'ollama';
			const mockDestroy = vi.fn().mockResolvedValue(undefined);
			plugin.ragIndexing = { destroy: mockDestroy };
			plugin.toolRegistry = { unregisterTool: vi.fn(), registerTool: vi.fn() };

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			expect(plugin.toolRegistry.unregisterTool).toHaveBeenCalledWith('rag_search');
			expect(mockDestroy).toHaveBeenCalled();
			expect(plugin.ragIndexing).toBeNull();
		});

		it('early returns when provider is ollama and no existing ragIndexing', async () => {
			const plugin = createMockPlugin();
			plugin.settings.provider = 'ollama';
			plugin.ragIndexing = null;

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			// No errors, ragIndexing stays null
			expect(plugin.ragIndexing).toBeNull();
		});

		it('creates new RAG service when enabled and none exists', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: true };
			plugin.ragIndexing = null;
			plugin.toolRegistry = { registerTool: vi.fn(), unregisterTool: vi.fn() };

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			expect(RagIndexingServiceMock).toHaveBeenCalledWith(plugin);
			expect(plugin.ragIndexing).not.toBeNull();
			expect(plugin.ragIndexing.initialize).toHaveBeenCalled();
			expect(plugin.toolRegistry.registerTool).toHaveBeenCalled();
		});

		it('registers vault event listeners only once', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: true };
			plugin.ragIndexing = null;
			plugin.toolRegistry = { registerTool: vi.fn(), unregisterTool: vi.fn() };

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			// registerEvent should be called 4 times (create, modify, delete, rename)
			const firstCallCount = plugin.registerEvent.mock.calls.length;
			expect(firstCallCount).toBeGreaterThanOrEqual(4);

			// Re-init should NOT register listeners again
			plugin.registerEvent.mockClear();
			await service.initializeRagIndexing();
			expect(plugin.registerEvent).not.toHaveBeenCalled();
		});

		it('cleans up existing RAG before re-initializing when enabled', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: true };
			const existingDestroy = vi.fn().mockResolvedValue(undefined);
			plugin.ragIndexing = { destroy: existingDestroy };
			plugin.toolRegistry = { registerTool: vi.fn(), unregisterTool: vi.fn() };

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			expect(existingDestroy).toHaveBeenCalled();
			expect(plugin.toolRegistry.unregisterTool).toHaveBeenCalledWith('rag_search');
			// New instance created
			expect(RagIndexingServiceMock).toHaveBeenCalledWith(plugin);
		});

		it('handles RAG initialization error gracefully', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: true };
			plugin.ragIndexing = null;
			plugin.toolRegistry = { registerTool: vi.fn(), unregisterTool: vi.fn() };

			const initError = new Error('RAG init failed');
			RagIndexingServiceMock.mockImplementationOnce(function () {
				return {
					initialize: vi.fn().mockRejectedValue(initError),
					destroy: vi.fn().mockResolvedValue(undefined),
				};
			});

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			expect(plugin.logger.error).toHaveBeenCalledWith('Failed to initialize RAG indexing:', initError);
			expect(plugin.ragIndexing).toBeNull();
		});

		it('cleans up RAG when disabled and ragIndexing exists', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: false };
			const existingDestroy = vi.fn().mockResolvedValue(undefined);
			plugin.ragIndexing = { destroy: existingDestroy };
			plugin.toolRegistry = { unregisterTool: vi.fn() };

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			expect(plugin.toolRegistry.unregisterTool).toHaveBeenCalledWith('rag_search');
			expect(existingDestroy).toHaveBeenCalled();
			expect(plugin.ragIndexing).toBeNull();
		});

		it('no-op when disabled and ragIndexing does not exist', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: false };
			plugin.ragIndexing = null;

			const service = new LifecycleService(plugin);
			await service.initializeRagIndexing();

			expect(plugin.ragIndexing).toBeNull();
		});

		it('calls initializeRagIndexing during onLayoutReady when enabled', async () => {
			const plugin = createMockPlugin();
			plugin.settings.ragIndexing = { enabled: true };
			plugin.ragIndexing = null;
			plugin.toolRegistry = { registerTool: vi.fn(), unregisterTool: vi.fn() };

			const service = new LifecycleService(plugin);
			await service.setup();
			await service.onLayoutReady();

			// RAG service should have been created during onLayoutReady
			expect(RagIndexingServiceMock).toHaveBeenCalled();
		});
	});

	describe('initializePersistentServices – layoutReady branch', () => {
		it('calls history.onLayoutReady when workspace.layoutReady is true during setup', async () => {
			const plugin = createMockPlugin();
			plugin.app.workspace.layoutReady = true;

			const service = new LifecycleService(plugin);
			await service.setup();

			// Verify the GeminiHistory mock had onLayoutReady called
			expect(plugin.history.onLayoutReady).toHaveBeenCalled();
		});
	});

	describe('setup – image generation provider gating (explicit constructor check)', () => {
		it('should call ImageGeneration constructor when provider is gemini', async () => {
			const { ImageGeneration } = await import('../../src/services/image-generation');
			(ImageGeneration as unknown as Mock).mockClear();

			const plugin = createMockPlugin();
			plugin.settings.provider = 'gemini';
			const service = new LifecycleService(plugin);
			await service.setup();

			expect(ImageGeneration).toHaveBeenCalledTimes(1);
			expect(plugin.imageGeneration).toBeDefined();
		});

		it('should NOT call ImageGeneration constructor when provider is ollama', async () => {
			const { ImageGeneration } = await import('../../src/services/image-generation');
			(ImageGeneration as unknown as Mock).mockClear();

			const plugin = createMockPlugin();
			plugin.settings.provider = 'ollama';
			const service = new LifecycleService(plugin);
			await service.setup();

			expect(ImageGeneration).not.toHaveBeenCalled();
			expect(plugin.imageGeneration).toBeUndefined();
		});
	});
});
