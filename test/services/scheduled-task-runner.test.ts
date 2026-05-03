import type { Mock } from 'vitest';
import { ScheduledTaskRunner } from '../../src/services/scheduled-task-runner';
import type { ScheduledTask } from '../../src/services/scheduled-task-manager';
import type { AgentLoopResult } from '../../src/agent/agent-loop';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {},
}));

vi.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/format-utils', () => ({
	formatLocalDate: vi.fn().mockReturnValue('2026-04-18'),
	formatLocalTimestamp: vi.fn().mockReturnValue('2026-04-18 08:00'),
}));

vi.mock('../../src/utils/turn-preamble', () => ({
	buildTurnPreamble: vi.fn().mockReturnValue(''),
}));

/** Minimal mock model API — no tool calls, returns plain text on first call. */
function createMockModelApi(responseText = 'Task completed successfully.', toolCalls: any[] = []) {
	return {
		generateModelResponse: vi.fn().mockResolvedValue({
			markdown: responseText,
			toolCalls,
		}),
	};
}

vi.mock('../../src/api', () => ({
	GeminiClientFactory: {
		createChatModel: vi.fn(),
	},
}));

/** Mock AgentLoop so tests don't pull in the real agent infrastructure. */
const mockAgentLoopRun = vi.fn();
vi.mock('../../src/agent/agent-loop', () => ({
	AgentLoop: vi.fn().mockImplementation(function () {
		return { run: mockAgentLoopRun };
	}),
}));

import { GeminiClientFactory } from '../../src/api';

function successfulLoopResult(markdown = 'Tool result text.'): AgentLoopResult {
	return {
		markdown,
		history: [],
		cancelled: false,
		retried: false,
		fellBack: false,
		exhausted: false,
		loopAborted: false,
		iterations: 1,
	};
}

