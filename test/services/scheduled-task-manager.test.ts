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

	// ── createTask ───────────────────────────────────────────────────────────

	describe('createTask', () => {
		it('writes a markdown file and immediately adds the task to the in-memory map', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.create = jest.fn().mockResolvedValue(undefined);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			await manager.createTask({
				slug: 'new-task',
				schedule: 'daily',
				enabledTools: ['read_only'],
				prompt: 'Do something daily.',
			});

			expect(plugin.app.vault.create).toHaveBeenCalledWith(
				'gemini-scribe/Scheduled-Tasks/new-task.md',
				expect.stringContaining("schedule: 'daily'")
			);
			const tasks = manager.getTasks();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].slug).toBe('new-task');
			expect(tasks[0].schedule).toBe('daily');
			expect(tasks[0].enabled).toBe(true);
		});

		it('seeds state immediately so the task is due on next tick', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.create = jest.fn().mockResolvedValue(undefined);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			await manager.createTask({ slug: 'seeded', schedule: 'weekly', prompt: 'Weekly job.' });

			const state = manager.getState();
			expect(state['seeded']).toBeDefined();
			expect(state['seeded'].nextRunAt).toBeDefined();
		});

		it('throws when a task with the same slug already exists', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				{ path: 'gemini-scribe/Scheduled-Tasks/existing.md', basename: 'existing' },
			]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { schedule: 'daily' },
			});
			plugin.app.vault.read = jest.fn().mockResolvedValue('Prompt.');
			plugin.app.vault.create = jest.fn().mockResolvedValue(undefined);

			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			await expect(manager.createTask({ slug: 'existing', schedule: 'daily', prompt: 'Duplicate.' })).rejects.toThrow(
				'already exists'
			);
		});

		it('throws when slug is empty', async () => {
			const plugin = createMockPlugin();
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			await expect(manager.createTask({ slug: '   ', schedule: 'daily', prompt: 'x' })).rejects.toThrow(
				'slug cannot be empty'
			);
		});

		it('serialized content includes enabledTools list', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.create = jest.fn().mockResolvedValue(undefined);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			await manager.createTask({
				slug: 'tools-task',
				schedule: 'daily',
				enabledTools: ['read_only', 'read_write'],
				prompt: 'With tools.',
			});

			const written = (plugin.app.vault.create as jest.Mock).mock.calls[0][1] as string;
			expect(written).toContain('- read_only');
			expect(written).toContain('- read_write');
		});

		it('omits optional fields from serialized content when not set', async () => {
			const plugin = createMockPlugin();
			plugin.app.vault.create = jest.fn().mockResolvedValue(undefined);
			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();

			await manager.createTask({ slug: 'minimal', schedule: 'once', prompt: 'Once only.' });

			const written = (plugin.app.vault.create as jest.Mock).mock.calls[0][1] as string;
			expect(written).not.toContain('model:');
			expect(written).not.toContain('enabled: false');
			expect(written).not.toContain('runIfMissed:');
		});
	});

	// ── deleteTask ───────────────────────────────────────────────────────────

	describe('deleteTask', () => {
		async function makeManagerWithTask() {
			const plugin = createMockPlugin();
			const fakeFile = { path: 'gemini-scribe/Scheduled-Tasks/to-delete.md', basename: 'to-delete' };
			plugin.app.vault.getMarkdownFiles.mockReturnValue([fakeFile]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { schedule: 'daily' } });
			plugin.app.vault.read = jest.fn().mockResolvedValue('Delete me.');
			plugin.app.vault.getAbstractFileByPath = jest.fn().mockReturnValue(fakeFile);
			plugin.app.vault.delete = jest.fn().mockResolvedValue(undefined);

			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			return { manager, plugin };
		}

		it('removes the task from the in-memory map', async () => {
			const { manager } = await makeManagerWithTask();
			expect(manager.getTasks()).toHaveLength(1);

			await manager.deleteTask('to-delete');

			expect(manager.getTasks()).toHaveLength(0);
		});

		it('removes the task state entry', async () => {
			const { manager } = await makeManagerWithTask();
			await manager.deleteTask('to-delete');

			expect(manager.getState()['to-delete']).toBeUndefined();
		});

		it('calls vault.delete on the task file', async () => {
			const { manager, plugin } = await makeManagerWithTask();
			await manager.deleteTask('to-delete');

			expect(plugin.app.vault.delete).toHaveBeenCalled();
		});

		it('throws when the slug is not found', async () => {
			const { manager } = await makeManagerWithTask();
			await expect(manager.deleteTask('nonexistent')).rejects.toThrow('"nonexistent"');
		});
	});

	// ── updateTask ───────────────────────────────────────────────────────────

	describe('updateTask', () => {
		async function makeManagerWithTask() {
			const plugin = createMockPlugin();
			const fakeFile = { path: 'gemini-scribe/Scheduled-Tasks/editable.md', basename: 'editable' };
			plugin.app.vault.getMarkdownFiles.mockReturnValue([fakeFile]);
			plugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { schedule: 'daily' } });
			plugin.app.vault.read = jest.fn().mockResolvedValue('Original prompt.');
			plugin.app.vault.getAbstractFileByPath = jest.fn().mockReturnValue(fakeFile);
			plugin.app.vault.modify = jest.fn().mockResolvedValue(undefined);

			const manager = new ScheduledTaskManager(plugin);
			await manager.initialize();
			return { manager, plugin };
		}

		it('writes updated content to the vault file', async () => {
			const { manager, plugin } = await makeManagerWithTask();

			await manager.updateTask('editable', { schedule: 'weekly' });

			const written = (plugin.app.vault.modify as jest.Mock).mock.calls[0][1] as string;
			expect(written).toContain("schedule: 'weekly'");
		});

		it('immediately updates the in-memory task so re-render is instant', async () => {
			const { manager } = await makeManagerWithTask();

			await manager.updateTask('editable', { enabled: false });

			const task = manager.getTasks().find((t) => t.slug === 'editable');
			expect(task?.enabled).toBe(false);
		});

		it('preserves unchanged fields when only one field is updated', async () => {
			const { manager } = await makeManagerWithTask();

			await manager.updateTask('editable', { schedule: 'weekly' });

			const task = manager.getTasks().find((t) => t.slug === 'editable');
			expect(task?.schedule).toBe('weekly');
			expect(task?.enabled).toBe(true); // unchanged default
		});

		it('throws when the slug is not found', async () => {
			const { manager } = await makeManagerWithTask();
			await expect(manager.updateTask('ghost', { schedule: 'daily' })).rejects.toThrow('"ghost"');
		});
	});
});
