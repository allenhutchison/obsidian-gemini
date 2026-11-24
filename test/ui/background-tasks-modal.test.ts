import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackgroundTask } from '../../src/services/background-task-manager';

// Decision-surface coverage for the Activity modal's Background Tasks tab
// (#1596): which tab opens by default, what each task row offers (cancel,
// open result, error), and that live updates are wired and torn down. The RAG
// tab renders through rag-status-panel, which has its own tests.

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	const { installObsidianDom } = await import('./obsidian-dom');
	installObsidianDom();
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = document.createElement('div');
			this.modalEl = document.createElement('div');
		}
		close() {
			this.closed = true;
			this.onClose?.();
		}
	}
	return { ...original, Modal };
});

// vi.mock is hoisted, so this import already sees the shimmed Modal.
import { BackgroundTasksModal } from '../../src/ui/background-tasks-modal';

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
	return {
		id: '1',
		type: 'lifecycle-hook',
		label: 'my-hook → note.md',
		status: 'running',
		startedAt: new Date(2026, 0, 1, 9, 0),
		...overrides,
	};
}

function makePlugin(opts: { active?: BackgroundTask[]; recent?: BackgroundTask[]; rag?: boolean } = {}) {
	const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];
	const bus = {
		on: vi.fn((_event: string, _handler: () => Promise<void>) => {
			const unsub = vi.fn();
			unsubscribers.push(unsub);
			return unsub;
		}),
	};
	const manager = {
		runningCount: (opts.active ?? []).length,
		getActiveTasks: vi.fn(() => opts.active ?? []),
		getRecentTasks: vi.fn(() => opts.recent ?? []),
		cancel: vi.fn(),
		clearFinished: vi.fn(),
	};
	return {
		plugin: {
			agentEventBus: bus,
			backgroundTaskManager: manager,
			ragIndexing: opts.rag ? { addProgressListener: vi.fn(), removeProgressListener: vi.fn() } : null,
			app: { workspace: { openLinkText: vi.fn().mockResolvedValue(undefined) } },
		} as any,
		bus,
		manager,
		unsubscribers,
	};
}

function open(plugin: any, defaultTab?: 'tasks' | 'rag') {
	const modal = new BackgroundTasksModal({} as any, plugin, defaultTab);
	modal.onOpen();
	return { modal, el: (modal as any).contentEl as HTMLElement };
}

describe('BackgroundTasksModal default tab', () => {
	it('opens on Background Tasks when a task is running, even with RAG on', () => {
		const { plugin } = makePlugin({ active: [task()], rag: true });
		expect((new BackgroundTasksModal({} as any, plugin) as any).activeTab).toBe('tasks');
	});

	it('opens on RAG when RAG is on and nothing is running', () => {
		const { plugin } = makePlugin({ rag: true });
		expect((new BackgroundTasksModal({} as any, plugin) as any).activeTab).toBe('rag');
	});

	it('opens on Background Tasks when RAG is off', () => {
		const { plugin } = makePlugin();
		expect((new BackgroundTasksModal({} as any, plugin) as any).activeTab).toBe('tasks');
	});

	it('honours an explicit default tab', () => {
		const { plugin } = makePlugin({ active: [task()], rag: true });
		expect((new BackgroundTasksModal({} as any, plugin, 'rag') as any).activeTab).toBe('rag');
	});
});

