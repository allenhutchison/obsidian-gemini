import { Notice } from 'obsidian';
import type ObsidianGemini from '../main';
import type { AgentEventBus } from '../agent/agent-event-bus';
import { getErrorMessage } from '../utils/error-utils';

export type BackgroundTaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface BackgroundTask {
	id: string;
	type: string;
	label: string;
	status: BackgroundTaskStatus;
	outputPath?: string;
	error?: string;
	startedAt: Date;
	completedAt?: Date;
}

/**
 * Manages fire-and-forget background tasks (e.g. deep research, image generation).
 * Callers submit work and receive a task ID immediately — they never block.
 *
 * Events emitted on AgentEventBus:
 *   backgroundTaskStarted  — when a task transitions pending → running
 *   backgroundTaskComplete — when a task finishes successfully
 *   backgroundTaskFailed   — when a task throws or is cancelled
 */
export class BackgroundTaskManager {
	private plugin: ObsidianGemini;
	private eventBus: AgentEventBus;
	private tasks = new Map<string, BackgroundTask>();
	private cancellationFlags = new Map<string, boolean>();
	/**
	 * Tracks the in-flight Promise returned by run() for each active task.
	 * Populated in submit(), cleaned up in run()'s finally block.
	 * Used by drain() to await full settlement after cancellation.
	 */
	private runPromises = new Map<string, Promise<void>>();
	/** Maximum number of completed/failed tasks kept in memory for the monitoring modal. */
	private static readonly MAX_RECENT = 20;
	private nextId = 1;

	constructor(plugin: ObsidianGemini, eventBus: AgentEventBus) {
		this.plugin = plugin;
		this.eventBus = eventBus;
	}

	/**
	 * Submit a unit of work to run in the background.
	 * The work function receives a `isCancelled` predicate it can poll
	 * to abort early. It should return the vault path of its output file,
	 * or undefined if there is no file output.
	 *
	 * @param type    Short machine-readable category (e.g. 'deep-research')
	 * @param label   Human-readable description shown in the status bar / modal
	 * @param work    Async function to execute; return value becomes outputPath
	 * @returns       The task ID — callers can pass this to cancel() or getTask()
	 */
	submit(type: string, label: string, work: (isCancelled: () => boolean) => Promise<string | undefined>): string {
		const id = String(this.nextId++);

		const task: BackgroundTask = {
			id,
			type,
			label,
			status: 'pending',
			startedAt: new Date(),
		};

		this.tasks.set(id, task);
		this.cancellationFlags.set(id, false);

		// Fire-and-forget for the caller, but the promise is stored in runPromises so
		// drain() can await full settlement (e.g. after cancel()) without blocking submit().
		const p = this.run(id, work);
		this.runPromises.set(id, p);

		return id;
	}

	/**
	 * Request cancellation of a running task.
	 * The work function must cooperate by polling `isCancelled()`.
	 * Has no effect if the task is already complete or failed.
	 */
	cancel(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		if (task.status !== 'pending' && task.status !== 'running') return;

		this.cancellationFlags.set(taskId, true);
		task.status = 'cancelled';
		task.completedAt = new Date();
		this.plugin.logger.log(`[BackgroundTaskManager] Task ${taskId} (${task.label}) cancelled`);
		this.notifyStatusChange();
	}

	/** Returns a live snapshot of a single task, or undefined. */
	getTask(taskId: string): BackgroundTask | undefined {
		return this.tasks.get(taskId);
	}

	/** Returns all currently running tasks. */
	getActiveTasks(): BackgroundTask[] {
		return [...this.tasks.values()].filter((t) => t.status === 'pending' || t.status === 'running');
	}

	/**
	 * Returns the most recent completed/failed/cancelled tasks, newest first.
	 * Capped at BackgroundTaskManager.MAX_RECENT entries.
	 */
	getRecentTasks(limit = BackgroundTaskManager.MAX_RECENT): BackgroundTask[] {
		return [...this.tasks.values()]
			.filter((t) => t.status === 'complete' || t.status === 'failed' || t.status === 'cancelled')
			.sort((a, b) => {
				const byCompleted = (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0);
				if (byCompleted !== 0) return byCompleted;
				// Tiebreak by numeric task ID (monotonically increasing) so the task
				// submitted later always sorts first regardless of timer resolution.
				return Number(b.id) - Number(a.id);
			})
			.slice(0, limit);
	}

	/** Total number of currently running tasks (used by the status bar). */
	get runningCount(): number {
		return this.getActiveTasks().length;
	}

	/** Remove all completed, failed, and cancelled tasks from memory. */
	clearFinished(): void {
		for (const [id, task] of this.tasks) {
			if (task.status === 'complete' || task.status === 'failed' || task.status === 'cancelled') {
				this.tasks.delete(id);
			}
		}
		this.notifyStatusChange();
	}

