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
import { PolicyPreset } from '../../src/types/tool-policy';

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
		toolPolicy: { preset: PolicyPreset.READ_ONLY },
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
			toolPolicy: { preset: PolicyPreset.READ_ONLY },
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
		expect(content).toContain('toolPolicy:');
		expect(content).toContain('preset: read_only');
		// Regression guard: the serializer must not also emit the legacy
		// `enabledTools:` key. Dual-writing both shapes would re-introduce
		// the pre-refactor confusion where readers had to pick which one to
		// trust on subsequent loads.
		expect(content).not.toContain('enabledTools');
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

// ─── handleEvent additional filter paths ────────────────────────────────────

describe('HookManager handleEvent – additional filter paths', () => {
	beforeEach(() => {
		runnerRunMock.mockClear();
		runnerRunMock.mockResolvedValue(undefined);
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('silently drops non-TFile objects', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook()]);

		// Pass a plain object that is not an instanceof TFile.
		const notAFile = { path: 'Notes/foo.md', name: 'foo.md' };
		manager.handleEvent('file-modified', notAFile as any);
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});

	it('skips desktopOnly hooks when Platform.isMobile is true', async () => {
		const { Platform } = await import('obsidian');
		const originalIsMobile = Platform.isMobile;
		try {
			(Platform as any).isMobile = true;

			const plugin = createMockPlugin();
			const manager = withSeededHooks(plugin, [makeHook({ desktopOnly: true })]);

			manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
			await vi.advanceTimersByTimeAsync(500);
			expect(runnerRunMock).not.toHaveBeenCalled();
		} finally {
			(Platform as any).isMobile = originalIsMobile;
		}
	});

	it('rejects frontmatterFilter on a non-.md file', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ frontmatterFilter: { type: 'journal' } })]);

		// A .txt file can never pass the frontmatter filter because
		// passesFrontmatterFilter returns false for extension !== 'md'.
		manager.handleEvent('file-modified', makeFile('Notes/data.txt'));
		await vi.advanceTimersByTimeAsync(500);
		expect(runnerRunMock).not.toHaveBeenCalled();
	});
});

// ─── serializeHook edge cases ───────────────────────────────────────────────

