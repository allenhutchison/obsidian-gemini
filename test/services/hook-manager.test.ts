import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile as MockTFile } from 'obsidian';
import {
	HookManager,
	globToRegExp,
	matchesGlob,
	matchesFrontmatterFilter,
	renderPrompt,
	type Hook,
} from '../../src/services/hook-manager';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {
		path = '';
		name = '';
		basename = '';
		extension = '';
	},
	TFolder: class {},
	Platform: { isMobile: false },
}));

vi.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/skill-manager', () => ({
	findFrontmatterEndOffset: vi.fn().mockReturnValue(undefined),
}));

// Replace the runner so tests don't try to spin up agent sessions or hit the
// model API. The mock must be constructable (HookRunner is invoked with `new`),
// so we expose a class with a per-call `run` mock that tests can configure.
const { runnerRunMock } = vi.hoisted(() => ({
	runnerRunMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/hook-runner', () => ({
	HookRunner: class {
		// Plugin and ctx are unused — the run() mock is the single test seam.
		constructor(_plugin: unknown, _ctx: unknown) {}
		run = runnerRunMock;
	},
}));

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeFile(path: string, frontmatter?: Record<string, unknown>) {
	const file = new MockTFile() as unknown as MockTFile & {
		path: string;
		name: string;
		basename: string;
		extension: string;
		__fm?: Record<string, unknown>;
	};
	file.path = path;
	const lastSlash = path.lastIndexOf('/');
	file.name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
	const dotIdx = file.name.lastIndexOf('.');
	file.basename = dotIdx >= 0 ? file.name.slice(0, dotIdx) : file.name;
	file.extension = dotIdx >= 0 ? file.name.slice(dotIdx + 1) : '';
	file.__fm = frontmatter;
	return file as unknown as MockTFile;
}

function createMockPlugin(overrides: Record<string, any> = {}) {
	const stateStore: Record<string, string> = {};
	const fmCache = new Map<string, Record<string, unknown>>();

	return {
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
		settings: { historyFolder: 'gemini-scribe', hooksEnabled: true },
		registerEvent: vi.fn(),
		app: {
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([]),
				on: vi.fn().mockReturnValue({ __ref: true }),
				off: vi.fn(),
				offref: vi.fn(),
				read: vi.fn().mockResolvedValue(''),
				adapter: {
					exists: vi.fn().mockResolvedValue(false),
					read: vi.fn().mockImplementation(async (path: string) => stateStore[path] ?? '{}'),
					write: vi.fn().mockImplementation(async (path: string, content: string) => {
						stateStore[path] = content;
					}),
				},
			},
			metadataCache: {
				getFileCache: vi.fn().mockImplementation((file: any) => ({ frontmatter: file?.__fm ?? null })),
				on: vi.fn(),
				off: vi.fn(),
			},
		},
		__stateStore: stateStore,
		__fmCache: fmCache,
		...overrides,
	};
}

function makeHook(overrides: Partial<Hook> = {}): Hook {
	return {
		slug: 'test-hook',
		trigger: 'file-modified',
		debounceMs: 100,
		cooldownMs: 0,
		action: 'agent-task',
		enabledTools: ['read_only'],
		enabledSkills: [],
		enabled: true,
		desktopOnly: false,
		prompt: 'Process {{filePath}}',
		filePath: 'gemini-scribe/Hooks/test-hook.md',
		...overrides,
	};
}

