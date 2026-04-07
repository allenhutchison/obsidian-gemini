/**
 * Utility functions for formatting various types of data
 */

/**
 * Format a date as YYYY-MM-DD in the user's local timezone.
 * Unlike toISOString().slice(0, 10), this respects the local timezone
 * so late-night sessions don't show tomorrow's date.
 */
export function formatLocalDate(date: Date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Format a date as a full ISO 8601 timestamp with local timezone offset.
 * Example: "2026-04-07T18:45:30.123-05:00"
 */
export function formatLocalTimestamp(date: Date = new Date()): string {
	const pad = (n: number, digits = 2) => String(n).padStart(digits, '0');
	const offsetMinutes = date.getTimezoneOffset();
	const absOffset = Math.abs(offsetMinutes);
	const offsetSign = offsetMinutes <= 0 ? '+' : '-';
	const offsetHours = pad(Math.floor(absOffset / 60));
	const offsetMins = pad(absOffset % 60);

	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`.${pad(date.getMilliseconds(), 3)}${offsetSign}${offsetHours}:${offsetMins}`
	);
}

/**
 * Format file size in human-readable format
 * @param bytes - The size in bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Bytes';

	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
