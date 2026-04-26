import { ScheduledTaskManager, computeNextRunAt, ScheduledTask } from '../../src/services/scheduled-task-manager';

// ─── Mocks ────────────────────────────────────────────────────────────────────

function createMockLogger(): any {
	return {
		log: jest.fn(),
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	};
}

function createMockPlugin(overrides: Record<string, any> = {}): any {
	const stateStore: Record<string, string> = {};

	return {
		logger: createMockLogger(),
		settings: { historyFolder: 'gemini-scribe' },
		backgroundTaskManager: {
			submit: jest.fn().mockReturnValue('bg-task-1'),
		},
		app: {
			vault: {
				getMarkdownFiles: jest.fn().mockReturnValue([]),
				on: jest.fn(),
				off: jest.fn(),
				adapter: {
					exists: jest.fn().mockResolvedValue(false),
					read: jest.fn().mockImplementation(async (path: string) => stateStore[path] ?? '{}'),
					write: jest.fn().mockImplementation(async (path: string, content: string) => {
						stateStore[path] = content;
					}),
				},
			},
			metadataCache: {
				getFileCache: jest.fn().mockReturnValue(null),
				on: jest.fn(),
				off: jest.fn(),
			},
		},
		...overrides,
	};
}

// Silence Obsidian's normalizePath — just return the input unchanged in tests
jest.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {},
	TFolder: class {},
}));

// ensureFolderExists is a no-op in tests
jest.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

// findFrontmatterEndOffset — return undefined (no frontmatter in test content)
jest.mock('../../src/services/skill-manager', () => ({
	findFrontmatterEndOffset: jest.fn().mockReturnValue(undefined),
}));

// ─── computeNextRunAt ─────────────────────────────────────────────────────────

describe('computeNextRunAt', () => {
	const base = new Date('2026-04-17T08:00:00.000Z');

	it('once — returns max date sentinel', () => {
		const result = computeNextRunAt('once', base);
		expect(result.getTime()).toBe(8640000000000000);
	});

	it('daily — advances by exactly 24 h', () => {
		const result = computeNextRunAt('daily', base);
		expect(result.getTime()).toBe(base.getTime() + 24 * 60 * 60 * 1000);
	});

	it('weekly — advances by exactly 7 d', () => {
		const result = computeNextRunAt('weekly', base);
		expect(result.getTime()).toBe(base.getTime() + 7 * 24 * 60 * 60 * 1000);
	});

	it('interval:30m — advances by 30 minutes', () => {
		const result = computeNextRunAt('interval:30m', base);
		expect(result.getTime()).toBe(base.getTime() + 30 * 60 * 1000);
	});

	it('interval:2h — advances by 2 hours', () => {
		const result = computeNextRunAt('interval:2h', base);
		expect(result.getTime()).toBe(base.getTime() + 2 * 60 * 60 * 1000);
	});

	it('interval:1m — advances by 1 minute', () => {
		const result = computeNextRunAt('interval:1m', base);
		expect(result.getTime()).toBe(base.getTime() + 60 * 1000);
	});

	it('interval with bad unit — throws', () => {
		expect(() => computeNextRunAt('interval:5d', base)).toThrow();
	});

	it('interval with no number — throws', () => {
		expect(() => computeNextRunAt('interval:m', base)).toThrow();
	});

	it('interval:0m — throws (zero interval would fire every tick)', () => {
		expect(() => computeNextRunAt('interval:0m', base)).toThrow('greater than zero');
	});

	it('interval:0h — throws (zero interval would fire every tick)', () => {
		expect(() => computeNextRunAt('interval:0h', base)).toThrow('greater than zero');
	});

	it('unknown schedule — throws', () => {
		expect(() => computeNextRunAt('hourly', base)).toThrow();
	});
});

// ─── ScheduledTaskManager ─────────────────────────────────────────────────────

