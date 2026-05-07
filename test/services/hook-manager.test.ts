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
		// backgroundTaskManager is optional; when absent the manager's
		// runDirect fallback path keeps tests deterministic. Tests that need
		// to exercise the bg-manager path inject one explicitly.
		backgroundTaskManager: undefined as any,
		app: {
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([]),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				on: vi.fn().mockReturnValue({ __ref: true }),
				off: vi.fn(),
				offref: vi.fn(),
				read: vi.fn().mockResolvedValue(''),
				create: vi.fn().mockResolvedValue(undefined),
				modify: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
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

/**
 * BackgroundTaskManager mock that resolves submit() inline so tests don't
 * need a separate sync point to await the bg-manager path. Records every
 * submission for assertion. Pass `runImmediately: false` to capture the work
 * function without invoking it (lets tests assert on cancellation behavior).
 */
function createMockBackgroundTaskManager(opts: { runImmediately?: boolean; cancelImmediately?: boolean } = {}) {
	const submissions: { type: string; label: string; work: (isCancelled: () => boolean) => Promise<unknown> }[] = [];
	const runImmediately = opts.runImmediately ?? true;
	const cancelImmediately = opts.cancelImmediately ?? false;

	const submit = vi
		.fn()
		.mockImplementation((type: string, label: string, work: (isCancelled: () => boolean) => Promise<unknown>) => {
			submissions.push({ type, label, work });
			if (runImmediately) {
				void work(() => cancelImmediately);
			}
			return `bg-${submissions.length}`;
		});

	return { submit, __submissions: submissions };
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

describe('HookManager CRUD', () => {
	function createPluginWithVaultStore() {
		const files = new Map<string, string>();
		const plugin = createMockPlugin();
		plugin.app.vault.create = vi.fn().mockImplementation(async (path: string, content: string) => {
			if (files.has(path)) throw new Error('File already exists.');
			files.set(path, content);
			return { path };
		});
		plugin.app.vault.modify = vi.fn().mockImplementation(async (file: any, content: string) => {
			files.set(file.path, content);
		});
		plugin.app.vault.delete = vi.fn().mockImplementation(async (file: any) => {
			files.delete(file.path);
		});
		plugin.app.vault.getAbstractFileByPath = vi
			.fn()
			.mockImplementation((path: string) => (files.has(path) ? { path } : null));
		(plugin as any).__files = files;
		return plugin as any;
	}

	function newManager(plugin: any): HookManager {
		const manager = new HookManager(plugin);
		(manager as any).initialized = true;
		return manager;
	}

	const baseCreateParams = {
		slug: 'summarise',
		trigger: 'file-modified' as const,
		action: 'agent-task' as const,
		prompt: 'Summarise {{filePath}}.',
	};

	it('rejects empty slugs', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await expect(manager.createHook({ ...baseCreateParams, slug: '   ' })).rejects.toThrow(/empty/);
	});

	it('rejects slugs with disallowed characters', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await expect(manager.createHook({ ...baseCreateParams, slug: 'Bad Slug' })).rejects.toThrow(/lowercase/);
		await expect(manager.createHook({ ...baseCreateParams, slug: '-leading' })).rejects.toThrow(/lowercase/);
		await expect(manager.createHook({ ...baseCreateParams, slug: 'a--b' })).rejects.toThrow(/lowercase/);
	});

	it('rejects duplicate slugs', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook(baseCreateParams);
		await expect(manager.createHook(baseCreateParams)).rejects.toThrow(/already exists/);
	});

	it('writes a minimal hook file with only required fields', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook(baseCreateParams);

		const filePath = 'gemini-scribe/Hooks/summarise.md';
		expect(plugin.__files.has(filePath)).toBe(true);
		const content = plugin.__files.get(filePath);
		expect(content).toContain("trigger: 'file-modified'");
		expect(content).toContain("action: 'agent-task'");
		expect(content).toContain('Summarise {{filePath}}');
		// Defaults should NOT be serialised — keeps the file clean.
		expect(content).not.toContain('debounceMs');
		expect(content).not.toContain('cooldownMs');
		expect(content).not.toContain('enabled:');
		expect(content).not.toContain('desktopOnly:');
	});

	it('serialises non-default optional fields', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook({
			...baseCreateParams,
			pathGlob: 'Daily/**/*.md',
			debounceMs: 7500,
			cooldownMs: 60_000,
			maxRunsPerHour: 12,
			enabledTools: ['read_only'],
			enabledSkills: ['index-files'],
			model: 'gemini-2.5-flash-lite',
			outputPath: 'Hooks/Runs/{slug}/{date}.md',
			enabled: false,
			desktopOnly: false,
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/summarise.md');
		expect(content).toContain('pathGlob: "Daily/**/*.md"');
		expect(content).toContain('debounceMs: 7500');
		expect(content).toContain('cooldownMs: 60000');
		expect(content).toContain('maxRunsPerHour: 12');
		expect(content).toContain('enabledTools:');
		expect(content).toContain('  - read_only');
		expect(content).toContain('enabledSkills:');
		expect(content).toContain('  - index-files');
		expect(content).toContain('model: "gemini-2.5-flash-lite"');
		expect(content).toContain('outputPath: "Hooks/Runs/{slug}/{date}.md"');
		expect(content).toContain('enabled: false');
		expect(content).toContain('desktopOnly: false');
	});

	it('serialises focusFile only when the user opts in (default false stays out of the file)', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);

		// Default: focusFile not provided → serialized file omits the line.
		await manager.createHook({
			...baseCreateParams,
			slug: 'no-focus',
			action: 'command',
			commandId: 'editor:save-file',
		});
		const noFocusContent = plugin.__files.get('gemini-scribe/Hooks/no-focus.md');
		expect(noFocusContent).not.toContain('focusFile');

		// Opted in: file gains the line.
		await manager.createHook({
			...baseCreateParams,
			slug: 'with-focus',
			action: 'command',
			commandId: 'editor:save-file',
			focusFile: true,
		});
		const focusContent = plugin.__files.get('gemini-scribe/Hooks/with-focus.md');
		expect(focusContent).toContain('focusFile: true');

		// In-memory hook reflects the same.
		const hooks = manager.getHooks();
		expect(hooks.find((h) => h.slug === 'no-focus')?.focusFile).toBeUndefined();
		expect(hooks.find((h) => h.slug === 'with-focus')?.focusFile).toBe(true);
	});

	it('updateHook rewrites the file with merged values', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook(baseCreateParams);
		await manager.updateHook('summarise', {
			prompt: 'Updated prompt for {{filePath}}.',
			model: 'gemini-2.5-pro',
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/summarise.md');
		expect(content).toContain('Updated prompt for {{filePath}}');
		expect(content).toContain('model: "gemini-2.5-pro"');

		const hook = manager.getHooks().find((h) => h.slug === 'summarise');
		expect(hook?.model).toBe('gemini-2.5-pro');
		expect(hook?.prompt).toContain('Updated prompt');
	});

	it('updateHook throws when the hook is unknown', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await expect(manager.updateHook('nope', { enabled: false })).rejects.toThrow(/not found/);
	});

	it('toggleHook flips the enabled flag and rewrites the file', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook(baseCreateParams);
		await manager.toggleHook('summarise', false);

		const hook = manager.getHooks().find((h) => h.slug === 'summarise');
		expect(hook?.enabled).toBe(false);
		const content = plugin.__files.get('gemini-scribe/Hooks/summarise.md');
		expect(content).toContain('enabled: false');
	});

	it('deleteHook removes the file and clears state', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook(baseCreateParams);
		// Plant a state entry so we can verify it gets cleaned up.
		(manager as any).state['summarise'] = { lastError: 'old' };

		await manager.deleteHook('summarise');

		expect(plugin.__files.has('gemini-scribe/Hooks/summarise.md')).toBe(false);
		expect(manager.getHooks().some((h) => h.slug === 'summarise')).toBe(false);
		expect(manager.getStateSnapshot()['summarise']).toBeUndefined();
	});

	it('deleteHook throws when the hook is unknown', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await expect(manager.deleteHook('nope')).rejects.toThrow(/not found/);
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

	it('submits matching fires through BackgroundTaskManager when one is available', async () => {
		const bg = createMockBackgroundTaskManager();
		const plugin = createMockPlugin({ backgroundTaskManager: bg });
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 10 })]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(50);

		expect(bg.submit).toHaveBeenCalledTimes(1);
		const [type, label] = bg.submit.mock.calls[0];
		expect(type).toBe('lifecycle-hook');
		expect(label).toContain('test-hook');
		expect(label).toContain('foo.md');
		// The runner mock fires inside the bg-manager work function, not in
		// runDirect, so the runner-was-called assertion still proves the
		// submitted work executed.
		expect(runnerRunMock).toHaveBeenCalledTimes(1);
	});

	it('propagates cancellation from BackgroundTaskManager to the runner', async () => {
		const bg = createMockBackgroundTaskManager({ cancelImmediately: true });
		const plugin = createMockPlugin({ backgroundTaskManager: bg });
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 10 })]);

		// Capture the isCancelled predicate handed to the runner.
		let observedCancelled = false;
		runnerRunMock.mockImplementation(async (isCancelled: () => boolean) => {
			observedCancelled = isCancelled();
			return undefined;
		});

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(50);

		expect(runnerRunMock).toHaveBeenCalledTimes(1);
		expect(observedCancelled).toBe(true);
	});

	it('falls back to direct execution when no BackgroundTaskManager is wired', async () => {
		const plugin = createMockPlugin(); // backgroundTaskManager undefined
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 10 })]);

		manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
		await vi.advanceTimersByTimeAsync(50);

		// Runner still ran via runDirect — this is the safety-net path used
		// in early plugin lifecycle and in tests that don't provision a bg
		// manager.
		expect(runnerRunMock).toHaveBeenCalledTimes(1);
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
