import modelData from './data/models.json';
import { resolveProviderOrDefault, type ProviderRoutingSlice } from './api/provider-routing';

export type ModelRole = 'chat' | 'summary' | 'completions' | 'rewrite' | 'image';

// `ModelProvider` now lives with the capability registry (a leaf module) so the
// router can depend on it without cycling back through this file. Re-exported
// here because most of the codebase imports it from `models`.
export type { ModelProvider } from './api/providers/registry';
import type { ModelProvider } from './api/providers/registry';

export interface GeminiModel {
	value: string;
	label: string;
	defaultForRoles?: ModelRole[];
	supportsImageGeneration?: boolean;
	maxTemperature?: number;
	/** Provider that serves this model. Omitted entries are treated as 'gemini' for backward compat. */
	provider?: ModelProvider;
	/** Whether the model is known to support function/tool calling. Defaults to true for Gemini, varies for Ollama. */
	supportsTools?: boolean;
	/** Whether the model supports image input (vision). */
	supportsVision?: boolean;
	/** Context window in tokens (used for compaction thresholds). */
	contextWindow?: number;
	/**
	 * Host that actually serves this model when it is not the local machine —
	 * set for Ollama Cloud entries, which look local (they appear in `/api/tags`
	 * and run through the local daemon) but proxy inference to `ollama.com`.
	 * Absent for genuinely local models. Privacy notices key off this, since a
	 * provider of "Ollama" no longer implies on-device execution.
	 */
	remoteHost?: string;
	/**
	 * The model is only served by the Interactions API — `generateContent`
	 * rejects it with a 400 ("This model only supports Interactions API").
	 * The Gemini client routes these through the Interactions path regardless
	 * of the `useInteractionsApi` setting, and generateContent-only callers
	 * (search grounding, web fetch, RAG) must not send requests to them.
	 */
	interactionsOnly?: boolean;
}

export const DEFAULT_GEMINI_MODELS: GeminiModel[] = modelData.models as GeminiModel[];

/**
 * Retired Gemini model IDs mapped to their direct successors. When Google
 * removes a model from the API (404 "no longer available") the entry is
 * dropped from the bundled list; users who still have it configured are
 * migrated to the successor here instead of falling back to the generic role
 * default, so e.g. a Pro user stays on a Pro-class model. Keep each entry
 * pointing at a model that is still in the bundled list — when a successor is
 * itself retired, re-point the older entries at the newest live model.
 */
export const RETIRED_MODEL_SUCCESSORS: Record<string, string> = {
	// Removed by Google 2026-07: both API paths return 404 "no longer available".
	'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
};

export let GEMINI_MODELS: GeminiModel[] = [...DEFAULT_GEMINI_MODELS];

/**
 * Set the models list (used by ModelManager for dynamic updates)
 */
export function setGeminiModels(newModels: GeminiModel[]): void {
	GEMINI_MODELS.length = 0;
	GEMINI_MODELS.push(...newModels);
}

/**
 * Resolve the effective provider for a model entry. Entries without an
 * explicit provider are treated as Gemini (legacy bundled list).
 */
function getModelProvider(model: GeminiModel): ModelProvider {
	return model.provider ?? 'gemini';
}

/**
 * Returns the default model value for a given role, scoped to a provider.
 * For Gemini, falls back to the first matching bundled model. For Ollama,
 * falls back to the first available model since we don't ship a curated list.
 */
export function getDefaultModelForRole(role: ModelRole, provider: ModelProvider = 'gemini'): string {
	const candidates = GEMINI_MODELS.filter((m) => getModelProvider(m) === provider);

	const modelForRole = candidates.find((m) => m.defaultForRoles?.includes(role));
	if (modelForRole) {
		return modelForRole.value;
	}

	if (candidates.length > 0) {
		return candidates[0].value;
	}

	// No models for this provider yet (e.g. Ollama before /api/tags returns, or
	// OpenAI before /v1/models returns). Returning an empty string lets callers
	// handle the unconfigured state rather than throwing at module load.
	if (provider === 'ollama' || provider === 'openai') {
		return '';
	}

	// Gemini list should never be empty (the bundled JSON is shipped). If it is,
	// surface the configuration problem rather than falling through to
	// `GEMINI_MODELS[0]` — when both providers populate that global,
	// `GEMINI_MODELS[0]` could be an Ollama entry and we'd return a
	// cross-provider model name as the Gemini default.
	throw new Error('CRITICAL: GEMINI_MODELS array is empty. Please configure available models.');
}

