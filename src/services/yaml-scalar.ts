/**
 * The one answer to "how do I write a string into a hand-rolled YAML
 * frontmatter block?"
 *
 * Several writers in this codebase build frontmatter line-by-line into a
 * `string[]` rather than going through `processFrontMatter` (they create or
 * rewrite a whole file, body included, so `processFrontMatter` is not a
 * drop-in). Before this module each of them invented its own quoting rule,
 * which meant a correctness fix applied to one writer structurally could not
 * reach the others — exactly what happened with #1347, whose fix landed as a
 * module-private helper in the scheduler and never reached the sibling hook
 * writer (#1352).
 *
 * This module is a leaf: it imports nothing, so every writer can depend on it
 * without re-introducing the import cycles #1155 removed.
 */

/** Tab survives a single-quoted scalar intact, so it is not a reason to re-quote. */
const TAB = 0x09;

/**
 * Does this string contain a character a single-quoted scalar cannot round-trip?
 * That is every C0 control except tab — see the escape-set note in `yamlScalar`.
 */
function needsDoubleQuotes(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f && code !== TAB) return true;
	}
	return false;
}

/**
 * Render a string as a YAML scalar that parses back to exactly that string.
 *
 * Normally that is a **single-quoted** scalar, which escapes an embedded `'` by
 * doubling it. Interpolating a raw value instead terminates the scalar early,
 * which makes the whole frontmatter block unparseable — and because these
 * definition files are read back through `metadataCache`, an unparseable block
 * makes the definition *silently vanish* from its manager rather than fail
 * loudly. A user-entered `outputPath` with an apostrophe ("Allen's
 * Notes/{date}.md") is the realistic way to hit it.
 *
 * The quoting is unconditional rather than only-when-needed: a conditional is a
 * second rule to get wrong, and a quoted scalar is valid YAML for every string.
 * That also neutralises the values that break a *plain* scalar without
 * containing a quote at all — a leading `#`, `[`, `{`, `&`, or `*`, or an
 * embedded `: ` that would otherwise turn the line into a nested map.
 *
 * Single quotes (rather than the double quotes `JSON.stringify` produces) are
 * the convention the docs and the majority of on-disk files already use.
 *
 * This is a **string** emitter. Numbers and booleans are written raw by their
 * call sites so they keep their YAML type; values typed `unknown` go through
 * `JSON.stringify`, which emits a valid YAML flow scalar for any JSON value.
 *
 * The same rule applies in all three positions these writers emit, so callers
 * supply the surrounding indentation and punctuation themselves:
 *
 * ```ts
 * lines.push(`outputPath: ${yamlScalar(path)}`);          // scalar
 * lines.push(`  - ${yamlScalar(skill)}`);                 // sequence item
 * lines.push(`  ${yamlScalar(key)}: ${yamlScalar(val)}`); // map entry
 * ```
 */
export function yamlScalar(value: string): string {
	if (needsDoubleQuotes(value)) {
		// A single-quoted scalar has no escape sequence but `''`, so it cannot
		// carry these characters. YAML *folds* a line break inside a flow scalar
		// into a space, so a single-quoted `a\nb` parses back as `a b` — silent
		// content loss rather than a visible error — and Obsidian's parser
		// rejects a raw control character outright, which takes the whole block
		// down. A double-quoted scalar escapes both. JSON's escape set (`\n`,
		// `\r`, `\t`, `\b`, `\f`, `\\`, `\"`, `\uXXXX`) is a subset of YAML's, so
		// `JSON.stringify` is a correct double-quoted YAML emitter here.
		return JSON.stringify(value);
	}
	return `'${value.replace(/'/g, "''")}'`;
}
