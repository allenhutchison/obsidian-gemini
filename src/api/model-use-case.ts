/**
 * The use case a model client is created for.
 *
 * Drives model selection in `ModelClientFactory` and per-use-case request
 * tuning in the providers (e.g. the Gemini `thinkingLevel` map). Kept in its
 * own module — with no imports — so providers can depend on it without forming
 * an import cycle with `factory.ts` (which imports the provider clients).
 */
export enum ModelUseCase {
	CHAT = 'chat',
	SUMMARY = 'summary',
	COMPLETIONS = 'completions',
	REWRITE = 'rewrite',
	SEARCH = 'search',
}