describe('HookManager serializeHook – edge cases via createHook', () => {
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

	it('serialises frontmatterFilter as a YAML map', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook({
			slug: 'fm-hook',
			trigger: 'file-modified',
			action: 'agent-task',
			prompt: 'Do stuff',
			frontmatterFilter: { type: 'journal' },
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/fm-hook.md');
		expect(content).toContain('frontmatterFilter:');
		expect(content).toContain('  type: "journal"');
	});

	it('serialises commandId line', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook({
			slug: 'cmd-hook',
			trigger: 'file-modified',
			action: 'command',
			prompt: '',
			commandId: 'editor:save-file',
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/cmd-hook.md');
		expect(content).toContain('commandId: "editor:save-file"');
	});

	it('does NOT serialise maxRunsPerHour when set to 0', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook({
			slug: 'no-rate',
			trigger: 'file-modified',
			action: 'agent-task',
			prompt: 'Do stuff',
			maxRunsPerHour: 0,
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/no-rate.md');
		expect(content).not.toContain('maxRunsPerHour');
	});

	it('does NOT serialise debounceMs when set to default (5000)', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook({
			slug: 'default-debounce',
			trigger: 'file-modified',
			action: 'agent-task',
			prompt: 'Do stuff',
			debounceMs: 5000,
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/default-debounce.md');
		expect(content).not.toContain('debounceMs');
	});

	it('does NOT serialise cooldownMs when set to default (30000)', async () => {
		const plugin = createPluginWithVaultStore();
		const manager = newManager(plugin);
		await manager.createHook({
			slug: 'default-cooldown',
			trigger: 'file-modified',
			action: 'agent-task',
			prompt: 'Do stuff',
			cooldownMs: 30_000,
		});

		const content = plugin.__files.get('gemini-scribe/Hooks/default-cooldown.md');
		expect(content).not.toContain('cooldownMs');
	});
});

// ─── initialize() lifecycle ─────────────────────────────────────────────────

describe('HookManager initialize() lifecycle', () => {
	it('returns immediately when already initialized and no refresh', async () => {
		const plugin = createMockPlugin();
		const manager = new HookManager(plugin as any);

		// First init
		await manager.initialize();

		// Second call without refresh — should be a no-op.
		const createCallsBefore = plugin.app.vault.create.mock.calls.length;
		await manager.initialize();
		// No additional folder creation calls should have been made.
		expect(plugin.app.vault.create.mock.calls.length).toBe(createCallsBefore);
	});

	it('clears hooks/state and sets initialized when hooksEnabled is false', async () => {
		const plugin = createMockPlugin();
		plugin.settings.hooksEnabled = false;
		const manager = new HookManager(plugin as any);

		await manager.initialize();

		expect((manager as any).initialized).toBe(true);
		expect(manager.getHooks()).toHaveLength(0);
		expect(manager.getStateSnapshot()).toEqual({});
		expect(plugin.logger.log).toHaveBeenCalledWith(expect.stringContaining('Hooks disabled'));
	});

	it('tears down old handlers and re-initializes with refresh: true', async () => {
		const plugin = createMockPlugin();
		const manager = new HookManager(plugin as any);

		await manager.initialize();
		const firstVaultOnCalls = plugin.app.vault.on.mock.calls.length;

		// Re-initialize with refresh. Should register new handlers.
		await manager.initialize({ refresh: true });
		expect(plugin.app.vault.on.mock.calls.length).toBeGreaterThan(firstVaultOnCalls);
	});
});

// ─── destroy() lifecycle ────────────────────────────────────────────────────

describe('HookManager destroy() lifecycle', () => {
	it('clears hooks, state, inflight, debounce timers, and sets initialized to false', async () => {
		const plugin = createMockPlugin();
		const manager = new HookManager(plugin as any);
		await manager.initialize();

		// Seed some internal state to verify it gets cleaned.
		(manager as any).inflight.add('test-hook::a.md');
		(manager as any).state = { 'test-hook': { consecutiveFailures: 2 } };

		manager.destroy();

		expect((manager as any).initialized).toBe(false);
		expect(manager.getHooks()).toHaveLength(0);
		expect(manager.getStateSnapshot()).toEqual({});
		expect((manager as any).inflight.size).toBe(0);
		expect((manager as any).debounceTimers.size).toBe(0);
		expect(plugin.logger.log).toHaveBeenCalledWith(expect.stringContaining('Destroyed'));
	});
});

// ─── resetHook() state management ───────────────────────────────────────────

describe('HookManager resetHook()', () => {
	it('clears lastError, consecutiveFailures, and pausedDueToErrors', async () => {
		const plugin = createMockPlugin();
		const manager = new HookManager(plugin as any);
		(manager as any).initialized = true;
		(manager as any).state = {
			'my-hook': {
				lastError: 'something broke',
				consecutiveFailures: 3,
				pausedDueToErrors: true,
			},
		};

		await manager.resetHook('my-hook');

		const state = manager.getStateSnapshot()['my-hook'];
		expect(state.lastError).toBeUndefined();
		expect(state.consecutiveFailures).toBe(0);
		expect(state.pausedDueToErrors).toBe(false);
	});

	it('is a no-op when the slug does not exist in state', async () => {
		const plugin = createMockPlugin();
		const manager = new HookManager(plugin as any);
		(manager as any).initialized = true;
		(manager as any).state = {};

		// Should not throw.
		await manager.resetHook('nonexistent');
		expect(manager.getStateSnapshot()).toEqual({});
	});

	it('allows a hook to fire again after reset', async () => {
		vi.useFakeTimers();
		try {
			runnerRunMock.mockClear();
			runnerRunMock.mockResolvedValue(undefined);

			const plugin = createMockPlugin();
			const hook = makeHook({ debounceMs: 10, cooldownMs: 0 });
			const manager = withSeededHooks(plugin, [hook]);

			// Manually pause the hook via state.
			(manager as any).state['test-hook'] = { pausedDueToErrors: true };

			// Event is suppressed while paused.
			manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
			await vi.advanceTimersByTimeAsync(50);
			expect(runnerRunMock).not.toHaveBeenCalled();

			// Reset the hook.
			await manager.resetHook('test-hook');

			// Now it should fire.
			manager.handleEvent('file-modified', makeFile('Notes/foo.md'));
			await vi.advanceTimersByTimeAsync(50);
			expect(runnerRunMock).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

// ─── recordSuccess resets failure state ─────────────────────────────────────

describe('HookManager recordSuccess – failure state reset', () => {
	beforeEach(() => {
		runnerRunMock.mockClear();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('resets consecutiveFailures to 0 after a success following failures', async () => {
		const plugin = createMockPlugin();
		const hook = makeHook({ debounceMs: 5, cooldownMs: 0 });
		const manager = withSeededHooks(plugin, [hook]);

		// Two failures.
		runnerRunMock.mockRejectedValueOnce(new Error('fail1'));
		runnerRunMock.mockRejectedValueOnce(new Error('fail2'));
		// Then a success.
		runnerRunMock.mockResolvedValueOnce(undefined);

		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('b.md'));
		await vi.advanceTimersByTimeAsync(50);
		manager.handleEvent('file-modified', makeFile('c.md'));
		await vi.advanceTimersByTimeAsync(50);

		const state = manager.getStateSnapshot()['test-hook'];
		expect(state.consecutiveFailures).toBe(0);
		expect(state.lastError).toBeUndefined();
		expect(state.pausedDueToErrors).toBe(false);
	});
});

// ─── State persistence (loadState/saveState) ────────────────────────────────

describe('HookManager state persistence', () => {
	it('starts with empty state when state file does not exist', async () => {
		const plugin = createMockPlugin();
		plugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(false);
		const manager = new HookManager(plugin as any);

		await manager.initialize();

		expect(manager.getStateSnapshot()).toEqual({});
	});

	it('starts fresh when state file has corrupt JSON', async () => {
		const plugin = createMockPlugin();
		plugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(true);
		plugin.app.vault.adapter.read = vi.fn().mockResolvedValue('not valid json {{{');
		const manager = new HookManager(plugin as any);

		await manager.initialize();

		expect(manager.getStateSnapshot()).toEqual({});
		expect(plugin.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load state'), expect.anything());
	});
});

// ─── updateHook() file not found edge case ──────────────────────────────────

describe('HookManager updateHook – file not found', () => {
	it('throws "Hook file not found" when the vault file was deleted externally', async () => {
		const plugin = createMockPlugin();
		// getAbstractFileByPath returns null — file was deleted from vault.
		plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

		const manager = new HookManager(plugin as any);
		(manager as any).initialized = true;
		// Seed the hook in memory so the slug lookup succeeds.
		(manager as any).hooks.set('orphan', makeHook({ slug: 'orphan', filePath: 'gemini-scribe/Hooks/orphan.md' }));

		await expect(manager.updateHook('orphan', { prompt: 'new prompt' })).rejects.toThrow(/Hook file not found/);
	});
});

// ─── deleteHook() when file already deleted ─────────────────────────────────

describe('HookManager deleteHook – file already deleted from vault', () => {
	it('clears hook from map and state even when getAbstractFileByPath returns null', async () => {
		const plugin = createMockPlugin();
		plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

		const manager = new HookManager(plugin as any);
		(manager as any).initialized = true;
		(manager as any).hooks.set('gone', makeHook({ slug: 'gone', filePath: 'gemini-scribe/Hooks/gone.md' }));
		(manager as any).state['gone'] = { lastError: 'stale' };

		await manager.deleteHook('gone');

		expect(manager.getHooks().find((h) => h.slug === 'gone')).toBeUndefined();
		expect(manager.getStateSnapshot()['gone']).toBeUndefined();
		// vault.delete should NOT have been called since getAbstractFileByPath returned null.
		expect(plugin.app.vault.delete).not.toHaveBeenCalled();
	});
});

// ─── Non-Error recorded as failure message ──────────────────────────────────

describe('HookManager recordFailure – non-Error thrown', () => {
	beforeEach(() => {
		runnerRunMock.mockClear();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('stores the string representation when the runner throws a string', async () => {
		const plugin = createMockPlugin();
		const manager = withSeededHooks(plugin, [makeHook({ debounceMs: 5, cooldownMs: 0 })]);

		runnerRunMock.mockRejectedValue('string error message');

		manager.handleEvent('file-modified', makeFile('a.md'));
		await vi.advanceTimersByTimeAsync(50);

		const state = manager.getStateSnapshot()['test-hook'];
		expect(state.lastError).toBe('string error message');
		expect(state.consecutiveFailures).toBe(1);
	});
});

// ─── Discovery / parseHookFile via initialize() ────────────────────────────

describe('HookManager discoverHooks via initialize()', () => {
	function makeDiscoveryPlugin(
		hookFiles: { path: string; basename: string; frontmatter: Record<string, unknown> | null; body: string }[],
		stateOverrides: Record<string, any> = {}
	) {
		const plugin = createMockPlugin();

		// Build TFile-like objects for getMarkdownFiles().
		const mdFiles = hookFiles.map((hf) => {
			const f = new MockTFile() as any;
			f.path = hf.path;
			const lastSlash = hf.path.lastIndexOf('/');
			f.name = lastSlash >= 0 ? hf.path.slice(lastSlash + 1) : hf.path;
			f.basename = hf.basename;
			f.extension = 'md';
			return f;
		});

		plugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue(mdFiles);

		// getFileCache returns frontmatter for each file.
		plugin.app.metadataCache.getFileCache = vi.fn().mockImplementation((file: any) => {
			const hf = hookFiles.find((h) => h.path === file.path);
			if (!hf || !hf.frontmatter) return null;
			return { frontmatter: hf.frontmatter };
		});

		// vault.read returns the body content.
		plugin.app.vault.read = vi.fn().mockImplementation(async (file: any) => {
			const hf = hookFiles.find((h) => h.path === file.path);
			return hf?.body ?? '';
		});

		// Pre-seed state if needed.
		if (Object.keys(stateOverrides).length > 0) {
			plugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(true);
			plugin.app.vault.adapter.read = vi.fn().mockResolvedValue(JSON.stringify(stateOverrides));
		}

		return plugin;
	}

	it('discovers a valid hook file and loads it into the hooks map', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/daily-summary.md',
				basename: 'daily-summary',
				frontmatter: {
					trigger: 'file-modified',
					action: 'agent-task',
					pathGlob: 'Daily/*.md',
					debounceMs: 3000,
					maxRunsPerHour: 10,
					cooldownMs: 60000,
					model: 'gemini-2.5-flash',
					outputPath: 'Runs/{slug}/{date}.md',
					enabled: true,
					desktopOnly: false,
					enabledSkills: ['index-files'],
					frontmatterFilter: { type: 'journal' },
					focusFile: true,
				},
				body: '---\ntrigger: file-modified\n---\nSummarise {{filePath}}',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();

		const hooks = manager.getHooks();
		expect(hooks).toHaveLength(1);
		const hook = hooks[0];
		expect(hook.slug).toBe('daily-summary');
		expect(hook.trigger).toBe('file-modified');
		expect(hook.action).toBe('agent-task');
		expect(hook.pathGlob).toBe('Daily/*.md');
		expect(hook.debounceMs).toBe(3000);
		expect(hook.maxRunsPerHour).toBe(10);
		expect(hook.cooldownMs).toBe(60000);
		expect(hook.model).toBe('gemini-2.5-flash');
		expect(hook.enabledSkills).toEqual(['index-files']);
		expect(hook.frontmatterFilter).toEqual({ type: 'journal' });
		expect(hook.desktopOnly).toBe(false);
		expect(hook.focusFile).toBe(true);
	});

	it('skips files without frontmatter', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/no-fm.md',
				basename: 'no-fm',
				frontmatter: null,
				body: 'Just text',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		expect(manager.getHooks()).toHaveLength(0);
	});

	it('skips files with an invalid trigger', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/bad-trigger.md',
				basename: 'bad-trigger',
				frontmatter: { trigger: 'invalid-trigger', action: 'agent-task' },
				body: 'Some prompt',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		expect(manager.getHooks()).toHaveLength(0);
	});

	it('skips files with an invalid action', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/bad-action.md',
				basename: 'bad-action',
				frontmatter: { trigger: 'file-modified', action: 'invalid-action' },
				body: 'Some prompt',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		expect(manager.getHooks()).toHaveLength(0);
	});

	it('skips agent-task hooks with no prompt body', async () => {
		const { findFrontmatterEndOffset } = await import('../../src/services/skill-manager');
		(findFrontmatterEndOffset as any).mockReturnValueOnce(0);

		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/empty-body.md',
				basename: 'empty-body',
				frontmatter: { trigger: 'file-modified', action: 'agent-task' },
				body: '',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		expect(manager.getHooks()).toHaveLength(0);
	});

	it('skips command hooks without commandId', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/no-cmd.md',
				basename: 'no-cmd',
				frontmatter: { trigger: 'file-modified', action: 'command' },
				body: '',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		expect(manager.getHooks()).toHaveLength(0);
	});

	it('parses command hooks with commandId', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/save-cmd.md',
				basename: 'save-cmd',
				frontmatter: {
					trigger: 'file-modified',
					action: 'command',
					commandId: 'editor:save-file',
				},
				body: '',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		const hooks = manager.getHooks();
		expect(hooks).toHaveLength(1);
		expect(hooks[0].commandId).toBe('editor:save-file');
		expect(hooks[0].action).toBe('command');
	});

	it('prunes orphaned state entries whose hook file no longer exists', async () => {
		const plugin = makeDiscoveryPlugin(
			[
				{
					path: 'gemini-scribe/Hooks/still-here.md',
					basename: 'still-here',
					frontmatter: { trigger: 'file-modified', action: 'summarize' },
					body: '',
				},
			],
			{
				'still-here': { consecutiveFailures: 1 },
				'deleted-hook': { lastError: 'stale state' },
			}
		);

		const manager = new HookManager(plugin as any);
		await manager.initialize();

		const state = manager.getStateSnapshot();
		expect(state['still-here']).toBeDefined();
		expect(state['deleted-hook']).toBeUndefined();
	});

	it('excludes files inside Runs/ subfolder', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/Runs/some-hook/2026-05-14.md',
				basename: '2026-05-14',
				frontmatter: { trigger: 'file-modified', action: 'agent-task' },
				body: 'Do things',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();
		// The file is under Runs/, so it should be filtered out by getMarkdownFiles filter.
		expect(manager.getHooks()).toHaveLength(0);
	});

	it('applies default values for missing optional frontmatter fields', async () => {
		const plugin = makeDiscoveryPlugin([
			{
				path: 'gemini-scribe/Hooks/minimal.md',
				basename: 'minimal',
				frontmatter: { trigger: 'file-created', action: 'summarize' },
				body: '',
			},
		]);

		const manager = new HookManager(plugin as any);
		await manager.initialize();

		const hooks = manager.getHooks();
		expect(hooks).toHaveLength(1);
		const h = hooks[0];
		expect(h.debounceMs).toBe(5000); // DEFAULT_DEBOUNCE_MS
		expect(h.cooldownMs).toBe(30_000); // DEFAULT_COOLDOWN_MS
		expect(h.desktopOnly).toBe(true); // default
		expect(h.enabled).toBe(true); // default
		expect(h.enabledSkills).toEqual([]);
		expect(h.pathGlob).toBeUndefined();
		expect(h.model).toBeUndefined();
		expect(h.maxRunsPerHour).toBeUndefined();
		expect(h.frontmatterFilter).toBeUndefined();
	});
});

// ─── saveState error handling ───────────────────────────────────────────────

describe('HookManager saveState error handling', () => {
	it('logs an error but does not throw when adapter.write fails', async () => {
		const plugin = createMockPlugin();
		const manager = new HookManager(plugin as any);
		(manager as any).initialized = true;

		// Make write fail.
		plugin.app.vault.adapter.write = vi.fn().mockRejectedValue(new Error('disk full'));

		// Seed state so resetHook triggers a saveState call.
		(manager as any).state = {
			'some-hook': { pausedDueToErrors: true, consecutiveFailures: 3, lastError: 'old' },
		};

		// Should not throw despite saveState failure.
		await manager.resetHook('some-hook');

		expect(plugin.logger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to save state'),
			expect.anything()
		);
	});
});
