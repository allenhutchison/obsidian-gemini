/**
 * Soft turn budget for the agent tool-execution loop.
 *
 * Layers a *soft* budget on top of the loop's existing hard iteration cap
 * (`AgentLoopOptions.maxIterations`). Where the hard cap is a dumb stop — the
 * run just dies with `exhausted: true` the moment it's hit — this helper adds
 * two behaviours the paper "More with Less: An Empirical Study of Turn-Control
 * Strategies for Efficient Coding Agents" (arXiv 2510.16786) found beat a fixed
 * cap by 12–24%:
 *
 *  1. **Reminder** — when only a few turns remain, the loop injects an
 *     "ENVIRONMENT REMINDER: you have N turns left" line so the model can wrap
 *     up instead of being cut off mid-thought.
 *  2. **One-shot extension** — when the budget is spent but the model still
 *     wants to call tools (i.e. it hasn't produced a final answer), the budget
 *     grants a single extra allotment so a task that needs "just a couple more"
 *     turns isn't killed at the cap. A second expiry falls through to the
 *     hard-stop `exhausted` path.
 *
 * This class owns only the *bookkeeping*: it does not know about the loop, the
 * model, or history. The loop drives it (`isExhausted`, `shouldRemind`,
 * `grantExtension`) and performs the actual injection.
 *
 * An *unlimited* budget (constructed from `undefined`) is inert: it never
 * reminds, never exhausts, and never extends — matching the loop's "no cap"
 * default for callers that pass no `maxIterations`.
 */

/** Default number of remaining turns at or below which the reminder fires. */
export const DEFAULT_TURN_BUDGET_REMIND_AT = 3;

export interface TurnBudgetOptions {
	/** Inject the reminder when remaining turns falls to this many or fewer. */
	remindAt?: number;
	/**
	 * Turns added by the one-shot extension. Defaults to half the initial
	 * limit (rounded up, minimum 1) — enough to let a nearly-done task finish
	 * without doubling the cost of a runaway one.
	 */
	extensionTurns?: number;
	/**
	 * Optional view onto the current prefix-cache hit ratio (0–1). Reserved for
	 * the cache-aware extension heuristic (#622 follow-up): granting turns is
	 * cheap when the cache is warm and far costlier right after a compaction
	 * that wiped the cached prefix. Stored and exposed but **not** yet consulted
	 * by `grantExtension` — wiring it in needs no signature change.
	 */
	getCachedRatio?: () => number | undefined;
}

export class TurnBudget {
	private currentLimit: number | undefined;
	private readonly remindAt: number;
	private readonly extensionTurns: number;
	private readonly getCachedRatioFn?: () => number | undefined;
	private extensionGranted = false;

	/**
	 * @param limit Total tool-execution batches allowed before the budget is
	 *   spent. `undefined` means unlimited (the loop's no-cap default).
	 */
	constructor(limit: number | undefined, options: TurnBudgetOptions = {}) {
		this.currentLimit = limit;
		this.remindAt = options.remindAt ?? DEFAULT_TURN_BUDGET_REMIND_AT;
		this.extensionTurns = options.extensionTurns ?? (limit !== undefined ? Math.max(1, Math.ceil(limit / 2)) : 0);
		this.getCachedRatioFn = options.getCachedRatio;
	}

	/** True when this budget imposes no cap (constructed from `undefined`). */
	isUnlimited(): boolean {
		return this.currentLimit === undefined;
	}

	/** The current limit including any granted extension (`undefined` = unlimited). */
	get limit(): number | undefined {
		return this.currentLimit;
	}

	/**
	 * Turns left after `used` batches have run. `Infinity` for an unlimited
	 * budget. Never negative.
	 */
	remaining(used: number): number {
		if (this.currentLimit === undefined) return Infinity;
		return Math.max(0, this.currentLimit - used);
	}

	/**
	 * True once `used` batches have consumed the entire current limit. The loop
	 * checks this at the top of each iteration: if the model still has pending
	 * tool calls at that point, the budget is spent but the work isn't done.
	 */
	isExhausted(used: number): boolean {
		return this.currentLimit !== undefined && used >= this.currentLimit;
	}

	/**
	 * True when the reminder should be injected: a finite budget with between 1
	 * and `remindAt` turns left (inclusive). Returns false at 0 remaining — by
	 * then the extension/exhaustion path takes over.
	 */
	shouldRemind(used: number): boolean {
		if (this.currentLimit === undefined) return false;
		const left = this.remaining(used);
		return left > 0 && left <= this.remindAt;
	}

	/**
	 * True when a one-shot extension is still available to grant. A
	 * zero-turn extension (`extensionTurns: 0`) is never grantable — otherwise
	 * the budget would be marked extended and an extension notice emitted
	 * without actually adding any turns.
	 */
	canExtend(): boolean {
		return this.currentLimit !== undefined && !this.extensionGranted && this.extensionTurns > 0;
	}

	/**
	 * Grant the one-shot extension, raising the limit by `extensionTurns`.
	 * Returns the number of turns added, or 0 if an extension was already
	 * granted or the budget is unlimited. Idempotent after the first grant.
	 */
	grantExtension(): number {
		if (!this.canExtend()) return 0;
		this.extensionGranted = true;
		this.currentLimit = (this.currentLimit as number) + this.extensionTurns;
		return this.extensionTurns;
	}

	/** Whether the one-shot extension has been granted. */
	get wasExtended(): boolean {
		return this.extensionGranted;
	}

	/**
	 * Current prefix-cache hit ratio via the injected callback, or `undefined`
	 * when no callback was provided. Reserved for the cache-aware extension
	 * follow-up; see {@link TurnBudgetOptions.getCachedRatio}.
	 */
	getCachedRatio(): number | undefined {
		return this.getCachedRatioFn?.();
	}
}