/**
 * The provider that serves a given model, or `null` when the model isn't in any
 * known list.
 *
 * Since per-use-case routing (#704) the global list is a *union* of every active
 * provider's models, so a model name usually identifies its provider on its own.
 * That lets provider-sensitive code (token counting, context limits, cost
 * reporting) branch on the model actually in hand rather than on a global
 * setting that may not apply to this request.
 *
 * `null` is a real case, not just paranoia: Ollama tags only enter the list once
 * the daemon answers, so a model configured while it was unreachable is
 * genuinely unidentifiable. Callers that can should fall back to the provider
 * their use case resolves to rather than guessing.
 */
export function findModelProvider(modelValue: string | null | undefined): ModelProvider | null {
	if (!modelValue) return null;
	const entry =
		GEMINI_MODELS.find((m) => m.value === modelValue) ?? DEFAULT_GEMINI_MODELS.find((m) => m.value === modelValue);
	return entry ? getModelProvider(entry) : null;
}

/**
 * Like `findModelProvider`, but defaults an unknown model to Gemini. Only for
 * callers with no use case to fall back on.
 */
export function providerForModel(modelValue: string | null | undefined): ModelProvider {
	return findModelProvider(modelValue) ?? 'gemini';
}

/**
 * The remote host serving a model, or `null` when it runs on this machine.
 *
 * Only Ollama Cloud entries carry a host today. An unknown model returns `null`
 * — a model missing from the list (daemon unreachable) can't be shown to be
 * remote, and the privacy notices that call this already caveat cloud routing
 * elsewhere.
 */
export function remoteHostForModel(modelValue: string | null | undefined): string | null {
	if (!modelValue) return null;
	const entry =
		GEMINI_MODELS.find((m) => m.value === modelValue) ?? DEFAULT_GEMINI_MODELS.find((m) => m.value === modelValue);
	return entry?.remoteHost ?? null;
}

/**
 * Whether a model is served exclusively by the Interactions API (see
 * `GeminiModel.interactionsOnly`). Checks the live model list first (which may
 * be a newer remote list), then the bundled defaults — a stale remote cache
 * fetched before the flag existed would otherwise hide it.
 */
export function isInteractionsOnlyModel(modelValue: string | null | undefined): boolean {
	if (!modelValue) return false;
	const flagIn = (list: GeminiModel[]) => list.find((m) => m.value === modelValue)?.interactionsOnly;
	return flagIn(GEMINI_MODELS) ?? flagIn(DEFAULT_GEMINI_MODELS) ?? false;
}

/**
 * Resolve a model for callers that can only use `generateContent` (search
 * grounding, web fetch, RAG — features the plugin hasn't migrated to the
 * Interactions API). Returns `preferred` unless it's empty or
 * interactions-only, in which case the bundled Gemini default for the role is
 * substituted so the request doesn't hard-fail with a 400.
 */
export function resolveGenerateContentModel(preferred: string | null | undefined, role: ModelRole = 'chat'): string {
	if (preferred && !isInteractionsOnlyModel(preferred)) {
		return preferred;
	}
	return getDefaultModelForRole(role, 'gemini');
}

/** The settings fields that hold Ollama model choices, per use case. */
export interface OllamaModelSettingsSlice {
	ollamaModelName?: string;
	ollamaSummaryModelName?: string;
	ollamaCompletionsModelName?: string;
}

/**
 * Resolve the Ollama model for a use case.
 *
 * Ollama keeps a single model resident, so diverging models across use cases
 * thrashes RAM/VRAM on every switch (#1077). The per-use-case fields therefore
 * default to empty, meaning "inherit `ollamaModelName`" — a user who wants a
 * dedicated (say) completions model opts into the swap explicitly.
 */
export function getOllamaModelForRole(settings: OllamaModelSettingsSlice, role: ModelRole): string {
	const specific =
		role === 'summary'
			? settings.ollamaSummaryModelName
			: role === 'completions'
				? settings.ollamaCompletionsModelName
				: undefined;
	return specific || settings.ollamaModelName || getDefaultModelForRole('chat', 'ollama');
}

/** The settings fields that hold OpenAI model choices, per use case. */
export interface OpenAIModelSettingsSlice {
	openaiModelName?: string;
	openaiSummaryModelName?: string;
	openaiCompletionsModelName?: string;
}

/**
 * Resolve the OpenAI model for a use case.
 *
 * Unlike Ollama, OpenAI has no single-resident-model constraint
 * (`capabilities.perUseCaseModels`), so each use case reads its own dedicated
 * field rather than inheriting the chat model; an unset field falls back to
 * the role's bundled/discovered default, not to `openaiModelName`.
 */
export function getOpenAIModelForRole(settings: OpenAIModelSettingsSlice, role: ModelRole): string {
	const configured =
		role === 'summary'
			? settings.openaiSummaryModelName
			: role === 'completions'
				? settings.openaiCompletionsModelName
				: settings.openaiModelName;
	return configured || getDefaultModelForRole(role, 'openai');
}

