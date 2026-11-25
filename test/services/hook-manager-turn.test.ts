import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { HookManager, type Hook } from '../../src/services/hook-manager';
import { AgentEventBus } from '../../src/agent/agent-event-bus';
import type { AgentEventMap, TurnOutcome } from '../../src/types/agent-events';
import type { HookFireContext } from '../../src/services/hook-types';

// The agent-turn trigger (#1806): HookManager subscribes to `turnEnd` and runs
// hooks through the same gates, debounce, cooldown and rate limit as a file
// event, keyed per hook instead of per (hook, file).

const { platform } = vi.hoisted(() => ({ platform: { isMobile: false } }));

vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {},
	TFolder: class {},
	Platform: platform,
	getLanguage: () => 'en',
}));

vi.mock('../../src/utils/file-utils', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/utils/file-utils')>()),
	ensureFolderExists: vi.fn().mockResolvedValue(undefined),
}));

const { runs } = vi.hoisted(() => ({
	runs: { contexts: [] as HookFireContext[], impl: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/services/hook-runner', () => ({
	HookRunner: class {
		constructor(_plugin: unknown, ctx: HookFireContext) {
			runs.contexts.push(ctx);
		}
		run = runs.impl;
	},
}));

function createMockPlugin() {
	const stateStore: Record<string, string> = {};
	return {
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
		settings: { historyFolder: 'gemini-scribe', hooksEnabled: true },
		registerEvent: vi.fn(),
		backgroundTaskManager: undefined as any,
		agentEventBus: undefined as AgentEventBus | undefined,
		app: {
			fileManager: { trashFile: vi.fn().mockResolvedValue(undefined) },
			vault: {
				configDir: '.obsidian',
				getMarkdownFiles: vi.fn().mockReturnValue([]),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				on: vi.fn().mockReturnValue({}),
				offref: vi.fn(),
				read: vi.fn().mockResolvedValue(''),
				create: vi.fn().mockResolvedValue(undefined),
				modify: vi.fn().mockResolvedValue(undefined),
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockImplementation(async (path: string) => stateStore[path] ?? '{}'),
					write: vi.fn().mockImplementation(async (path: string, content: string) => {
						stateStore[path] = content;
					}),
				},
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		},
	};
}

function makeHook(overrides: Partial<Hook> = {}): Hook {
	return {
		slug: 'turn-log',
		trigger: 'agent-turn-ended',
		debounceMs: 100,
		cooldownMs: 0,
		action: 'command',
		commandId: 'obsidian-git:commit',
		enabledSkills: [],
		enabled: true,
		desktopOnly: false,
		prompt: '',
		filePath: 'gemini-scribe/Hooks/turn-log.md',
		...overrides,
	};
}

function seeded(plugin: any, hooks: Hook[]): HookManager {
	const manager = new HookManager(plugin);
	(manager as any).hooks = new Map(hooks.map((h) => [h.slug, h]));
	(manager as any).initialized = true;
	return manager;
}

function turnEnd(
	overrides: Partial<{ outcome: TurnOutcome; toolCallCount: number; userMessage: string; ephemeral: boolean }> = {}
): AgentEventMap['turnEnd'] {
	return {
		session: { id: 's1', title: 'My chat', ephemeral: overrides.ephemeral } as any,
		toolCallCount: overrides.toolCallCount ?? 0,
		outcome: overrides.outcome ?? 'complete',
		userMessage: overrides.userMessage ?? 'hello',
	};
}

describe('HookManager agent-turn trigger', () => {
	beforeEach(() => {
		runs.contexts.length = 0;
		runs.impl.mockReset();
		runs.impl.mockResolvedValue(undefined);
		platform.isMobile = false;
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each<TurnOutcome>(['complete', 'incomplete', 'failed', 'cancelled'])(
		'fires once after a %s turn, with no file and the turn summary',
		async (outcome) => {
			const manager = seeded(createMockPlugin(), [makeHook()]);
			manager.handleTurnEnd(turnEnd({ outcome, toolCallCount: 2, userMessage: 'fix it' }));
			await vi.advanceTimersByTimeAsync(150);

			expect(runs.contexts).toHaveLength(1);
			expect(runs.contexts[0]).toMatchObject({
				trigger: 'agent-turn-ended',
				filePath: '',
				fileName: '',
				turn: { outcome, turnCount: 1, toolCallCount: 2, sessionTitle: 'My chat', userMessage: 'fix it' },
			});
		}
	);

	it('fires for a chat-only turn with no tool calls', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd({ toolCallCount: 0 }));
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(1);
	});

	it('merges turns inside the debounce window: counts summed, the rest from the latest', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd({ outcome: 'failed', toolCallCount: 1, userMessage: 'first' }));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleTurnEnd(turnEnd({ outcome: 'complete', toolCallCount: 3, userMessage: 'second' }));
		await vi.advanceTimersByTimeAsync(150);

		expect(runs.contexts).toHaveLength(1);
		expect(runs.contexts[0].turn).toEqual({
			outcome: 'complete',
			turnCount: 2,
			toolCallCount: 4,
			sessionTitle: 'My chat',
			userMessage: 'second',
		});
	});

	it('drops a turn that ends while the previous fire is still running', async () => {
		let release!: () => void;
		runs.impl.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
		const manager = seeded(createMockPlugin(), [makeHook()]);

		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(1);

		release();
		await vi.advanceTimersByTimeAsync(0);
	});

	it('fires once when its own command starts another turn inside the cooldown (loop regression)', async () => {
		const plugin = createMockPlugin();
		const manager = seeded(plugin, [makeHook({ cooldownMs: 30_000 })]);
		// The command's side effect is another agent turn ending.
		runs.impl.mockImplementation(async () => {
			manager.handleTurnEnd(turnEnd());
		});

		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(1_000);
		expect(runs.contexts).toHaveLength(1);
	});

	it('applies maxRunsPerHour', async () => {
		const manager = seeded(createMockPlugin(), [makeHook({ maxRunsPerHour: 1 })]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(1);
	});

	it('does not fire when the hook is disabled before its debounce expires', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(50);
		(manager as any).hooks.set('turn-log', makeHook({ enabled: false }));
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(0);
	});

	it('does not fire when the hook is deleted before its debounce expires', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(50);
		(manager as any).hooks.delete('turn-log');
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(0);
	});

	it('drops the pending turn when the hook is deleted and re-created under the same slug', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(50);
		await manager.deleteHook('turn-log');
		(manager as any).hooks.set('turn-log', makeHook());
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(0);
	});

	it('fires with the current definition when the hook is edited inside the debounce window', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(50);
		(manager as any).hooks.set('turn-log', makeHook({ commandId: 'other:command' }));
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(1);
		expect(runs.contexts[0].hook.commandId).toBe('other:command');
	});

	it('skips paused, disabled and desktop-only-on-mobile hooks', async () => {
		const manager = seeded(createMockPlugin(), [
			makeHook({ slug: 'paused' }),
			makeHook({ slug: 'off', enabled: false }),
			makeHook({ slug: 'desktop', desktopOnly: true }),
		]);
		(manager as any).state = { paused: { pausedDueToErrors: true } };
		platform.isMobile = true;

		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(0);
	});

	it('never fires for an ephemeral (headless) session', async () => {
		const manager = seeded(createMockPlugin(), [makeHook()]);
		manager.handleTurnEnd(turnEnd({ ephemeral: true }));
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts).toHaveLength(0);
	});

	it('ignores turns for file-trigger hooks, and vault events for turn hooks', async () => {
		const manager = seeded(createMockPlugin(), [
			makeHook({ slug: 'file-hook', trigger: 'file-modified' }),
			makeHook({ slug: 'turn-hook' }),
		]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		expect(runs.contexts.map((c) => c.hook.slug)).toEqual(['turn-hook']);
	});

	it('labels the background run "<slug> → agent turn"', async () => {
		const plugin = createMockPlugin();
		const submit = vi.fn().mockReturnValue('bg-1');
		plugin.backgroundTaskManager = { submit };
		const manager = seeded(plugin, [makeHook()]);
		manager.handleTurnEnd(turnEnd());
		await vi.advanceTimersByTimeAsync(150);
		expect(submit).toHaveBeenCalledWith('lifecycle-hook', 'turn-log → agent turn', expect.any(Function));
	});
});