describe('ScheduledTaskManager', () => {
	function makeManager(pluginOverrides: Record<string, any> = {}) {
		const plugin = createMockPlugin(pluginOverrides);
		const manager = new ScheduledTaskManager(plugin);
		return { manager, plugin };
	}

	// ── Folder paths ────────────────────────────────────────────────────────

	describe('folder paths', () => {
		it('derives paths from historyFolder setting', () => {
			const { manager } = makeManager();
			expect(manager.scheduledTasksFolder).toBe('gemini-scribe/Scheduled-Tasks');
			expect(manager.runsFolder).toBe('gemini-scribe/Scheduled-Tasks/Runs');
			expect(manager.stateFilePath).toBe('gemini-scribe/Scheduled-Tasks/scheduled-tasks-state.json');
		});
	});

	// ── Double-init guard ───────────────────────────────────────────────────

	describe('initialize() idempotency', () => {
		it('runs only once when called twice without refresh flag (plugin:reload path)', async () => {
			const { manager, plugin } = makeManager();
			await manager.initialize();
			const callsAfterFirst = plugin.app.vault.getMarkdownFiles.mock.calls.length;

			// Second call — simulates onLayoutReady() firing after setup() already ran
			await manager.initialize();
			expect(plugin.app.vault.getMarkdownFiles.mock.calls.length).toBe(callsAfterFirst);
		});

		it('re-runs when refresh: true is passed (settings-save path)', async () => {
			const { manager, plugin } = makeManager();
			await manager.initialize();
			const callsAfterFirst = plugin.app.vault.getMarkdownFiles.mock.calls.length;

			// refresh: true — simulates LifecycleService.setup() on settings change
			await manager.initialize({ refresh: true });
			expect(plugin.app.vault.getMarkdownFiles.mock.calls.length).toBeGreaterThan(callsAfterFirst);
		});
	});

	// ── State read / write ──────────────────────────────────────────────────

	describe('sidecar state', () => {
		it('initialises with empty state when no file exists', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.adapter.exists.mockResolvedValue(false);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			expect(manager.getState()).toEqual({});
		});

		it('loads existing state from the sidecar file', async () => {
			const existingState = {
				'my-task': { nextRunAt: '2026-04-18T08:00:00.000Z', lastRunAt: '2026-04-17T08:00:00.000Z' },
			};
			const plugin = createMockPlugin();
			plugin.app.vault.adapter.exists.mockResolvedValue(true);
			plugin.app.vault.adapter.read.mockResolvedValue(JSON.stringify(existingState));
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			expect(manager.getState()['my-task'].nextRunAt).toBe('2026-04-18T08:00:00.000Z');
		});

		it('persists state after task discovery', async () => {
			const { manager, plugin } = makeManager();
			await manager.initialize();
			// No tasks discovered (empty vault), but saveState is still called once
			expect(plugin.app.vault.adapter.write).toHaveBeenCalled();
		});
	});

	// ── Task discovery ──────────────────────────────────────────────────────

	describe('task discovery', () => {
		it('ignores files that have no schedule frontmatter', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/bad.md', basename: 'bad' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: {} }); // no schedule
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			expect(manager.getTasks()).toHaveLength(0);
		});

		it('ignores files inside the Runs/ subfolder', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/Runs/my-task/2026-04-17.md', basename: '2026-04-17' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'daily' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Do something');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			expect(manager.getTasks()).toHaveLength(0);
		});

		it('parses a valid task file and seeds state', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/daily-summary.md', basename: 'daily-summary' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					schedule: 'daily',
					enabledTools: ['read_only'],
					outputPath: 'Scheduled-Tasks/Runs/daily-summary/{date}.md',
					enabled: true,
					runIfMissed: false,
				},
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Summarise recent notes.');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			const tasks = manager.getTasks();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].slug).toBe('daily-summary');
			expect(tasks[0].schedule).toBe('daily');
			expect(tasks[0].enabledTools).toEqual(['read_only']);
			expect(tasks[0].prompt).toBe('Summarise recent notes.');

			// State entry seeded for newly-discovered task
			const state = manager.getState();
			expect(state['daily-summary']).toBeDefined();
			expect(state['daily-summary'].nextRunAt).toBeDefined();
		});

		it('default outputPath is rooted inside historyFolder, not the vault root', async () => {
			// Regression: before the fix, the default was "Scheduled-Tasks/Runs/<slug>/{date}.md"
			// (missing the historyFolder prefix), so output files would land at the vault root
			// instead of inside "gemini-scribe/Scheduled-Tasks/Runs/".
			const plugin = createMockPlugin(); // historyFolder = 'gemini-scribe'
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/no-output.md', basename: 'no-output' },
			]);
			// No outputPath in frontmatter — manager must supply the default
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'daily' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Do something daily.');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			const tasks = manager.getTasks();
			expect(tasks).toHaveLength(1);

			const { outputPath } = tasks[0];
			// Must start with the historyFolder so output lands inside the plugin state folder
			expect(outputPath).toMatch(/^gemini-scribe\//);
			// Full expected default: gemini-scribe/Scheduled-Tasks/Runs/no-output/{date}.md
			expect(outputPath).toBe('gemini-scribe/Scheduled-Tasks/Runs/no-output/{date}.md');
		});

		it('explicit outputPath in frontmatter is used verbatim', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/custom-output.md', basename: 'custom-output' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					schedule: 'weekly',
					outputPath: 'my-reports/{slug}/{date}.md',
				},
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Weekly report prompt.');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			const tasks = manager.getTasks();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].outputPath).toBe('my-reports/{slug}/{date}.md');
		});

		it('enabled defaults to true when omitted from frontmatter', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/implicit-enabled.md', basename: 'implicit-enabled' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'daily' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Some prompt.');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			expect(manager.getTasks()[0].enabled).toBe(true);
		});

		it('enabledTools defaults to empty array when omitted from frontmatter', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/no-tools.md', basename: 'no-tools' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'interval:30m' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Prompt without tools.');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			expect(manager.getTasks()[0].enabledTools).toEqual([]);
		});
	});

	// ── vault.on('create', ...) hot discovery ───────────────────────────────

	describe('new file discovery via vault create event', () => {
		it('picks up a new task file without a plugin reload', async () => {
			const plugin = createMockPlugin();
			// Start with no task files
			plugin.app.vault.getMarkdownFiles.mockReturnValue([]);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			expect(manager.getTasks()).toHaveLength(0);

			// Capture the vault.on('create', ...) handler registered during initialize()
			const vaultOnCalls = (plugin.app.vault.on as jest.Mock).mock.calls;
			const createEntry = vaultOnCalls.find(([event]: [string]) => event === 'create');
			expect(createEntry).toBeDefined();
			const createHandler = createEntry[1] as (...args: unknown[]) => unknown;

			// Simulate a new task file appearing in the vault
			const { TFile: MockTFile } = jest.requireMock('obsidian');
			const newFile = Object.assign(new MockTFile(), {
				path: 'gemini-scribe/Scheduled-Tasks/hot-task.md',
				basename: 'hot-task',
				extension: 'md',
			});
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'daily' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Hot-loaded prompt.');

			// Fire the create handler and wait for the 500 ms defer
			jest.useFakeTimers();
			createHandler(newFile);
			jest.advanceTimersByTime(600);
			jest.useRealTimers();
			// Allow the deferred async parseTaskFile promise to settle
			await Promise.resolve();
			await Promise.resolve();

			const tasks = manager.getTasks();
			expect(tasks.some((t) => t.slug === 'hot-task')).toBe(true);
			expect(manager.getState()['hot-task']).toBeDefined();
		});
	});

	describe('double-parse guard on new file creation', () => {
		it('parses exactly once when vault.create and metadataCache.changed both fire for a new file', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([]);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			// Capture both handlers registered during initialize()
			const vaultOnCalls = (plugin.app.vault.on as jest.Mock).mock.calls;
			const createHandler = vaultOnCalls.find(([e]: [string]) => e === 'create')?.[1] as (...a: unknown[]) => unknown;
			const cacheOnCalls = (plugin.app.metadataCache.on as jest.Mock).mock.calls;
			const changedHandler = cacheOnCalls.find(([e]: [string]) => e === 'changed')?.[1] as (...a: unknown[]) => unknown;
			expect(createHandler).toBeDefined();
			expect(changedHandler).toBeDefined();

			const { TFile: MockTFile } = jest.requireMock('obsidian');
			const newFile = Object.assign(new MockTFile(), {
				path: 'gemini-scribe/Scheduled-Tasks/new-task.md',
				basename: 'new-task',
				extension: 'md',
			});
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { schedule: 'daily' } });
			plugin.app.vault.read = jest.fn().mockResolvedValue('Do something.');

			// Fire create then changed (as Obsidian would)
			jest.useFakeTimers();
			createHandler(newFile);
			changedHandler(newFile); // fires before the 500 ms defer
			jest.advanceTimersByTime(600);
			jest.useRealTimers();
			await Promise.resolve();
			await Promise.resolve();

			// vault.read is called inside parseTaskFile — must be exactly once
			expect(plugin.app.vault.read).toHaveBeenCalledTimes(1);
			expect(manager.getTasks().some((t) => t.slug === 'new-task')).toBe(true);
		});

		it('still re-parses when only metadataCache.changed fires (hot-reload of existing file)', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/existing-task.md', basename: 'existing-task' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { schedule: 'daily' } });
			plugin.app.vault.read = jest.fn().mockResolvedValue('Original prompt.');
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			// Simulate an edit to the existing file (only changed fires, not create)
			const cacheOnCalls = (plugin.app.metadataCache.on as jest.Mock).mock.calls;
			const changedHandler = cacheOnCalls.find(([e]: [string]) => e === 'changed')?.[1] as (...a: unknown[]) => unknown;
			const { TFile: MockTFile } = jest.requireMock('obsidian');
			const existingFile = Object.assign(new MockTFile(), {
				path: 'gemini-scribe/Scheduled-Tasks/existing-task.md',
				basename: 'existing-task',
				extension: 'md',
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Updated prompt.');
			changedHandler(existingFile);
			await Promise.resolve();
			await Promise.resolve();

			// parseTaskFile should have run again — vault.read called once more
			expect(plugin.app.vault.read).toHaveBeenCalledTimes(1);
			expect(manager.getTasks().find((t) => t.slug === 'existing-task')?.prompt).toBe('Updated prompt.');
		});
	});

	// ── Pending defer cancellation ───────────────────────────────────────────

	describe('pending defer cancellation', () => {
		it('does not mutate state when destroy() runs before the 500 ms defer fires', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([]);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			const vaultOnCalls = (plugin.app.vault.on as jest.Mock).mock.calls;
			const createHandler = vaultOnCalls.find(([e]: [string]) => e === 'create')?.[1] as (...a: unknown[]) => unknown;
			expect(createHandler).toBeDefined();

			const { TFile: MockTFile } = jest.requireMock('obsidian');
			const newFile = Object.assign(new MockTFile(), {
				path: 'gemini-scribe/Scheduled-Tasks/late-task.md',
				basename: 'late-task',
				extension: 'md',
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Prompt body.');
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { schedule: 'daily' } });

			jest.useFakeTimers();
			// Fire create — starts the 500 ms defer
			createHandler(newFile);
			// destroy() before the defer fires
			manager.destroy();
			// Advance past the defer window — the cancelled timer must not fire
			jest.advanceTimersByTime(600);
			jest.useRealTimers();
			await Promise.resolve();
			await Promise.resolve();

			// parseTaskFile (vault.read) must never have been called
			expect(plugin.app.vault.read).not.toHaveBeenCalled();
		});

		it('does not mutate state when initialize() re-runs before the 500 ms defer fires', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([]);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			const vaultOnCalls = (plugin.app.vault.on as jest.Mock).mock.calls;
			const createHandler = vaultOnCalls.find(([e]: [string]) => e === 'create')?.[1] as (...a: unknown[]) => unknown;
			expect(createHandler).toBeDefined();

			const { TFile: MockTFile } = jest.requireMock('obsidian');
			const newFile = Object.assign(new MockTFile(), {
				path: 'gemini-scribe/Scheduled-Tasks/stale-task.md',
				basename: 'stale-task',
				extension: 'md',
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Prompt body.');
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { schedule: 'daily' } });

			jest.useFakeTimers();
			// Fire create — starts the 500 ms defer
			createHandler(newFile);
			// Re-initialize before the defer fires — should cancel the pending timer
			jest.useRealTimers();
			await manager.initialize();
			jest.useFakeTimers();
			jest.advanceTimersByTime(600);
			jest.useRealTimers();
			await Promise.resolve();
			await Promise.resolve();

			// parseTaskFile (vault.read) must never have been called from the stale defer
			expect(plugin.app.vault.read).not.toHaveBeenCalled();
		});
	});

	// ── Tick behaviour ──────────────────────────────────────────────────────

	describe('tick', () => {
		async function makeInitialisedManager(task: Partial<ScheduledTask>, nextRunAt: Date) {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: `gemini-scribe/Scheduled-Tasks/${task.slug ?? 'test'}.md`, basename: task.slug ?? 'test' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: task.schedule ?? 'daily', enabled: task.enabled ?? true },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue(task.prompt ?? 'Do work');

			// Pre-seed state with a controlled nextRunAt
			plugin.app.vault.adapter.exists.mockResolvedValue(true);
			plugin.app.vault.adapter.read.mockResolvedValue(
				JSON.stringify({ [task.slug ?? 'test']: { nextRunAt: nextRunAt.toISOString() } })
			);

			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			return { manager, plugin };
		}

		it('submits a due task to BackgroundTaskManager', async () => {
			const past = new Date(Date.now() - 60_000); // 1 min ago
			const { manager, plugin } = await makeInitialisedManager({ slug: 'my-task' }, past);

			await manager.tick();

			expect(plugin.backgroundTaskManager.submit).toHaveBeenCalledWith(
				'scheduled-task',
				'my-task',
				expect.any(Function)
			);
		});

		it('does not submit a task that is not yet due', async () => {
			const future = new Date(Date.now() + 60_000); // 1 min from now
			const { manager, plugin } = await makeInitialisedManager({ slug: 'future-task' }, future);

			await manager.tick();

			expect(plugin.backgroundTaskManager.submit).not.toHaveBeenCalled();
		});

		it('does not submit a disabled task', async () => {
			const past = new Date(Date.now() - 60_000);
			const { manager, plugin } = await makeInitialisedManager({ slug: 'off-task', enabled: false }, past);

			await manager.tick();

			expect(plugin.backgroundTaskManager.submit).not.toHaveBeenCalled();
		});

		it('advances nextRunAt before submitting so tick loops cannot double-fire', async () => {
			const past = new Date(Date.now() - 60_000);
			const { manager } = await makeInitialisedManager({ slug: 'advance-test', schedule: 'daily' }, past);

			await manager.tick();

			const state = manager.getState();
			const nextRunAt = new Date(state['advance-test'].nextRunAt);
			// Should now be ~24 h in the future, not in the past
			expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
		});
	});

	// ── runNow ───────────────────────────────────────────────────────────────

	describe('runNow', () => {
		it('throws when the slug is not found', async () => {
			const { manager } = makeManager();
			await manager.initialize();
			await expect(manager.runNow('nonexistent')).rejects.toThrow('"nonexistent"');
		});
	});

	// ── destroy ──────────────────────────────────────────────────────────────

	describe('destroy', () => {
		it('clears tasks and state', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/my-task.md', basename: 'my-task' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'daily' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('prompt');

			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			expect(manager.getTasks()).toHaveLength(1);

			manager.destroy();
			expect(manager.getTasks()).toHaveLength(0);
			expect(Object.keys(manager.getState())).toHaveLength(0);
		});

		it('stop() is idempotent when called before start()', () => {
			const { manager } = makeManager();
			expect(() => manager.destroy()).not.toThrow();
		});
	});
});
