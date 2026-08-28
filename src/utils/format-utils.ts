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

/**
 * Truncate free-form text for a confirmation-dialog preview (#1292).
 *
 * Encodes the three decisions every tool confirmation preview shares: the cut
 * length (200 chars by default), the ASCII `...` ellipsis (not `…`), and the
 * "only append when actually truncated" rule — at exactly `max` characters the
 * text is returned unchanged. Output must stay byte-identical to the previous
 * hand-rolled sites; changing the limit or the ellipsis is a separate,
 * i18n-aware change.
 *
 * @param text - The text to preview (model-supplied content, a description…)
 * @param max - Maximum preview length; longer text is cut and suffixed
 * @returns The original text when it fits, otherwise the first `max` characters plus `...`
 */
export function truncateForPreview(text: string, max = 200): string {
	return text.length > max ? text.slice(0, max) + '...' : text;
}
