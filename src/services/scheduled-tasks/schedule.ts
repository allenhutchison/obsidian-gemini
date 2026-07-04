// Pure schedule-math helpers extracted from ScheduledTaskManager. No I/O and no
// dependency on plugin/vault state, so every function here is safe to unit-test
// in isolation.

// Day-of-week codes accepted in `weekly@HH:MM:DAYS` schedules. Order matches
// JS Date.getDay() so the array index doubles as the weekday number.
const WEEKDAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type WeekdayCode = (typeof WEEKDAY_CODES)[number];

/**
 * Compute the next run time given a schedule string and a reference instant.
 * Pure function — no I/O — safe to unit-test in isolation.
 *
 * @throws {Error} if the schedule string is not recognised
 */
export function computeNextRunAt(schedule: string, from: Date): Date {
	switch (schedule) {
		case 'once':
			// Far-future sentinel: task has run once and should not fire again
			return new Date(8640000000000000);
		case 'daily':
			return new Date(from.getTime() + 24 * 60 * 60 * 1000);
		case 'weekly':
			return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
		default: {
			if (schedule.startsWith('interval:')) {
				const spec = schedule.slice('interval:'.length);
				const match = /^(\d+)(m|h)$/.exec(spec);
				if (!match) {
					throw new Error(`Invalid interval schedule: "${schedule}". Expected format: interval:Xm or interval:Xh`);
				}
				const value = parseInt(match[1], 10);
				if (value <= 0) {
					throw new Error(`Invalid interval schedule: "${schedule}". Interval must be greater than zero`);
				}
				const ms = match[2] === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
				return new Date(from.getTime() + ms);
			}
			if (schedule.startsWith('daily@')) {
				const { hour, minute } = parseHourMinute(schedule, schedule.slice('daily@'.length));
				return nextOccurrenceAtTime(from, hour, minute);
			}
			if (schedule.startsWith('weekly@')) {
				const rest = schedule.slice('weekly@'.length).toLowerCase();
				const match = /^(\d{1,2}:\d{2}):(.+)$/.exec(rest);
				if (!match) {
					throw new Error(
						`Invalid weekly schedule: "${schedule}". Expected format: weekly@HH:MM:days (e.g. weekly@16:30:mon,tue,wed)`
					);
				}
				const { hour, minute } = parseHourMinute(schedule, match[1]);
				const allowedDays = parseWeekdayList(schedule, match[2]);
				return nextOccurrenceOnAllowedDay(from, hour, minute, allowedDays);
			}
			throw new Error(
				`Unknown schedule type: "${schedule}". Expected: once, daily, weekly, interval:Xm, interval:Xh, daily@HH:MM, weekly@HH:MM:days`
			);
		}
	}
}

/**
 * Parse a `HH:MM` time component out of a `daily@…` or `weekly@…` schedule
 * and validate that hour/minute are in range. The full schedule string is
 * passed in only so the error messages can quote the offending value.
 */
function parseHourMinute(schedule: string, time: string): { hour: number; minute: number } {
	const match = /^(\d{1,2}):(\d{2})$/.exec(time);
	if (!match) {
		throw new Error(`Invalid schedule time in "${schedule}". Expected HH:MM (24-hour, e.g. 16:30)`);
	}
	const hour = parseInt(match[1], 10);
	const minute = parseInt(match[2], 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		throw new Error(`Invalid schedule time in "${schedule}". Hour must be 0-23 and minute must be 0-59`);
	}
	return { hour, minute };
}

/**
 * Parse the comma-separated weekday list from a `weekly@HH:MM:days` schedule
 * into a Set of weekday numbers (0 = Sunday … 6 = Saturday). Empty lists,
 * unknown codes, and stray separators are all rejected.
 */
function parseWeekdayList(schedule: string, days: string): Set<number> {
	const tokens = days.split(',').map((d) => d.trim());
	if (tokens.some((t) => t.length === 0)) {
		throw new Error(`Invalid weekly schedule "${schedule}": days list contains empty entries`);
	}
	const result = new Set<number>();
	for (const token of tokens) {
		const idx = WEEKDAY_CODES.indexOf(token as WeekdayCode);
		if (idx === -1) {
			throw new Error(`Invalid weekday "${token}" in "${schedule}". Expected one of: ${WEEKDAY_CODES.join(', ')}`);
		}
		result.add(idx);
	}
	return result;
}

/**
 * Return the next Date strictly after `from` whose local time is `hour:minute`.
 * Today's slot is preferred when it's still in the future; otherwise tomorrow's.
 */
function nextOccurrenceAtTime(from: Date, hour: number, minute: number): Date {
	const candidate = new Date(from);
	candidate.setHours(hour, minute, 0, 0);
	if (candidate.getTime() > from.getTime()) return candidate;
	candidate.setDate(candidate.getDate() + 1);
	return candidate;
}

/**
 * Return the next Date strictly after `from` whose local time is `hour:minute`
 * AND whose weekday is in `allowedDays`. The set is non-empty (validated by
 * the caller), so the search terminates within 8 days: each weekday-and-time
 * pair is checked once over the next 7 days, plus a final wrap-around for the
 * case where today's allowed slot has already passed and no later day in the
 * week qualifies.
 */
function nextOccurrenceOnAllowedDay(from: Date, hour: number, minute: number, allowedDays: Set<number>): Date {
	for (let offset = 0; offset <= 7; offset++) {
		const candidate = new Date(from);
		candidate.setDate(candidate.getDate() + offset);
		candidate.setHours(hour, minute, 0, 0);
		if (allowedDays.has(candidate.getDay()) && candidate.getTime() > from.getTime()) {
			return candidate;
		}
	}
	// Unreachable: with a non-empty allowedDays set, one of the 8 candidates
	// above always matches. Throw rather than return a wrong value if the
	// invariant ever breaks.
	throw new Error(
		`Internal error: failed to compute next run for weekly schedule (allowedDays=${[...allowedDays].join(',')})`
	);
}
