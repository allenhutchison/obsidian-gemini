import { describe, it, expect } from 'vitest';
import { computeNextRunAt } from '../../../src/services/scheduled-tasks/schedule';

// The exhaustive schedule-parsing matrix lives in
// test/services/scheduled-task-manager.test.ts (exercising the re-export). These
// cases verify the pure helper works at its new module home and that each
// schedule family + validation branch is reachable through the direct import.
describe('scheduled-tasks/schedule · computeNextRunAt', () => {
	it('returns the far-future sentinel for a once schedule', () => {
		const result = computeNextRunAt('once', new Date(2026, 0, 1, 12, 0));
		expect(result.getTime()).toBe(8640000000000000);
	});

	it('advances 24h for daily', () => {
		const base = new Date(2026, 0, 1, 12, 0);
		expect(computeNextRunAt('daily', base)).toEqual(new Date(base.getTime() + 24 * 60 * 60 * 1000));
	});

	it('advances 7d for weekly', () => {
		const base = new Date(2026, 0, 1, 12, 0);
		expect(computeNextRunAt('weekly', base)).toEqual(new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000));
	});

	it('advances by minutes/hours for interval schedules', () => {
		const base = new Date(2026, 0, 1, 12, 0);
		expect(computeNextRunAt('interval:30m', base)).toEqual(new Date(base.getTime() + 30 * 60 * 1000));
		expect(computeNextRunAt('interval:2h', base)).toEqual(new Date(base.getTime() + 2 * 60 * 60 * 1000));
	});

	it('resolves the next daily@HH:MM slot, rolling to tomorrow when passed', () => {
		const before = new Date(2026, 0, 1, 9, 0);
		expect(computeNextRunAt('daily@16:30', before)).toEqual(new Date(2026, 0, 1, 16, 30));
		const after = new Date(2026, 0, 1, 17, 0);
		expect(computeNextRunAt('daily@16:30', after)).toEqual(new Date(2026, 0, 2, 16, 30));
	});

	it('resolves the next weekly@HH:MM:DAYS occurrence (case-insensitive)', () => {
		// 2026-04-14 is a Tuesday; ask for Saturday.
		const tue = new Date(2026, 3, 14, 9, 0);
		expect(computeNextRunAt('weekly@16:30:SAT', tue)).toEqual(new Date(2026, 3, 18, 16, 30));
	});

	it('throws on unknown and malformed schedules', () => {
		expect(() => computeNextRunAt('hourly', new Date())).toThrow();
		expect(() => computeNextRunAt('interval:0m', new Date())).toThrow('greater than zero');
		expect(() => computeNextRunAt('daily@25:00', new Date())).toThrow(/Hour must be 0-23/);
		expect(() => computeNextRunAt('weekly@16:30:funday', new Date())).toThrow(/Invalid weekday "funday"/);
		expect(() => computeNextRunAt('weekly@16:30:mon,,tue', new Date())).toThrow(/empty entries/);
	});
});
