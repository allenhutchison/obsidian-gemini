import { formatLocalDate, formatLocalTimestamp, formatFileSize } from '../../src/utils/format-utils';

describe('formatFileSize', () => {
	it('should format 0 bytes', () => {
		expect(formatFileSize(0)).toBe('0 Bytes');
	});

	it('should format kilobytes', () => {
		expect(formatFileSize(1024)).toBe('1 KB');
	});
});

describe('formatLocalDate', () => {
	it('should return YYYY-MM-DD format', () => {
		const result = formatLocalDate(new Date(2026, 3, 7)); // April 7, 2026 local
		expect(result).toBe('2026-04-07');
	});

	it('should use local timezone, not UTC', () => {
		// Create a date that is April 7 locally but could be April 8 in UTC
		const date = new Date(2026, 3, 7, 23, 30, 0); // 11:30 PM local on April 7
		expect(formatLocalDate(date)).toBe('2026-04-07');
	});

	it('should pad single-digit months and days', () => {
		const result = formatLocalDate(new Date(2026, 0, 5)); // Jan 5
		expect(result).toBe('2026-01-05');
	});

	it('should default to current date when no argument provided', () => {
		const fixedNow = new Date(2026, 3, 7, 23, 59, 59, 900);
		vi.useFakeTimers().setSystemTime(fixedNow);
		try {
			expect(formatLocalDate()).toBe('2026-04-07');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('formatLocalTimestamp', () => {
	it('should include timezone offset', () => {
		const result = formatLocalTimestamp(new Date(2026, 3, 7, 14, 30, 45, 123));
		// Should match pattern: YYYY-MM-DDTHH:MM:SS.mmm±HH:MM
		expect(result).toMatch(/^2026-04-07T14:30:45\.123[+-]\d{2}:\d{2}$/);
	});

	it('should use local time values, not UTC', () => {
		const date = new Date(2026, 3, 7, 23, 59, 59, 999);
		const result = formatLocalTimestamp(date);
		expect(result).toContain('T23:59:59.999');
	});

	it('should default to current time when no argument provided', () => {
		const before = new Date();
		const result = formatLocalTimestamp();
		const after = new Date();
		// Just verify it parses as a valid date within our window
		const parsed = new Date(result);
		expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
		expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
	});

	it('should produce a valid ISO 8601 timestamp', () => {
		const result = formatLocalTimestamp(new Date(2026, 0, 1, 0, 0, 0, 0));
		// Should be parseable back to a Date
		const parsed = new Date(result);
		expect(parsed.getFullYear()).toBe(2026);
		expect(parsed.getMonth()).toBe(0);
		expect(parsed.getDate()).toBe(1);
	});
});