/**
 * Resolve the chat model for whichever provider currently serves chat. Each
 * provider keeps its own persisted model (`chatModelName` vs `ollamaModelName`
 * vs `openaiModelName`), so re-routing chat back and forth never clobbers
 * another provider's choice. Use this anywhere the "current chat model" is
 * needed for a request or for history metadata; the Gemini-cloud tools
 * (search grounding, URL context, RAG) intentionally keep reading
 * `chatModelName` directly since they always call Google's API.
 */
export function getActiveChatModel(
	settings: ProviderRoutingSlice & { chatModelName?: string } & OllamaModelSettingsSlice & OpenAIModelSettingsSlice
): string {
	const provider = resolveProviderOrDefault(settings, 'chat');
	if (provider === 'ollama') {
		return getOllamaModelForRole(settings, 'chat');
	}
	if (provider === 'openai') {
		return getOpenAIModelForRole(settings, 'chat');
	}
	return settings.chatModelName || getDefaultModelForRole('chat', 'gemini');
}

/**
 * The slice of plugin settings that model reconciliation reads and rewrites.
 * Structural on purpose: importing ObsidianGeminiSettings here would create a
 * models.ts ↔ types/settings.ts import cycle (types/settings.ts imports
 * GeminiModel/ModelProvider from this module), which the lint:cycles gate
 * forbids. ObsidianGeminiSettings satisfies this shape structurally.
 */
export interface ModelSettingsSlice {
	chatModelName: string;
	summaryModelName: string;
	completionsModelName: string;
	imageModelName: string;
	/**
	 * Optional: the Ollama model is only reconciled once the daemon's models are
	 * known, and callers (tests, partial fixtures) may omit the field entirely.
	 */
	ollamaModelName?: string;
	/**
	 * Optional per-use-case Ollama models. Empty means "inherit
	 * `ollamaModelName`" and is left alone by reconciliation.
	 */
	ollamaSummaryModelName?: string;
	ollamaCompletionsModelName?: string;
	/**
	 * Optional: the OpenAI model is only reconciled once the discovered model
	 * list is known, and callers (tests, partial fixtures) may omit the field
	 * entirely.
	 */
	openaiModelName?: string;
	openaiSummaryModelName?: string;
	openaiCompletionsModelName?: string;
}

export interface ModelUpdateResult<T extends ModelSettingsSlice = ModelSettingsSlice> {
	updatedSettings: T;
	settingsChanged: boolean;
	changedSettingsInfo: string[];
}

/**
 * One-time migration: split an existing Ollama user's model out of the shared
 * `chatModelName` field into the dedicated `ollamaModelName` field.
 *
 * Before `ollamaModelName` existed, the Ollama single-model picker wrote to
 * `chatModelName`, so an Ollama user's `chatModelName` holds an Ollama model (and
 * any prior Gemini choice was already overwritten). This moves it into its own
 * field and resets `chatModelName` to a Gemini default so switching providers no
 * longer clobbers either choice.
 *
 * Mutates `settings` in place and returns `true` when a migration was applied, so
 * the caller can persist and log. The pre-migration shape is detected from the
 * raw persisted data (`ollamaModelName === undefined`) rather than the merged
 * settings, whose default already backfills the field.
 *
 * @param settings - freshly merged settings (mutated in place)
 * @param rawData - raw persisted data as loaded from disk, pre-merge
 */
export function migrateOllamaModelSetting(
	settings: { provider?: ModelProvider; chatModelName?: string; ollamaModelName?: string },
	rawData: Record<string, unknown> | null | undefined
): boolean {
	if (rawData && rawData.ollamaModelName === undefined && settings.provider === 'ollama') {
		settings.ollamaModelName = settings.chatModelName || '';
		settings.chatModelName = getDefaultModelForRole('chat', 'gemini');
		return true;
	}
	return false;
}

