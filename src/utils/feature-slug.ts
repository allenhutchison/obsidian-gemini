/**
 * The slug contract shared by the vault-backed features whose user-supplied
 * identifier becomes a file basename inside the plugin state folder — hooks,
 * scheduled tasks, and skills (#1485).
 *
 * One predicate, two contracts: hooks and tasks accept `2fa-cleanup`-shaped
 * slugs (leading digit is fine); skills must start with a letter per the
 * agentskills.io spec. The divergence is this module's parameter, not a
 * second regex — the leading-character rule is the only difference, so the
 * rest of the contract (lowercase ASCII, hyphens as separators, 1–64 chars,
 * no leading/trailing/consecutive hyphens, no path separators or `..`)
 * cannot drift between the three call sites again.
 *
 * Kept a leaf module: services and UI import it; nothing may import back
 * (the #1155 acyclic-graph rule).
 *
 * Scope note: `sanitizeKeySegment` in `src/mcp/mcp-oauth-provider.ts` is
 * deliberately NOT routed through here — it sanitizes secret-storage keys
 * with a deliberate hash fallback, a different job from validating a
 * file-bound identifier.
 */

/** The longest slug any consuming feature accepts. */
export const FEATURE_SLUG_MAX = 64;

export interface FeatureSlugValidation {
	valid: boolean;
	/** Present when `valid` is false; describes the first failing rule. */
	error?: string;
}

/**
 * Validates a feature slug: lowercase ASCII letters/digits, hyphens as
 * separators, 1–64 chars, no leading/trailing or consecutive hyphens, no
 * path separators or `..` (a slug becomes a file basename — `normalizePath`
 * collapses separators but does not resolve `..`).
 *
 * `requireLeadingLetter` narrows for the agentskills.io skill contract
 * (skills must start with a letter; hooks and tasks do not have to).
 * Returns a result object rather than throwing so each caller keeps its own
 * error wording — the predicate is shared, the message is not.
 */
export function validateFeatureSlug(
	raw: string,
	options: { requireLeadingLetter?: boolean } = {}
): FeatureSlugValidation {
	const slug = raw.trim();

	if (!slug) {
		return { valid: false, error: 'cannot be empty' };
	}
	if (slug.length > FEATURE_SLUG_MAX) {
		return { valid: false, error: `must be at most ${FEATURE_SLUG_MAX} characters` };
	}
	if (options.requireLeadingLetter && !/^[a-z]/.test(slug)) {
		return { valid: false, error: 'must start with a lowercase letter' };
	}
	if (slug.includes('--')) {
		return { valid: false, error: 'must not contain consecutive hyphens' };
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
		return { valid: false, error: 'must be lowercase letters, digits, and single hyphens only' };
	}
	return { valid: true };
}
