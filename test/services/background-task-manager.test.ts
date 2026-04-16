import { BackgroundTaskManager } from '../../src/services/background-task-manager';
import { AgentEventBus } from '../../src/agent/agent-event-bus';

// ─── Mocks ────────────────────────────────────────────────────────────────────

function createMockLogger(): any {
	return {
		log: jest.fn(),
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
		child: jest.fn().mockReturnThis(),
	};
}

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		logger: createMockLogger(),
		backgroundStatusBar: { update: jest.fn() },
		app: {
			workspace: {
				openLinkText: jest.fn(),
			},
		},
		...overrides,
	};
}

// Mock Obsidian's Notice — provide a noticeEl so showCompletionNotice doesn't throw
jest.mock('obsidian', () => ({
	Notice: jest.fn().mockImplementation(() => ({
		noticeEl: {
			createSpan: jest.fn().mockReturnValue({ setText: jest.fn() }),
			createEl: jest.fn().mockReturnValue({
				addEventListener: jest.fn(),
				setText: jest.fn(),
			}),
		},
		hide: jest.fn(),
	})),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeManager() {
	const logger = createMockLogger();
	const bus = new AgentEventBus(logger);
	const plugin = createMockPlugin();
	const manager = new BackgroundTaskManager(plugin, bus);
	return { manager, bus, plugin };
}

/** Returns a promise that resolves after all pending micro-tasks + one macro-task tick. */
function flushAsync(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BackgroundTaskManager', () => {
	describe('submit', () => {
		it('returns a task ID immediately without blocking', () => {
			const { manager } = makeManager();
			let workStarted = false;

			const id = manager.submit('test', 'Test task', async () => {
				workStarted = true;
				return undefined;
			});

			// ID is returned synchronously — work has NOT necessarily started yet
			expect(typeof id).toBe('string');
			expect(id.length).toBeGreaterThan(0);
			// work may or may not have started; the important thing is the ID came back instantly
			void workStarted; // suppress unused-variable lint
		});

		it('assigns sequential, unique IDs', () => {
			const { manager } = makeManager();
			const id1 = manager.submit('t', 'Task 1', async () => undefined);
			const id2 = manager.submit('t', 'Task 2', async () => undefined);
			const id3 = manager.submit('t', 'Task 3', async () => undefined);
			expect(id1).not.toBe(id2);
			expect(id2).not.toBe(id3);
		});
	});

	describe('task lifecycle — success', () => {
		it('transitions pending → running → complete', async () => {
			const { manager } = makeManager();
			const states: string[] = [];

			const id = manager.submit('research', 'My Research', async () => {
				states.push(manager.getTask(id)!.status);
				return 'output/result.md';
			});

			// Before the async work runs, task exists
			const taskBefore = manager.getTask(id);
			expect(taskBefore).toBeDefined();

			await flushAsync();

			const taskAfter = manager.getTask(id)!;
			expect(taskAfter.status).toBe('complete');
			expect(taskAfter.outputPath).toBe('output/result.md');
			expect(taskAfter.completedAt).toBeInstanceOf(Date);
		});

		it('emits backgroundTaskStarted and backgroundTaskComplete events', async () => {
			const logger = createMockLogger();
			const bus = new AgentEventBus(logger);
			const plugin = createMockPlugin();
			const manager = new BackgroundTaskManager(plugin, bus);

			const started = jest.fn().mockResolvedValue(undefined);
			const completed = jest.fn().mockResolvedValue(undefined);
			bus.on('backgroundTaskStarted', started);
			bus.on('backgroundTaskComplete', completed);

			manager.submit('img', 'Generate image', async () => 'images/out.png');
			await flushAsync();

			expect(started).toHaveBeenCalledTimes(1);
			expect(started).toHaveBeenCalledWith(expect.objectContaining({ type: 'img', label: 'Generate image' }));
			expect(completed).toHaveBeenCalledTimes(1);
			expect(completed).toHaveBeenCalledWith(expect.objectContaining({ outputPath: 'images/out.png' }));
		});

		it('moves to getRecentTasks after completion', async () => {
			const { manager } = makeManager();
			manager.submit('t', 'Done task', async () => undefined);
			await flushAsync();

			expect(manager.getActiveTasks()).toHaveLength(0);
			const recent = manager.getRecentTasks();
			expect(recent).toHaveLength(1);
			expect(recent[0].status).toBe('complete');
		});
	});

	describe('task lifecycle — failure', () => {
		it('transitions running → failed when work throws', async () => {
			const { manager } = makeManager();
			const id = manager.submit('t', 'Failing task', async () => {
				throw new Error('API exploded');
			});
			await flushAsync();

			const task = manager.getTask(id)!;
			expect(task.status).toBe('failed');
			expect(task.error).toContain('API exploded');
			expect(task.completedAt).toBeInstanceOf(Date);
		});

		it('emits backgroundTaskFailed when work throws', async () => {
			const logger = createMockLogger();
			const bus = new AgentEventBus(logger);
			const plugin = createMockPlugin();
			const manager = new BackgroundTaskManager(plugin, bus);

			const failed = jest.fn().mockResolvedValue(undefined);
			bus.on('backgroundTaskFailed', failed);

			manager.submit('t', 'Bad task', async () => {
				throw new Error('boom');
			});
			await flushAsync();

			expect(failed).toHaveBeenCalledTimes(1);
			// getErrorMessage wraps the raw message — just assert it contains the original text
			expect(failed).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('boom') }));
		});
	});

	describe('cancellation', () => {
		it('cancel() marks an in-flight task as cancelled', async () => {
			const { manager } = makeManager();

			let resolveFn!: () => void;
			const blocker = new Promise<void>((r) => (resolveFn = r));

			const id = manager.submit('t', 'Long task', async (isCancelled) => {
				await blocker;
				if (isCancelled()) return undefined;
				return 'output.md';
			});

			// Cancel before the blocker resolves
			manager.cancel(id);

			// Now let the work finish
			resolveFn();
			await flushAsync();

			const task = manager.getTask(id)!;
			expect(task.status).toBe('cancelled');
			expect(task.outputPath).toBeUndefined();
		});

		it('cancel() has no effect on a completed task', async () => {
			const { manager } = makeManager();
			const id = manager.submit('t', 'Done', async () => 'result.md');
			await flushAsync();

			expect(() => manager.cancel(id)).not.toThrow();
			expect(manager.getTask(id)!.status).toBe('complete');
		});

		it('emits backgroundTaskFailed when cancelled', async () => {
			const logger = createMockLogger();
			const bus = new AgentEventBus(logger);
			const plugin = createMockPlugin();
			const manager = new BackgroundTaskManager(plugin, bus);

			const failed = jest.fn().mockResolvedValue(undefined);
			bus.on('backgroundTaskFailed', failed);

			let resolveFn!: () => void;
			const blocker = new Promise<void>((r) => (resolveFn = r));

			const id = manager.submit('t', 'Cancel me', async (isCancelled) => {
				await blocker;
				if (isCancelled()) return undefined;
				return 'out.md';
			});

			manager.cancel(id);
			resolveFn();
			await flushAsync();

			expect(failed).toHaveBeenCalledWith(expect.objectContaining({ error: 'Cancelled' }));
		});
	});

	describe('getActiveTasks / getRecentTasks / runningCount', () => {
		it('runningCount reflects active tasks', async () => {
			const { manager } = makeManager();

			let resolveFn!: () => void;
			const blocker = new Promise<void>((r) => (resolveFn = r));

			manager.submit('t', 'Slow', async () => {
				await blocker;
				return undefined;
			});

			// run() sets task.status = 'running' synchronously before its first await,
			// so after submit() returns the task is already counted.
			await Promise.resolve();
			expect(manager.runningCount).toBe(1);

			resolveFn();
			await flushAsync();
			expect(manager.runningCount).toBe(0);
		});

		it('getRecentTasks returns newest first', async () => {
			const { manager } = makeManager();

			manager.submit('t', 'First', async () => 'a.md');
			await flushAsync();
			manager.submit('t', 'Second', async () => 'b.md');
			await flushAsync();

			const recent = manager.getRecentTasks();
			expect(recent[0].label).toBe('Second');
			expect(recent[1].label).toBe('First');
		});
	});

	describe('destroy', () => {
		it('cancels active tasks and clears state', async () => {
			const { manager } = makeManager();

			let resolveFn!: () => void;
			const blocker = new Promise<void>((r) => (resolveFn = r));
			manager.submit('t', 'Slow', async () => {
				await blocker;
				return undefined;
			});

			manager.destroy();
			resolveFn();
			await flushAsync();

			// After destroy, tasks are cleared
			expect(manager.getActiveTasks()).toHaveLength(0);
			expect(manager.getRecentTasks()).toHaveLength(0);
		});
	});
});
