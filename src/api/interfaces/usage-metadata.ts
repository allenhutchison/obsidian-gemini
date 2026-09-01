/**
 * Token-usage wire shape shared by the API layer (producers) and the
 * ContextManager / token-readout UI (consumers) (#1437).
 *
 * Previously declared twice — anonymously on `ModelResponse.usageMetadata`
 * and as a named interface in `context-manager.ts` — with structural typing
 * hiding the seam until the copies drifted by one field. This leaf is the
 * single declaration: `api/interfaces/` cannot import from `services/`, so
 * the type lives here and both layers point at it.
 *
 * A leaf module (imports nothing).
 */
export interface UsageMetadata {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	totalTokenCount?: number;
	/**
	 * Portion of `promptTokenCount` served from Gemini's implicit or explicit
	 * content cache. Present on responses where the request matched a cached
	 * prefix; omitted otherwise. Used to surface caching effectiveness in the
	 * token readout UI and debug logs.
	 */
	cachedContentTokenCount?: number;
	/**
	 * Tokens spent on model reasoning (thinking). Populated by the Gemini
	 * paths — the SDK's streaming `usageMetadata` carries it and the
	 * Interactions API reports it as `thoughts_token_count`; Ollama and OpenAI
	 * omit it, which is honest rather than zero. Included in
	 * `totalTokenCount` either way, so the aggregate is correct regardless;
	 * this field attributes the reasoning share of it.
	 *
	 * Calibration note (#1437 follow-up): reasoning tokens are output-side and
	 * occupy no context-window space on subsequent requests — reasoning
	 * persisted back into history returns as ordinary prompt text, already
	 * counted inside `promptTokenCount`. The compaction threshold correctly
	 * stays prompt-based; adding this field to that comparison would
	 * over-count and trigger premature compaction.
	 */
	thoughtsTokenCount?: number;
}
