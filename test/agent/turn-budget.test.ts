import { TurnBudget, DEFAULT_TURN_BUDGET_REMIND_AT } from '../../src/agent/turn-budget';

describe('TurnBudget', () => {
	describe('finite budget', () => {
		test('tracks remaining turns and exhaustion against the limit', () => {
			const budget = new TurnBudget(5);
			expect(budget.isUnlimited()).toBe(false);
			expect(budget.limit).toBe(5);
			expect(budget.remaining(0)).toBe(5);
			expect(budget.remaining(2)).toBe(3);
			expect(budget.remaining(5)).toBe(0);
			expect(budget.isExhausted(4)).toBe(false);
			expect(budget.isExhausted(5)).toBe(true);
			expect(budget.isExhausted(6)).toBe(true);
		});

		test('remaining never goes negative', () => {
			const budget = new TurnBudget(3);
			expect(budget.remaining(10)).toBe(0);
		});

		test('reminds only within the default threshold window (1..remindAt)', () => {
			const budget = new TurnBudget(10);
			// remindAt defaults to 3 → reminds at remaining 3, 2, 1
			expect(budget.shouldRemind(6)).toBe(false); // 4 left
			expect(budget.shouldRemind(7)).toBe(true); // 3 left
			expect(budget.shouldRemind(8)).toBe(true); // 2 left
			expect(budget.shouldRemind(9)).toBe(true); // 1 left
			expect(budget.shouldRemind(10)).toBe(false); // 0 left — extension/exhaust takes over
			expect(DEFAULT_TURN_BUDGET_REMIND_AT).toBe(3);
		});

		test('honours a custom remindAt', () => {
			const budget = new TurnBudget(10, { remindAt: 1 });
			expect(budget.shouldRemind(8)).toBe(false); // 2 left
			expect(budget.shouldRemind(9)).toBe(true); // 1 left
		});
	});

	describe('one-shot extension', () => {
		test('default extension is half the initial limit (rounded up, min 1)', () => {
			expect(new TurnBudget(20).grantExtension()).toBe(10);
			expect(new TurnBudget(3).grantExtension()).toBe(2);
			expect(new TurnBudget(1).grantExtension()).toBe(1);
		});

		test('grant raises the limit and only fires once', () => {
			const budget = new TurnBudget(4);
			expect(budget.canExtend()).toBe(true);
			expect(budget.wasExtended).toBe(false);

			const granted = budget.grantExtension();
			expect(granted).toBe(2);
			expect(budget.limit).toBe(6);
			expect(budget.wasExtended).toBe(true);
			expect(budget.canExtend()).toBe(false);

			// Second attempt is a no-op.
			expect(budget.grantExtension()).toBe(0);
			expect(budget.limit).toBe(6);
		});

		test('honours a custom extensionTurns', () => {
			const budget = new TurnBudget(10, { extensionTurns: 5 });
			expect(budget.grantExtension()).toBe(5);
			expect(budget.limit).toBe(15);
		});
	});

	describe('unlimited budget', () => {
		test('is inert: never reminds, exhausts, or extends', () => {
			const budget = new TurnBudget(undefined);
			expect(budget.isUnlimited()).toBe(true);
			expect(budget.limit).toBeUndefined();
			expect(budget.remaining(1000)).toBe(Infinity);
			expect(budget.isExhausted(1000)).toBe(false);
			expect(budget.shouldRemind(1000)).toBe(false);
			expect(budget.canExtend()).toBe(false);
			expect(budget.grantExtension()).toBe(0);
			expect(budget.limit).toBeUndefined();
		});
	});

	describe('cache ratio callback', () => {
		test('exposes the injected ratio, or undefined when absent', () => {
			expect(new TurnBudget(5).getCachedRatio()).toBeUndefined();
			const budget = new TurnBudget(5, { getCachedRatio: () => 0.75 });
			expect(budget.getCachedRatio()).toBe(0.75);
		});
	});
});
