import { t } from '../i18n';

/**
 * Format a past timestamp as a localized relative-time string, walking the
 * `justNow → minutes → hours → days → absolute date` ladder:
 *
 * - under 1 minute → "Just now"
 * - under 1 hour   → "N minute(s) ago"
 * - under 1 day    → "N hour(s) ago"
 * - under 7 days   → "N day(s) ago"
 * - otherwise      → the locale's short date (`toLocaleDateString()`)
 *
 * Singular/plural is selected by the caller-agnostic `count === 1` check and
 * resolved through the shared `time.*` i18n namespace, so every modal that
 * shows "X ago" stays consistent and a single translation edit covers them all.
 *
 * Note: `catch-up-modal.ts` deliberately keeps its own compact `{count}m ago`
 * formatter (no "just now" bucket, no singular/plural split, no date fallback)
 * because that UI wants a terse fixed-width age; it is not a candidate for this
 * helper.
 */
export function formatRelativeTime(timestamp: number | Date): string {
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
	const diffMs = Date.now() - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffMins < 1) {
		return t('time.justNow');
	}
	if (diffMins < 60) {
		return diffMins === 1
			? t('time.minuteAgoSingular', { count: diffMins })
			: t('time.minutesAgoPlural', { count: diffMins });
	}
	if (diffHours < 24) {
		return diffHours === 1
			? t('time.hourAgoSingular', { count: diffHours })
			: t('time.hoursAgoPlural', { count: diffHours });
	}
	if (diffDays < 7) {
		return diffDays === 1
			? t('time.dayAgoSingular', { count: diffDays })
			: t('time.daysAgoPlural', { count: diffDays });
	}
	return date.toLocaleDateString();
}