	// --- Private ---

	private async run(id: string, work: (isCancelled: () => boolean) => Promise<string | undefined>): Promise<void> {
		const task = this.tasks.get(id)!;
		const isCancelled = () => this.cancellationFlags.get(id) === true;

		// Transition to running
		task.status = 'running';
		this.plugin.logger.log(`[BackgroundTaskManager] Task ${id} (${task.label}) started`);

		await this.eventBus.emit('backgroundTaskStarted', { taskId: id, type: task.type, label: task.label });
		this.notifyStatusChange();

		try {
			const outputPath = await work(isCancelled);

			// Check if it was cancelled while work was executing
			if (isCancelled()) {
				// cancel() already set status = 'cancelled'
				await this.eventBus.emit('backgroundTaskFailed', {
					taskId: id,
					type: task.type,
					label: task.label,
					error: 'Cancelled',
				});
				this.notifyStatusChange();
				return;
			}

			task.status = 'complete';
			task.outputPath = outputPath;
			task.completedAt = new Date();

			this.plugin.logger.log(`[BackgroundTaskManager] Task ${id} (${task.label}) complete`);

			await this.eventBus.emit('backgroundTaskComplete', {
				taskId: id,
				type: task.type,
				label: task.label,
				outputPath,
			});

			this.showCompletionNotice(task);
		} catch (error) {
			// Don't overwrite cancelled status if cancel() raced with a throw.
			// Use the cancellation flag rather than task.status to avoid a TypeScript narrowing issue.
			// Always report 'Cancelled' for the cancelled path so subscribers see a consistent shape.
			if (isCancelled()) {
				task.error = 'Cancelled';
			} else {
				task.status = 'failed';
				task.error = getErrorMessage(error);
			}
			task.completedAt = new Date();

			this.plugin.logger.error(`[BackgroundTaskManager] Task ${id} (${task.label}) failed:`, error);

			await this.eventBus.emit('backgroundTaskFailed', {
				taskId: id,
				type: task.type,
				label: task.label,
				error: task.error,
			});

			new Notice(`Background task failed: ${task.label}\n${task.error}`, 8000);
		} finally {
			this.runPromises.delete(id);
			this.cancellationFlags.delete(id);
			this.pruneOldTasks();
			this.notifyStatusChange();
		}
	}

	private showCompletionNotice(task: BackgroundTask): void {
		if (task.outputPath) {
			const notice = new Notice(``, 8000);
			const fragment = notice.noticeEl;
			fragment.createSpan({ text: `✓ ${task.label} complete. ` });
			const link = fragment.createEl('a', { text: 'Open result', href: '#' });
			link.addEventListener('click', (e) => {
				e.preventDefault();
				this.plugin.app.workspace.openLinkText(task.outputPath!, '', false);
				notice.hide();
			});
		} else {
			new Notice(`✓ ${task.label} complete.`, 5000);
		}
	}

	/** Keep memory bounded — only keep the last MAX_RECENT finished tasks. */
	private pruneOldTasks(): void {
		const finished = this.getRecentTasks(BackgroundTaskManager.MAX_RECENT + 1);
		if (finished.length > BackgroundTaskManager.MAX_RECENT) {
			const toRemove = finished.slice(BackgroundTaskManager.MAX_RECENT);
			for (const t of toRemove) {
				this.tasks.delete(t.id);
			}
		}
	}

	/**
	 * Notify the status bar that counts have changed.
	 * The status bar pulls state via runningCount, so just triggering a re-render is enough.
	 */
	private notifyStatusChange(): void {
		this.plugin.backgroundStatusBar?.update();
	}

	/**
	 * Wait for all currently in-flight tasks of the given type to finish.
	 *
	 * Intended for callers that cancel() a group of tasks and then need to be
	 * certain those tasks have fully settled before proceeding (e.g. before
	 * re-initializing a manager whose state the tasks write to).
	 *
	 * @param type  If provided, only tasks of this type are awaited.
	 *              If omitted, all in-flight tasks are awaited.
	 */
	async drain(type?: string): Promise<void> {
		const promises: Promise<void>[] = [];
		for (const [id, promise] of this.runPromises) {
			if (type === undefined || this.tasks.get(id)?.type === type) {
				promises.push(promise);
			}
		}
		if (promises.length > 0) {
			await Promise.allSettled(promises);
		}
	}

	destroy(): void {
		// Signal all running tasks to stop. The flags must outlive tasks.clear() so
		// any in-flight run() that resumes after destroy can still see isCancelled() === true
		// and skip emitting backgroundTaskComplete / showing a completion Notice.
		// The existing finally { cancellationFlags.delete(id) } in run() handles cleanup.
		for (const task of this.getActiveTasks()) {
			this.cancellationFlags.set(task.id, true);
		}
		this.tasks.clear();
	}
}
