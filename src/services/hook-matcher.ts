// ─── Matcher / condition helpers ───────────────────────────────────────────────
//
// Pure functions that decide whether a hook fires for a given vault event:
// glob matching against the triggering file's path and frontmatter-filter
// evaluation. Extracted from hook-manager.ts (which keeps registry + dispatch)
// so the matching logic can be tested and reused in isolation.

/**
 * Compile a glob pattern (`*`, `**`, literal characters) into a RegExp.
 * Single `*` matches any character except `/`; `**` matches any path
 * including `/`. All other regex metacharacters are escaped so user globs
 * cannot accidentally form regex constructs.
 */
export function globToRegExp(glob: string): RegExp {
	// Walk the glob once, copying escaped literal characters and emitting
	// regex equivalents for `**` (matches any path including separators) and
	// `*` (matches any character except `/`). A single pass avoids the
	// sentinel-replace approach that needed an unprintable placeholder
	// character.
	let pattern = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*') {
			if (glob[i + 1] === '*') {
				pattern += '.*';
				i++;
			} else {
				pattern += '[^/]*';
			}
		} else if (/[.+^${}()|[\]\\]/.test(ch)) {
			pattern += '\\' + ch;
		} else {
			pattern += ch;
		}
	}
	return new RegExp(`^${pattern}$`);
}

/** Returns true if the path passes the glob (or no glob is provided). */
export function matchesGlob(path: string, glob: string | undefined): boolean {
	if (!glob) return true;
	return globToRegExp(glob).test(path);
}

/** Returns true if every key in `filter` equals the corresponding frontmatter value. */
export function matchesFrontmatterFilter(
	frontmatter: Record<string, unknown> | undefined,
	filter: Record<string, unknown> | undefined
): boolean {
	if (!filter) return true;
	if (!frontmatter) return false;
	for (const [key, expected] of Object.entries(filter)) {
		if (frontmatter[key] !== expected) return false;
	}
	return true;
}
