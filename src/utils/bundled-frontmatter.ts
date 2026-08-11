/**
 * Minimal YAML-frontmatter reader for markdown that is **bundled into the
 * plugin at build time** — the `prompts/bundled-prompts/*.md` and
 * `prompts/bundled-skills/<name>/SKILL.md` files that esbuild inlines as
 * strings (see `src/declarations.d.ts`).
 *
 * This is deliberately separate from the two other frontmatter paths:
 *
 * - Vault files go through Obsidian's `app.metadataCache` /
 *   `fileManager.processFrontMatter()`, per the Obsidian-API-first rule. These
 *   strings never become `TFile`s, so there is no cache entry to read.
 * - `extractMarkdownBody()` in `src/services/feature-definition.ts` strips
 *   frontmatter from *vault* definition files (hooks, scheduled tasks) using a
 *   different offset-based scanner; it is not interchangeable with this one.
 *
 * A leaf module (imports nothing) so both `src/prompts/bundled-prompts.ts` and
 * `src/services/bundled-skills.ts` can depend on it without either importing
 * the other.
 */

/** Match a leading `---` … `---` block; group 1 is the frontmatter body. */
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Match the whole leading frontmatter block including its trailing newline. */
const FRONTMATTER_WITH_TERMINATOR = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Escape regex metacharacters so a key is matched literally. Callers pass
 * literals today, but an unescaped `.` in e.g. `model.name` would also match
 * `modelXname`, and an unescaped `|` would match a different property entirely.
 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip YAML frontmatter from a markdown string, returning only the body. */
export function stripFrontmatter(md: string): string {
	const match = md.match(FRONTMATTER_WITH_TERMINATOR);
	if (match) {
		return md.slice(match[0].length).trim();
	}
	return md.trim();
}

/**
 * Read a scalar `key: value` line out of the frontmatter block.
 *
 * Returns `''` when there is no frontmatter or the key is absent. Surrounding
 * single or double quotes are removed, so `name: 'Fix Grammar'` and
 * `name: Fix Grammar` both yield `Fix Grammar`.
 */
export function parseFrontmatterProperty(md: string, key: string): string {
	const match = md.match(FRONTMATTER_BLOCK);
	if (!match) return '';
	const propMatch = match[1].match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'm'));
	if (!propMatch) return '';

	const value = propMatch[1].trim();
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1);
	}
	if (value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}
	return value;
}

/**
 * Read an inline-array `key: ["a", "b"]` line out of the frontmatter block.
 *
 * Returns `[]` when there is no frontmatter, the key is absent, or the value
 * is not in inline-array form. Block-sequence (`- item`) syntax is not
 * supported — the bundled files all use the inline form.
 */
export function parseFrontmatterList(md: string, key: string): string[] {
	const match = md.match(FRONTMATTER_BLOCK);
	if (!match) return [];
	const listMatch = match[1].match(new RegExp(`^${escapeRegExp(key)}:\\s*\\[(.*)\\]`, 'm'));
	if (!listMatch) return [];

	return listMatch[1]
		.split(',')
		.map((item) => item.trim().replace(/['"]/g, ''))
		.filter((item) => item.length > 0);
}