function createMockPlugin(vaultFiles: Record<string, string> = {}): any {
	return {
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
		settings: {
			chatModelName: 'gemini-2.0-flash',
			temperature: 1,
			topP: 0.95,
		},
		sessionManager: {
			createAgentSession: vi.fn().mockResolvedValue({
				id: 'session-1',
				title: 'Scheduled: test-task',
				created: new Date(),
				context: { enabledTools: [], requireConfirmation: [] },
				modelConfig: {},
			}),
		},
		toolRegistry: {
			getEnabledTools: vi.fn().mockReturnValue([]),
		},
		toolExecutionEngine: {
			executeTool: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
		},
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				create: vi.fn().mockImplementation(async (path: string, content: string) => {
					vaultFiles[path] = content;
				}),
				modify: vi.fn().mockImplementation(async (file: any, content: string) => {
					vaultFiles[file.path] = content;
				}),
			},
		},
	};
}

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
	return {
		slug: 'test-task',
		schedule: 'daily',
		enabledTools: [],
		outputPath: 'gemini-scribe/Scheduled-Tasks/Runs/test-task/{date}.md',
		enabled: true,
		runIfMissed: false,
		prompt: 'Write a daily summary.',
		filePath: 'gemini-scribe/Scheduled-Tasks/test-task.md',
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScheduledTaskRunner', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(GeminiClientFactory.createChatModel as Mock).mockReturnValue(createMockModelApi());
		mockAgentLoopRun.mockResolvedValue(successfulLoopResult());
	});

	it('writes model response to the resolved outputPath', async () => {
		const vaultFiles: Record<string, string> = {};
		const plugin = createMockPlugin(vaultFiles);
		const task = makeTask();
		const runner = new ScheduledTaskRunner(plugin, task);

		const outputPath = await runner.run(() => false);

		// Returns the resolved path
		expect(outputPath).toBe('gemini-scribe/Scheduled-Tasks/Runs/test-task/2026-04-18.md');

		// File was created in the vault
		expect(plugin.app.vault.create).toHaveBeenCalledWith(
			'gemini-scribe/Scheduled-Tasks/Runs/test-task/2026-04-18.md',
			expect.stringContaining('Task completed successfully.')
		);
	});

	it('output file contains frontmatter with scheduled_task and ran_at', async () => {
		const vaultFiles: Record<string, string> = {};
		const plugin = createMockPlugin(vaultFiles);
		const runner = new ScheduledTaskRunner(plugin, makeTask());

		await runner.run(() => false);

		const written = (plugin.app.vault.create as Mock).mock.calls[0][1] as string;
		expect(written).toMatch(/scheduled_task:\s*"test-task"/);
		expect(written).toMatch(/ran_at:/);
	});

	it('resolves {date} and {slug} placeholders in outputPath', async () => {
		const plugin = createMockPlugin();
		const task = makeTask({ outputPath: 'reports/{slug}/{date}.md' });
		const runner = new ScheduledTaskRunner(plugin, task);

		const outputPath = await runner.run(() => false);

		expect(outputPath).toBe('reports/test-task/2026-04-18.md');
	});

	it('returns undefined when cancelled before the model responds', async () => {
		const plugin = createMockPlugin();
		// isCancelled returns true immediately
		const runner = new ScheduledTaskRunner(plugin, makeTask());

		const outputPath = await runner.run(() => true);

		expect(outputPath).toBeUndefined();
		expect(plugin.app.vault.create).not.toHaveBeenCalled();
	});

	it('throws when model returns empty text so manager records a failure', async () => {
		(GeminiClientFactory.createChatModel as Mock).mockReturnValue(
			createMockModelApi('') // empty response, no tool calls
		);
		const plugin = createMockPlugin();
		const runner = new ScheduledTaskRunner(plugin, makeTask());

		await expect(runner.run(() => false)).rejects.toThrow('produced no response');
		expect(plugin.app.vault.create).not.toHaveBeenCalled();
	});

	it('delegates to AgentLoop when initial response contains tool calls', async () => {
		const toolCalls = [{ name: 'list_files', arguments: { path: '/' } }];
		(GeminiClientFactory.createChatModel as Mock).mockReturnValue(createMockModelApi('', toolCalls));
		mockAgentLoopRun.mockResolvedValue(successfulLoopResult('Tool result text.'));

		const plugin = createMockPlugin();
		const runner = new ScheduledTaskRunner(plugin, makeTask());

		const outputPath = await runner.run(() => false);

		expect(mockAgentLoopRun).toHaveBeenCalledWith(
			expect.objectContaining({
				initialUserMessage: expect.any(String),
				initialHistory: [],
				options: expect.objectContaining({
					plugin,
					isCancelled: expect.any(Function),
					maxIterations: 20,
					// Regression guard: ScheduledTaskRunner must supply a headless
					// confirmationProvider so AgentLoop never has to fall back.
					confirmationProvider: expect.objectContaining({
						showConfirmationInChat: expect.any(Function),
						isToolAllowedWithoutConfirmation: expect.any(Function),
						allowToolWithoutConfirmation: expect.any(Function),
					}),
				}),
			})
		);
		expect(outputPath).toBe('gemini-scribe/Scheduled-Tasks/Runs/test-task/2026-04-18.md');
		expect(plugin.app.vault.create).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('Tool result text.')
		);
	});

	it('returns undefined when AgentLoop reports cancellation', async () => {
		const toolCalls = [{ name: 'list_files', arguments: { path: '/' } }];
		(GeminiClientFactory.createChatModel as Mock).mockReturnValue(createMockModelApi('', toolCalls));
		mockAgentLoopRun.mockResolvedValue({
			...successfulLoopResult(),
			cancelled: true,
			markdown: '',
		});

		const plugin = createMockPlugin();
		const runner = new ScheduledTaskRunner(plugin, makeTask());

		const outputPath = await runner.run(() => false);

		expect(outputPath).toBeUndefined();
		expect(plugin.app.vault.create).not.toHaveBeenCalled();
	});

	it('throws after MAX_TOOL_ITERATIONS without a text response', async () => {
		const toolCalls = [{ name: 'list_files', arguments: { path: '/' } }];
		(GeminiClientFactory.createChatModel as Mock).mockReturnValue(createMockModelApi('', toolCalls));
		mockAgentLoopRun.mockResolvedValue({
			...successfulLoopResult(),
			exhausted: true,
			markdown: '',
		});

		const plugin = createMockPlugin();
		const runner = new ScheduledTaskRunner(plugin, makeTask());

		await expect(runner.run(() => false)).rejects.toThrow('exhausted');
		expect(plugin.app.vault.create).not.toHaveBeenCalled();
	});

	it('uses task model override instead of plugin chat model', async () => {
		const plugin = createMockPlugin();
		plugin.settings.chatModelName = 'plugin-default-model';
		const task = makeTask({ model: 'task-override-model' });
		const runner = new ScheduledTaskRunner(plugin, task);

		await runner.run(() => false);

		const request = ((GeminiClientFactory.createChatModel as Mock).mock.results[0].value.generateModelResponse as Mock)
			.mock.calls[0][0];
		expect(request.model).toBe('task-override-model');
		expect(request.model).not.toBe(plugin.settings.chatModelName);
	});

	it('generates a unique path when the resolved output file already exists', async () => {
		const plugin = createMockPlugin();
		// First call (base path) returns an existing file; second call (-1 suffix) returns null
		plugin.app.vault.getAbstractFileByPath = vi
			.fn()
			.mockReturnValueOnce({}) // base path exists
			.mockReturnValueOnce(null); // -1 path is free

		const runner = new ScheduledTaskRunner(plugin, makeTask());
		await runner.run(() => false);

		// Should create at the -1 suffix path, never at the base path
		expect(plugin.app.vault.create).toHaveBeenCalledWith(
			'gemini-scribe/Scheduled-Tasks/Runs/test-task/2026-04-18-1.md',
			expect.stringContaining('Task completed successfully.')
		);
		expect(plugin.app.vault.modify).not.toHaveBeenCalled();
	});

	describe('default enabledTools', () => {
		// Pin the broadened default added to fix #728: scheduled tasks with empty
		// enabledTools should get read_only + skills (not just read_only) so the
		// "run skill X on a schedule" pattern works without extra setup.
		it('defaults to read_only + skills when frontmatter enabledTools is empty', async () => {
			const plugin = createMockPlugin();
			const runner = new ScheduledTaskRunner(plugin, makeTask({ enabledTools: [] }));

			await runner.run(() => false);

			expect(plugin.sessionManager.createAgentSession).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					enabledTools: ['read_only', 'skills'],
				})
			);
		});

		it('honors an explicit enabledTools list and does not augment it', async () => {
			const plugin = createMockPlugin();
			const runner = new ScheduledTaskRunner(plugin, makeTask({ enabledTools: ['read_only'] }));

			await runner.run(() => false);

			// User explicitly chose read_only — must NOT silently add skills.
			expect(plugin.sessionManager.createAgentSession).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					enabledTools: ['read_only'],
				})
			);
		});
	});
});
