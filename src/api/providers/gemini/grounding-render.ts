/**
 * Single source of truth for rendering search-grounding citations into the
 * `ModelResponse.rendered` HTML block.
 *
 * Both Gemini transports emit the same `<div class="search-grounding">` block:
 * the `generateContent` path (`client.ts`, via `extractRenderedFromResponse`) and
 * the Interactions API path (`interactions-mapper.ts`). Historically each authored
 * its own copy and they drifted — the `generateContent` copy interpolated
 * provider-supplied strings into HTML raw, while the Interactions copy escaped and
 * scheme-validated them (see #1195). This leaf module collapses them into one
 * renderer so the hardened version is the only one.
 *
 * It is a **leaf** on purpose (imports nothing from `client.ts` or
 * `interactions-mapper.ts`) so both callers can depend on it without reintroducing
 * an import cycle between the two modules (see the acyclic-graph invariant in
 * AGENTS.md).
 *
 * ## HTML-safety contract
 *
 * Grounding `url`/`title` originate from web-search grounding metadata — model /
 * provider annotations derived from indexed pages, i.e. **untrusted content**. This
 * function is the single place that guarantees `ModelResponse.rendered` is
 * injection-safe:
 *
 * - The href is restricted to `http(s)` via {@link safeExternalUrl} (blocking
 *   `javascript:` / `data:` schemes), then HTML-escaped.
 * - The visible label is HTML-escaped.
 * - Links carry `rel="noopener noreferrer"` and `target="_blank"`.
 *
 * Any future consumer that injects `.rendered` into the DOM inherits this
 * guarantee; it must not be weakened without updating every caller.
 */

/** A normalized grounding source: an external URL and an optional display title. */
export interface RenderableGroundingSource {
	url: string;
	title?: string;
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Return `value` only if it's an http(s) URL, else '#' — blocks javascript:/data: hrefs. */
export function safeExternalUrl(value: string): string {
	try {
		const parsed = new URL(value);
		// Return the original (not parsed.toString(), which normalizes/adds a
		// trailing slash) so the link stays faithful to the cited URL.
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : '#';
	} catch {
		return '#';
	}
}

/**
 * Render grounding sources as the `<div class="search-grounding">` block both
 * transports emit. Returns '' when there are no sources.
 *
 * See the module-level HTML-safety contract: the href is scheme-restricted and
 * escaped, the label is escaped, and links get `rel="noopener noreferrer"`.
 */
export function renderGroundingSources(sources: RenderableGroundingSource[]): string {
	if (sources.length === 0) return '';
	const items = sources
		.map((s) => {
			const href = escapeHtml(safeExternalUrl(s.url));
			const label = escapeHtml(s.title || s.url);
			return `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
		})
		.join('');
	return `<div class="search-grounding"><h4>Sources:</h4><ul>${items}</ul></div>`;
}
