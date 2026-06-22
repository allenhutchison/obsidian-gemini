import { getRawErrorMessage } from '../utils/error-utils';
import type { Logger } from '../utils/logger';

/**
 * Shared "auto-pause after N consecutive failures" behavior for the markdown-defined
 * feature managers — HookManager and ScheduledTaskManager. Both walk the identical
 * prev-state → bump counter → derive `pausedDueToErrors` → save → log ladder over their
 * per-entry JSON sidecar state, and both expose the same "clear the failure state" reset.
 * This is the error-recovery layer on top of the sidecar scaffolding in `feature-definition.ts`:
 * that file owns the state I/O, this file owns the failure/pause policy that mutates it.
 */

/** Pause an entity after this many consecutive failures. Shared by every subsystem that auto-pauses. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * The slice of per-entity sidecar state the failure-pause ladder reads and writes.
 * Managers embed these fields in their own state shape (HookState, TaskState, …).
 */
export interface FailurePauseState {
	/** Error message from the most recent failed run, if any. */
	lastError?: string;
	/** Number of consecutive failures since the last success. */
	consecutiveFailures?: number;
	/** When true the entity is auto-paused until manually reset. */
	pausedDueToErrors?: boolean;
}

/** Outcome of {@link FailurePauseTracker.recordFailure}. */
export interface FailureOutcome {
	consecutiveFailures: number;
	pausedDueToErrors: boolean;
}

/**
 * Entity-specific fields a caller may merge into the state on success/failure/reset
 * (e.g. `lastRunAt`, `nextRunAt`). The fields the ladder owns — the {@link FailureOutcome}
 * counters and `lastError` — are excluded so a patch can't even express an override the
 * tracker would silently discard (it always re-derives those after spreading the patch).
 */
export type EntityPatch<TState extends FailurePauseState> = Partial<Omit<TState, keyof FailureOutcome | 'lastError'>>;

export interface FailurePauseTrackerOptions<TState extends FailurePauseState> {
	/** Read the current in-memory record for a slug (undefined if none yet). */
	getState: (slug: string) => TState | undefined;
	/** Persist the next record for a slug — callers wire this to `this.state[slug] = next; saveState()`. */
	setState: (slug: string, next: TState) => void | Promise<void>;
	logger: Logger;
	/** Message prefix, e.g. `[HookManager]`. */
	label: string;
	/** Entity noun used in log messages, e.g. `Hook` or `Task`. */
	entityNoun: string;
	/** Failures before pausing. Defaults to {@link MAX_CONSECUTIVE_FAILURES}. */
	maxFailures?: number;
	/**
	 * When true, a non-pausing failure is logged at error level (the hook manager's
	 * behavior). When false, the caller owns failure logging — e.g. the scheduled-task
	 * manager re-throws and lets the background runner surface the error. Defaults to false.
	 */
	logFailures?: boolean;
}

/**
 * Owns the shared "auto-pause after N consecutive failures" ladder over a manager's
 * per-entity sidecar state: bump the counter, derive `pausedDueToErrors`, persist, log.
 *
 * Pure delegation — the tracker never touches the state file directly. Callers wire
 * `getState`/`setState` to their existing in-memory record + `saveState()` plumbing, so
 * each manager keeps its own sidecar format. Entity-specific fields (a fresh `lastRunAt`
 * on success, a fresh `nextRunAt` on reset, …) flow in through the optional `patch`
 * argument without the tracker needing to know about them.
 */
export class FailurePauseTracker<TState extends FailurePauseState> {
	private readonly maxFailures: number;
	private readonly logFailures: boolean;

	constructor(private readonly options: FailurePauseTrackerOptions<TState>) {
		this.maxFailures = options.maxFailures ?? MAX_CONSECUTIVE_FAILURES;
		this.logFailures = options.logFailures ?? false;
	}

	/** True when the entity is currently auto-paused. */
	isPaused(slug: string): boolean {
		return this.options.getState(slug)?.pausedDueToErrors ?? false;
	}

	/** Clear the failure counters after a successful run. `patch` carries entity-specific fields. */
	async recordSuccess(slug: string, patch?: EntityPatch<TState>): Promise<void> {
		const prev = this.options.getState(slug);
		// Precondition: a record already exists for this slug. The ladder only ever
		// clears/derives the failure fields on top of state the manager has already
		// seeded (advanceState for tasks, recordFire for hooks). Fabricating a record
		// for an unknown slug would cast away required fields the patch doesn't supply
		// (e.g. TaskState.nextRunAt) and persist `undefined`, so no-op instead — mirroring
		// `reset`. A missing record on success is harmless (nothing to clear) so it's silent.
		if (!prev) return;
		const next = {
			...prev,
			...patch,
			lastError: undefined,
			consecutiveFailures: 0,
			pausedDueToErrors: false,
		} as TState;
		await this.options.setState(slug, next);
	}

	/**
	 * Record a failed run: bump the counter, pause once it reaches the threshold, persist,
	 * and warn when newly paused. `patch` carries entity-specific fields.
	 */
	async recordFailure(slug: string, error: unknown, patch?: EntityPatch<TState>): Promise<FailureOutcome> {
		const prev = this.options.getState(slug);
		// See recordSuccess: the failure ladder builds on an existing record. Unlike
		// success, a missing record here is a wiring bug (the manager should have seeded
		// state before the run), so fail loudly rather than persist a record with required
		// fields cast away. The caller re-throws into the background runner regardless.
		if (!prev) {
			throw new Error(`${this.options.label} cannot record a failure for unknown ${this.options.entityNoun} "${slug}"`);
		}
		const consecutiveFailures = (prev.consecutiveFailures ?? 0) + 1;
		const pausedDueToErrors = consecutiveFailures >= this.maxFailures;
		const next = {
			...prev,
			...patch,
			lastError: getRawErrorMessage(error),
			consecutiveFailures,
			pausedDueToErrors,
		} as TState;
		await this.options.setState(slug, next);

		const { logger, label, entityNoun } = this.options;
		if (pausedDueToErrors) {
			logger.warn(`${label} ${entityNoun} "${slug}" paused after ${this.maxFailures} consecutive failures`);
		} else if (this.logFailures) {
			logger.error(`${label} ${entityNoun} "${slug}" failed:`, error);
		}

		return { consecutiveFailures, pausedDueToErrors };
	}

	/**
	 * Manually clear the failure/pause state so a paused entity can run again. No-op when no
	 * record exists. `patch` carries entity-specific fields (e.g. a fresh `nextRunAt`).
	 */
	async reset(slug: string, patch?: EntityPatch<TState>): Promise<void> {
		const prev = this.options.getState(slug);
		if (!prev) return;
		const next = {
			...prev,
			...patch,
			lastError: undefined,
			consecutiveFailures: 0,
			pausedDueToErrors: false,
		} as TState;
		await this.options.setState(slug, next);
	}
}