export function getUpdatedModelSettings<T extends ModelSettingsSlice>(currentSettings: T): ModelUpdateResult<T> {
	const geminiModelValues = new Set(GEMINI_MODELS.filter((m) => getModelProvider(m) === 'gemini').map((m) => m.value));
	const ollamaModelValues = new Set(GEMINI_MODELS.filter((m) => getModelProvider(m) === 'ollama').map((m) => m.value));
	const openaiModelValues = new Set(GEMINI_MODELS.filter((m) => getModelProvider(m) === 'openai').map((m) => m.value));
	let settingsChanged = false;
	const changedSettingsInfo: string[] = [];
	const newSettings = { ...currentSettings };
	// Mutations go through a ModelSettingsSlice-typed view of the same object so
	// the writes below don't have to assign into generic indexed-access types.
	const modelFields: ModelSettingsSlice = newSettings;

	// The Gemini per-use-case fields are always reconciled against the (always
	// bundled) Gemini list, regardless of the active provider. This migrates
	// renamed/legacy Gemini model IDs and, critically, keeps a Gemini → Ollama →
	// Gemini round trip from clobbering the user's Gemini chat model: the Ollama
	// model lives in its own `ollamaModelName` field, so the Gemini fields are
	// never reconciled against the Ollama list.
	const reconcileGemini = (
		key: 'chatModelName' | 'summaryModelName' | 'completionsModelName' | 'imageModelName',
		role: ModelRole,
		label: string
	) => {
		const previous = modelFields[key];
		// The retired-model lookup runs BEFORE the validity short-circuit: the
		// current list may come from a stale persisted remoteModelCache that still
		// advertises a retired model, but Google 404s these server-side, so list
		// membership doesn't make it usable — migrate it regardless.
		const successor = previous ? RETIRED_MODEL_SUCCESSORS[previous] : undefined;
		if (successor === undefined && previous && geminiModelValues.has(previous)) return;
		// A retired model migrates to its designated successor when that successor
		// is available; anything else falls back to the role default.
		const useSuccessor = successor !== undefined && geminiModelValues.has(successor);
		const next = useSuccessor ? successor : getDefaultModelForRole(role, 'gemini');
		// Image generation has no dedicated default in some model lists; leave a
		// stale image model untouched rather than blanking it.
		if (!next) return;
		modelFields[key] = next;
		changedSettingsInfo.push(
			`${label}: '${previous}' -> '${next}' ${useSuccessor ? '(retired model migrated to successor)' : '(legacy model update)'}`
		);
		settingsChanged = true;
	};

	reconcileGemini('chatModelName', 'chat', 'Chat model');
	reconcileGemini('summaryModelName', 'summary', 'Summary model');
	reconcileGemini('completionsModelName', 'completions', 'Completions model');
	reconcileGemini('imageModelName', 'image', 'Image model');

	// The single Ollama model is only backfilled/validated once the daemon's
	// models are known (they load lazily via /api/tags). Until then, tolerate an
	// empty or stale value so a switch made while the daemon was unreachable
	// doesn't blank it, and a Gemini model name is never sent to Ollama.
	if (ollamaModelValues.size > 0) {
		const previous = modelFields.ollamaModelName;
		if (!previous || !ollamaModelValues.has(previous)) {
			const next = getDefaultModelForRole('chat', 'ollama');
			if (next && next !== previous) {
				modelFields.ollamaModelName = next;
				changedSettingsInfo.push(`Ollama model: '${previous ?? ''}' -> '${next}' (legacy model update)`);
				settingsChanged = true;
			}
		}

		// The optional per-use-case Ollama models are only reset when they name a
		// model the daemon no longer serves. Empty is the default and means
		// "inherit the chat model" (#1077), so it is never backfilled — doing so
		// would silently opt the user into an extra model swap.
		const clearStaleOllamaOverride = (key: 'ollamaSummaryModelName' | 'ollamaCompletionsModelName', label: string) => {
			const value = modelFields[key];
			if (!value || ollamaModelValues.has(value)) return;
			modelFields[key] = '';
			changedSettingsInfo.push(`${label}: '${value}' -> '' (model no longer available, inheriting chat model)`);
			settingsChanged = true;
		};
		clearStaleOllamaOverride('ollamaSummaryModelName', 'Ollama summary model');
		clearStaleOllamaOverride('ollamaCompletionsModelName', 'Ollama completions model');
	}

	// OpenAI has no single-resident-model constraint (perUseCaseModels), so each
	// use case is reconciled independently against the discovered model list —
	// mirroring reconcileGemini above rather than Ollama's "inherit chat, blank
	// on stale" pattern. Only runs once the list is known (models load lazily
	// via /v1/models), same gating as the Ollama block above.
	if (openaiModelValues.size > 0) {
		const reconcileOpenAI = (
			key: 'openaiModelName' | 'openaiSummaryModelName' | 'openaiCompletionsModelName',
			role: ModelRole,
			label: string
		) => {
			const previous = modelFields[key];
			if (previous && openaiModelValues.has(previous)) return;
			const next = getDefaultModelForRole(role, 'openai');
			if (!next || next === previous) return;
			modelFields[key] = next;
			changedSettingsInfo.push(`${label}: '${previous ?? ''}' -> '${next}' (legacy model update)`);
			settingsChanged = true;
		};
		reconcileOpenAI('openaiModelName', 'chat', 'OpenAI model');
		reconcileOpenAI('openaiSummaryModelName', 'summary', 'OpenAI summary model');
		reconcileOpenAI('openaiCompletionsModelName', 'completions', 'OpenAI completions model');
	}

	return {
		updatedSettings: newSettings,
		settingsChanged,
		changedSettingsInfo,
	};
}
