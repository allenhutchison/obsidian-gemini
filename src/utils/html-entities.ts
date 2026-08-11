/**
 * HTML entity encoding and decoding.
 *
 * Decoding: Gemini models (especially Flash Lite) sometimes return HTML
 * entities despite system prompt instructions not to. Entities can be double
 * or triple-encoded (e.g., &amp;amp;quot; → &amp;quot; → &quot; → ").
 *
 * Encoding: {@link escapeHtml} is the shared escaper for the places that build
 * HTML strings by hand — grounding-citation rendering and the MCP OAuth
 * callback page. It lives here, in a leaf module both can import, rather than
 * being re-implemented at each call site.
 */

/**
 * Escape a string for safe interpolation into HTML text/attribute context.
 *
 * Escapes the five significant characters (`& < > " '`). `&` is replaced first
 * so the entities introduced by the later replacements are not re-escaped.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Named HTML entities we decode. */
const NAMED_ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
	'&nbsp;': '\u00A0',
};

/** Pattern matching any HTML entity we handle. */
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos|nbsp|#\d{1,6}|#x[0-9a-fA-F]{1,6});/;

/** Maximum decode iterations to prevent infinite loops on malformed input. */
const MAX_ITERATIONS = 5;

/**
 * Decode a single pass of HTML entities in a string.
 * Handles named, decimal numeric, and hex numeric entities.
 */
function decodeOnce(text: string): string {
	return text.replace(
		/&(?:#x([0-9a-fA-F]{1,6})|#(\d{1,6})|([a-zA-Z]+));/g,
		(match: string, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
			if (hex) {
				try {
					return String.fromCodePoint(parseInt(hex, 16));
				} catch {
					return match; // Invalid code point, leave as-is
				}
			}
			if (dec) {
				try {
					return String.fromCodePoint(parseInt(dec, 10));
				} catch {
					return match; // Invalid code point, leave as-is
				}
			}
			if (named) {
				const key = `&${named};`;
				return NAMED_ENTITIES[key] ?? match;
			}
			return match;
		}
	);
}

/**
 * Decode HTML entities in text, preserving content inside fenced code blocks.
 *
 * Iteratively decodes until no more entities remain or the iteration cap
 * is reached. Code blocks (``` … ```) are left untouched since entities
 * inside them may be intentional.
 */
export function decodeHtmlEntities(text: string): string {
	if (!text) return text;

	// Split on fenced code blocks, preserving the delimiters.
	// Odd-indexed segments are inside code fences.
	const parts = text.split(/(```[\s\S]*?```)/);

	for (let i = 0; i < parts.length; i++) {
		// Skip code blocks (odd indices)
		if (i % 2 !== 0) continue;

		let segment = parts[i];
		let iterations = 0;

		while (iterations < MAX_ITERATIONS && ENTITY_PATTERN.test(segment)) {
			const decoded = decodeOnce(segment);
			if (decoded === segment) break; // No progress — stop
			segment = decoded;
			iterations++;
		}

		parts[i] = segment;
	}

	return parts.join('');
}