// Drive the manager directly without the public initialize() which depends on
// folder/state setup. Tests exercise dispatch by seeding hooks into the
// internal map and invoking handleEvent() — the entry point that vault
// listeners feed into.
function withSeededHooks(plugin: any, hooks: Hook[]): HookManager {
	const manager = new HookManager(plugin);
	(manager as any).hooks = new Map(hooks.map((h) => [h.slug, h]));
	(manager as any).initialized = true;
	return manager;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('globToRegExp', () => {
	it('matches exact paths literally', () => {
		expect(globToRegExp('Daily/2026-05-04.md').test('Daily/2026-05-04.md')).toBe(true);
		expect(globToRegExp('Daily/2026-05-04.md').test('Daily/2026-05-05.md')).toBe(false);
	});

	it('* matches a single segment', () => {
		expect(globToRegExp('Daily/*.md').test('Daily/2026-05-04.md')).toBe(true);
		expect(globToRegExp('Daily/*.md').test('Daily/sub/2026-05-04.md')).toBe(false);
	});

	it('** matches across path separators', () => {
		expect(globToRegExp('Daily/**/*.md').test('Daily/2026/05/04.md')).toBe(true);
		expect(globToRegExp('**/notes.md').test('a/b/c/notes.md')).toBe(true);
	});

	it('escapes regex metacharacters in literals', () => {
		expect(globToRegExp('a.b+c.md').test('a.b+c.md')).toBe(true);
		expect(globToRegExp('a.b+c.md').test('aXbYc.md')).toBe(false);
	});
});

describe('matchesGlob', () => {
	it('returns true when no glob is provided', () => {
		expect(matchesGlob('any/path.md', undefined)).toBe(true);
	});

	it('applies the compiled glob', () => {
		expect(matchesGlob('Daily/2026-05-04.md', 'Daily/*.md')).toBe(true);
		expect(matchesGlob('Notes/2026-05-04.md', 'Daily/*.md')).toBe(false);
	});
});

describe('matchesFrontmatterFilter', () => {
	it('passes when no filter is provided', () => {
		expect(matchesFrontmatterFilter({ x: 1 }, undefined)).toBe(true);
	});

	it('rejects when frontmatter is missing but filter requires keys', () => {
		expect(matchesFrontmatterFilter(undefined, { x: 1 })).toBe(false);
	});

	it('matches every key/value', () => {
		expect(matchesFrontmatterFilter({ a: 1, b: 'x' }, { a: 1 })).toBe(true);
		expect(matchesFrontmatterFilter({ a: 2 }, { a: 1 })).toBe(false);
	});
});

describe('renderPrompt', () => {
	it('substitutes registered variables', () => {
		expect(renderPrompt('Hello {{filePath}}', { filePath: 'foo.md' })).toBe('Hello foo.md');
	});

	it('replaces unknown variables with empty string', () => {
		expect(renderPrompt('Hi {{missing}} done', { filePath: 'foo.md' })).toBe('Hi  done');
	});

	it('handles whitespace inside the braces', () => {
		expect(renderPrompt('A {{ filePath }} B', { filePath: 'x' })).toBe('A x B');
	});
});

// ─── Manager dispatch ───────────────────────────────────────────────────────

describe('HookManager dispatch', () => {
	beforeEach(() => {
		runnerRunMock.mockClear();
		runnerRunMock.mockResolvedValue(undefined);
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires the runner for a matching event after the debounce window', async () => {
		const plugin = createMockPlugin();
		const hook = makeHook({ debounceMs: 100 });
		const manager = withSeededHooks(plugin, [hook]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		expect(runnerRunMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(150);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);
	});

	it('coalesces rapid events for the same file into one fire', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 100 })]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(150);

		expect(runnerRunMock).toHaveBeenCalledTimes(1);
	});

	it('does not fire when settings.hooksEnabled is false', async () => {
		const plugin = createMockPlugin();
		plugin.settings.hooksEnabled = false;
		const manager = withSeededHooks(plugin, [makeHook()]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('does not fire when the hook is disabled', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ enabled: false })]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('skips when the trigger type does not match', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ trigger: 'file-created' })]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('always excludes the plugin state folder', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook()]);

		manager.handleEvent('file-modified', makeFile('gemini-scribe/Hooks/Runs/test-hook/2026-05-04.md'));
		manager.handleEvent('file-modified', makeFile('gemini-scribe/anything.md'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('always excludes the .obsidian folder', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook()]);

		manager.handleEvent('file-modified', makeFile('.obsidian/workspace.json'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('respects pathGlob filters', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ pathGlob: 'Daily/*.md' })]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		manager.handleEvent('file-modified', makeFile('Daily/2026-05-04.md'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);
	});

	it('respects frontmatterFilter', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ frontmatterFilter: { 'auto-summarize': true } })]);

		manager.handleEvent('file-modified', makeFile('Notes/no-fm.md'));
		manager.handleEvent('file-modified', makeFile('Notes/wrong.md', { 'auto-summarize': false }));
		manager.handleEvent('file-modified', makeFile('Notes/match.md', { 'auto-summarize': true }));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);
	});

	it('respects per-hour rate limit', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 10, maxRunsPerHour: 2 })]);

		// Fire three events on three different files inside the same hour window.
		// The cooldown is 0 for this hook so back-to-back fires aren't suppressed,
		// but the hourly counter is global per hook.
		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('b.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('c.md'));
		await vi.advanceTimersByTimeAsync(50);

		expect(runnerRunMock).toHaveBeenCalledTimes(2);
	});

	it('suppresses re-fires within the cooldown window', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 10, cooldownMs: 5_000 })]);

		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);

		// Within cooldown window — should be suppressed.
		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);

		// After cooldown elapses — should fire again.
		await vi.advanceTimersByTimeAsync(6_000);
		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		expect(runnerRunMock).toHaveBeenCalledTimes(2);
	});

	it('auto-pauses the hook after the hard loop ceiling is hit', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 1, cooldownMs: 0 })]);

		// 5 successful fires should saturate the recentFires window. The 6th
		// event lands after recordFire pushes the 5th timestamp, and the fireNow
		// guard auto-pauses before the runner is invoked.
		for (let i = 0; i < 7; i++) {
			manager.handleEvent('file-modified', makeFile(`file-${i}.md`));
			await vi.advanceTimersByTimeAsync(5);
		}

		const state = manager.getStateSnapshot()['test-hook'];
		expect(state?.pausedDueToErrors).toBe(true);
	});

	it('records pausedDueToErrors after 3 consecutive failures', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 5, cooldownMs: 0 })]);

		runnerRunMock.mockRejectedValue(new Error('boom'));

		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('b.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('c.md'));
		await vi.advanceTimersByTimeAsync(50);

		const state = manager.getStateSnapshot()['test-hook'];
		expect(state?.consecutiveFailures).toBe(3);
		expect(state?.pausedDueToErrors).toBe(true);
		expect(state?.lastError).toContain('boom');
	});

	it('skips dispatch entirely when the hook is paused', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook()]);

		(manager as any).state['test-hook'] = { pausedDueToErrors: true };

		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('drops re-entrant events while a fire is in flight', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 10 })]);

		// Block the runner so the inflight slot stays occupied while we send
		// more events for the same (hook, file).
		let resolveRunner!: () => void;
		runnerRunMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveRunner = resolve;
				})
		);

		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(20);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);

		manager.handleEvent('file-modified', makeFile('a.md'));
		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		expect(runnerRunMock).toHaveBeenCalledTimes(1);

		resolveRunner();
		await vi.advanceTimersByTimeAsync(0);
	});
});