describe('BackgroundTasksModal tasks tab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows the empty state when there are no tasks', () => {
		const { plugin } = makePlugin();
		const { el } = open(plugin);
		expect(el.querySelector('.gemini-bg-tasks-empty')).not.toBeNull();
	});

	it('shows only the first 10 running tasks and an overflow line', () => {
		const active = Array.from({ length: 12 }, (_, i) => task({ id: String(i), label: `task ${i}` }));
		const { plugin } = makePlugin({ active });
		const { el } = open(plugin);
		expect(el.querySelectorAll('.gemini-bg-task--running')).toHaveLength(10);
		expect(el.querySelector('.gemini-bg-tasks-overflow')).not.toBeNull();
	});

	it('cancels a running task by id and re-renders', () => {
		const { plugin, manager } = makePlugin({ active: [task({ id: '7' })] });
		const { el } = open(plugin);
		const before = manager.getActiveTasks.mock.calls.length;

		el.querySelector<HTMLButtonElement>('.gemini-bg-task-cancel')!.click();

		expect(manager.cancel).toHaveBeenCalledWith('7');
		expect(manager.getActiveTasks.mock.calls.length).toBeGreaterThan(before);
	});

	it('offers no cancel button on finished tasks', () => {
		const { plugin } = makePlugin({ recent: [task({ status: 'complete', completedAt: new Date() })] });
		const { el } = open(plugin);
		expect(el.querySelector('.gemini-bg-task-cancel')).toBeNull();
	});

	it('clears finished tasks', () => {
		const { plugin, manager } = makePlugin({ recent: [task({ status: 'failed', completedAt: new Date() })] });
		const { el } = open(plugin);
		el.querySelector<HTMLButtonElement>('.gemini-bg-tasks-clear')!.click();
		expect(manager.clearFinished).toHaveBeenCalledTimes(1);
	});

	it('links the result of a completed task, opens it and closes the modal', () => {
		const { plugin } = makePlugin({
			recent: [task({ status: 'complete', completedAt: new Date(), outputPath: 'Runs/out.md' })],
		});
		const { modal, el } = open(plugin);

		el.querySelector<HTMLAnchorElement>('.gemini-bg-task-link')!.click();

		expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith('Runs/out.md', '', false);
		expect((modal as any).closed).toBe(true);
	});

	it('shows no result link for a failed task, but shows its error', () => {
		const { plugin } = makePlugin({
			recent: [task({ status: 'failed', completedAt: new Date(), outputPath: 'Runs/out.md', error: 'API down' })],
		});
		const { el } = open(plugin);
		expect(el.querySelector('.gemini-bg-task-link')).toBeNull();
		const error = el.querySelector('.gemini-bg-task-error')!;
		expect(error.textContent).toContain('API down');
		expect(error.getAttribute('title')).toBe('API down');
	});

	it('shows no error for a cancelled task', () => {
		const { plugin } = makePlugin({
			recent: [task({ status: 'cancelled', completedAt: new Date(), error: 'stopped' })],
		});
		const { el } = open(plugin);
		expect(el.querySelector('.gemini-bg-task-error')).toBeNull();
	});

	it('reports a missing task manager instead of crashing', () => {
		const { plugin } = makePlugin();
		plugin.backgroundTaskManager = undefined;
		const { el } = open(plugin, 'tasks');
		expect(el.textContent).not.toBe('');
		expect(el.querySelector('.gemini-bg-task')).toBeNull();
	});
});

describe('BackgroundTasksModal live updates', () => {
	it('subscribes to task start/complete/fail and unsubscribes on close', () => {
		const { plugin, bus, unsubscribers } = makePlugin();
		const { modal } = open(plugin);

		expect(bus.on.mock.calls.map(([event]) => event)).toEqual([
			'backgroundTaskStarted',
			'backgroundTaskComplete',
			'backgroundTaskFailed',
		]);

		modal.onClose();
		expect(unsubscribers.every((u) => u.mock.calls.length === 1)).toBe(true);
	});

	it('re-renders the tasks tab when a task event arrives', async () => {
		const active: BackgroundTask[] = [];
		const { plugin, bus } = makePlugin({ active });
		const { el } = open(plugin);
		expect(el.querySelector('.gemini-bg-task')).toBeNull();

		active.push(task({ label: 'new task' }));
		const handler = bus.on.mock.calls[0][1];
		await handler();

		expect(el.querySelector('.gemini-bg-task-label')?.textContent).toBe('new task');
	});

	it('detaches the RAG progress listener on close', () => {
		const { plugin } = makePlugin({ rag: true });
		const { modal } = open(plugin, 'tasks');
		const listener = plugin.ragIndexing.addProgressListener.mock.calls[0][0];

		modal.onClose();

		expect(plugin.ragIndexing.removeProgressListener).toHaveBeenCalledWith(listener);
	});
});