describe('HookManager agent-turn subscription and validation', () => {
	function pluginWithBus() {
		const plugin = createMockPlugin();
		const logger = { ...plugin.logger, child: () => logger };
		plugin.agentEventBus = new AgentEventBus(logger as any);
		return plugin;
	}

	it('subscribes to turnEnd only while a hook uses the trigger', async () => {
		const plugin = pluginWithBus();
		const bus = plugin.agentEventBus!;
		const manager = new HookManager(plugin as any);
		(manager as any).initialized = true;

		await manager.createHook({
			slug: 'file-hook',
			trigger: 'file-modified',
			action: 'command',
			commandId: 'a:b',
			prompt: '',
		});
		expect(bus.handlerCount('turnEnd')).toBe(0);

		await manager.createHook({
			slug: 'turn-hook',
			trigger: 'agent-turn-ended',
			action: 'command',
			commandId: 'a:b',
			prompt: '',
		});
		expect(bus.handlerCount('turnEnd')).toBe(1);

		manager.destroy();
		expect(bus.handlerCount('turnEnd')).toBe(0);
	});

	it.each(['summarize', 'rewrite'] as const)('rejects %s with the agent-turn trigger on create', async (action) => {
		const plugin = pluginWithBus();
		const manager = new HookManager(plugin as any);
		await expect(manager.createHook({ slug: 'bad', trigger: 'agent-turn-ended', action, prompt: 'x' })).rejects.toThrow(
			/can't run for trigger/
		);
		expect(plugin.app.vault.create).not.toHaveBeenCalled();
	});

	it.each(['summarize', 'rewrite'] as const)(
		'skips a hand-written %s hook on the agent-turn trigger',
		async (action) => {
			const plugin = pluginWithBus();
			const file = { path: 'gemini-scribe/Hooks/bad.md', basename: 'bad', extension: 'md' };
			plugin.app.metadataCache.getFileCache = vi
				.fn()
				.mockReturnValue({ frontmatter: { trigger: 'agent-turn-ended', action } });
			plugin.app.vault.read = vi.fn().mockResolvedValue('---\n---\nDo it');
			const manager = new HookManager(plugin as any);
			expect(await (manager as any).parseDefinitionFile(file)).toBeNull();
			expect(plugin.logger.warn).toHaveBeenCalled();
		}
	);

	// A turn has no file, so {fileName} would resolve to an empty name and
	// write a hidden `.md` (#1817).
	const FILE_NAME_OUTPUT = 'Hooks/Runs/{slug}/{fileName}.md';

	it('rejects {fileName} in the output path with the agent-turn trigger on create', async () => {
		const plugin = pluginWithBus();
		const manager = new HookManager(plugin as any);
		await expect(
			manager.createHook({
				slug: 'bad',
				trigger: 'agent-turn-ended',
				action: 'agent-task',
				prompt: 'Log the turn',
				outputPath: FILE_NAME_OUTPUT,
			})
		).rejects.toThrow(/can't use \{fileName\}/);
		expect(plugin.app.vault.create).not.toHaveBeenCalled();
	});

	it('accepts {fileName} in the output path with a file trigger', async () => {
		const plugin = pluginWithBus();
		const manager = new HookManager(plugin as any);
		await manager.createHook({
			slug: 'ok',
			trigger: 'file-modified',
			action: 'agent-task',
			prompt: 'Summarize it',
			outputPath: FILE_NAME_OUTPUT,
		});
		expect(plugin.app.vault.create).toHaveBeenCalled();
	});

	it('rejects an update that adds {fileName} to an agent-turn hook', async () => {
		const plugin = pluginWithBus();
		const hook = makeHook({ action: 'agent-task', prompt: 'Log the turn', commandId: undefined });
		plugin.app.vault.getAbstractFileByPath = vi
			.fn()
			.mockReturnValue(Object.assign(new TFile(), { path: hook.filePath }));
		const manager = seeded(plugin, [hook]);
		await expect(manager.updateHook(hook.slug, { outputPath: FILE_NAME_OUTPUT })).rejects.toThrow(
			/can't use \{fileName\}/
		);
		expect(plugin.app.vault.modify).not.toHaveBeenCalled();
		expect(manager.getHooks().find((h) => h.slug === hook.slug)?.outputPath).toBeUndefined();
	});

	it('skips a hand-written agent-turn hook whose output path uses {fileName}', async () => {
		const plugin = pluginWithBus();
		const file = { path: 'gemini-scribe/Hooks/bad.md', basename: 'bad', extension: 'md' };
		plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
			frontmatter: { trigger: 'agent-turn-ended', action: 'agent-task', outputPath: FILE_NAME_OUTPUT },
		});
		plugin.app.vault.read = vi.fn().mockResolvedValue('---\n---\nLog the turn');
		const manager = new HookManager(plugin as any);
		expect(await (manager as any).parseDefinitionFile(file)).toBeNull();
		expect(plugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('{fileName}'));
	});

	it('loads a hand-written command hook on the agent-turn trigger', async () => {
		const plugin = pluginWithBus();
		const file = { path: 'gemini-scribe/Hooks/commit.md', basename: 'commit', extension: 'md' };
		plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
			frontmatter: { trigger: 'agent-turn-ended', action: 'command', commandId: 'obsidian-git:commit' },
		});
		const manager = new HookManager(plugin as any);
		const hook = await (manager as any).parseDefinitionFile(file);
		expect(hook).toMatchObject({ slug: 'commit', trigger: 'agent-turn-ended', action: 'command' });
	});
});
