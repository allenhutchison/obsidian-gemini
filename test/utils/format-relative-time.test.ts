import { formatRelativeTime } from '../../src/utils/format-relative-time';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Fixed "now" so every case is deterministic regardless of when the suite runs.
const NOW = new Date('2026-06-22T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Build a timestamp `ms` in the past relative to the frozen now. */
	const ago = (ms: number) => NOW - ms;

	describe('justNow bucket (< 1 minute)', () => {
		it('returns "Just now" at 0 seconds', () => {
			expect(formatRelativeTime(ago(0))).toBe('Just now');
		});

		it('returns "Just now" at 59 seconds (still under a minute)', () => {
			expect(formatRelativeTime(ago(59 * SECOND))).toBe('Just now');
		});
	});

	describe('minutes bucket', () => {
		it('switches to "1 minute ago" (singular) at exactly 60 seconds', () => {
			expect(formatRelativeTime(ago(MINUTE))).toBe('1 minute ago');
		});

		it('uses the plural form for 2 minutes', () => {
			expect(formatRelativeTime(ago(2 * MINUTE))).toBe('2 minutes ago');
		});

		it('stays in minutes at 59 minutes', () => {
			expect(formatRelativeTime(ago(59 * MINUTE))).toBe('59 minutes ago');
		});
	});

	describe('hours bucket', () => {
		it('switches to "1 hour ago" (singular) at exactly 60 minutes', () => {
			expect(formatRelativeTime(ago(HOUR))).toBe('1 hour ago');
		});

		it('stays in hours (plural) at 23 hours', () => {
			expect(formatRelativeTime(ago(23 * HOUR))).toBe('23 hours ago');
		});
	});

	describe('days bucket', () => {
		it('switches to "1 day ago" (singular) at exactly 24 hours', () => {
			expect(formatRelativeTime(ago(DAY))).toBe('1 day ago');
		});

		it('stays in days (plural) at 6 days', () => {
			expect(formatRelativeTime(ago(6 * DAY))).toBe('6 days ago');
		});
	});

	describe('absolute-date fallback (>= 7 days)', () => {
		it('falls back to the locale date string at exactly 7 days', () => {
			const ts = ago(7 * DAY);
			expect(formatRelativeTime(ts)).toBe(new Date(ts).toLocaleDateString());
		});

		it('does not produce a relative "ago" string for old timestamps', () => {
			expect(formatRelativeTime(ago(30 * DAY))).not.toMatch(/ago$/);
		});
	});

	describe('input forms', () => {
		it('accepts a Date as well as a numeric timestamp', () => {
			expect(formatRelativeTime(new Date(ago(2 * HOUR)))).toBe('2 hours ago');
		});
	});
});
