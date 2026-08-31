/**
 * Offset-based YAML-frontmatter scanner for **vault** definition files.
 *
 * Extracted from skill-manager.ts (#1417) so the feature-definition leaf —
 * consumed by FileBackedFeatureManager, HookManager, and ScheduledTaskManager —
 * can use it without importing a manager back (the leaf-helper rule in
 * .claude/guidelines/coding.md; the same reason skill-types.ts exists).
 * skill-manager.ts re-exports it, so existing import paths keep working.
 *
 * This is deliberately separate from the regex-based reader in
 * bundled-frontmatter.ts, which handles build-time-bundled markdown strings.
 * That module's header documents why the two are not interchangeable.
 *
 * A leaf module (imports nothing).
 */

/**
 * Find the character offset of the closing YAML frontmatter delimiter in a file's content.
 * Returns the offset immediately AFTER the closing delimiter token (`---` or `...`)
 * and BEFORE any trailing line break characters, or undefined if the content does not
 * begin with a valid frontmatter block.
 *
 * Unlike a naive `---[\s\S]*?---` regex, this walks the content line-by-line so that
 * `---` sequences appearing inside multi-line YAML string values (or body content) do
 * not prematurely terminate the frontmatter match.
 */
export function findFrontmatterEndOffset(content: string): number | undefined {
	// Frontmatter must begin on line 1 with a `---` marker.
	if (!/^---(\r?\n|$)/.test(content)) return undefined;

	// Walk character by character tracking line starts. We look for a line that
	// is exactly `---` (or `...`) as a closing marker per the YAML spec.
	let i = 0;
	const len = content.length;
	// Skip the opening `---` and its line terminator.
	i = content.indexOf('\n', 0);
	if (i === -1) return undefined;
	i += 1;

	while (i < len) {
		// Find end of current line.
		let lineEnd = content.indexOf('\n', i);
		if (lineEnd === -1) lineEnd = len;
		let line = content.slice(i, lineEnd);
		// Strip trailing CR for CRLF files.
		if (line.endsWith('\r')) line = line.slice(0, -1);
		if (line === '---' || line === '...') {
			// Closing marker — return offset just after it (before the newline).
			return i + line.length;
		}
		i = lineEnd + 1;
	}
	return undefined;
}
