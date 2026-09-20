import modelData from './data/models.json';
import { PROVIDER_IDS, type ModelProvider } from './api/providers/registry';
import { featureModel, featureProvider, featureRoute, type FeatureRoutingSlice } from './api/feature-routing';
import {
	FEATURE_IDS,
	FEATURE_MODEL_ROLE,
	type FeatureId,
	type FeatureRoutes,
	type ModelRole,
	type ProviderModelMemory,
} from './types/features';

// `ModelRole` now lives with the feature-routing types (a leaf module) so
// `types/features.ts` can declare `FEATURE_MODEL_ROLE` without importing this
// file. Re-exported here because most of the codebase imports it from `models`.
export type { ModelRole } from './types/features';

// `ModelProvider` now lives with the capability registry (a leaf module) so the
// router can depend on it without cycling back through this file. Re-exported
// here because most of the codebase imports it from `models`.
export type { ModelProvider } from './api/providers/registry';

export interface GeminiModel {
	value: string;
	label: string;
	defaultForRoles?: ModelRole[];
	supportsImageGeneration?: boolean;
	/** The provider catalog reported no role capabilities, so the model may be selected for either text or image use. */
	capabilitiesUnknown?: boolean;
	maxTemperature?: number;
	/** Provider that serves this model. Omitted entries are treated as 'gemini' for backward compat. */
	provider?: ModelProvider;
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
	 * The Gemini client always routes these through the Interactions path, and
	 * generateContent-only callers (search grounding, web fetch, RAG) must not
	 * send requests to them.
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

/** Whether a model is eligible for a role without treating unknown capabilities as known text-only metadata. */
export function isModelEligibleForRole(model: GeminiModel, role: ModelRole): boolean {
	if (model.capabilitiesUnknown) return true;
	return Boolean(model.supportsImageGeneration) === (role === 'image');
}

/**
 * Returns the default model value for a given role, scoped to a provider.
 * For Gemini, falls back to the first matching bundled model. For Ollama,
 * falls back to the first available model since we don't ship a curated list.
 */
export function getDefaultModelForRole(role: ModelRole, provider: ModelProvider = 'gemini'): string {
	const candidates = GEMINI_MODELS.filter((m) => getModelProvider(m) === provider && isModelEligibleForRole(m, role));

	const modelForRole = candidates.find((m) => m.defaultForRoles?.includes(role));
	if (modelForRole) {
		return modelForRole.value;
	}

	if (candidates.length > 0) {
		return candidates[0].value;
	}

	// No models for this provider yet (e.g. Ollama before /api/tags returns, or
	// OpenAI/Anthropic before their /v1/models returns). Returning an empty string lets callers
	// handle the unconfigured state rather than throwing at module load.
	if (provider !== 'gemini') {
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
 * The global list is a *union* of every active provider's models, so a model
 * name usually identifies its provider on its own. That lets provider-sensitive
 * code (token counting, context limits, cost reporting) branch on the model
 * actually in hand rather than on a global setting that may not apply to this
 * request.
 *
 * `null` is a real case, not just paranoia: Ollama tags only enter the list once
 * the daemon answers, so a model configured while it was unreachable is
 * genuinely unidentifiable. Callers that can should fall back to the provider
 * their feature resolves to rather than guessing.
 */
export function findModelProvider(modelValue: string | null | undefined): ModelProvider | null {
	if (!modelValue) return null;
	const entry =
		GEMINI_MODELS.find((m) => m.value === modelValue) ?? DEFAULT_GEMINI_MODELS.find((m) => m.value === modelValue);
	return entry ? getModelProvider(entry) : null;
}

/**
 * A model's own input token limit, or `null` when the list carries none.
 *
 * Providers whose windows differ per model (OpenAI: 922k on GPT-5.6 versus the
 * 128k floor a compatible server gets) need this rather than the provider-wide
 * `defaultInputTokenLimit`, which is only a fallback for models the list can't
 * identify. Understating the window is not merely cosmetic — it makes the
 * context manager compact history long before the real ceiling.
 */
export function contextWindowForModel(modelValue: string | null | undefined): number | null {
	if (!modelValue) return null;
	const windowIn = (list: GeminiModel[]) => list.find((m) => m.value === modelValue)?.contextWindow;
	return windowIn(GEMINI_MODELS) ?? windowIn(DEFAULT_GEMINI_MODELS) ?? null;
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

/**
 * Resolve the concrete model for a feature: the stored value, or — when it's
 * `''` (or the feature is routed to `'none'`) — the bundled/discovered default
 * for the feature's model role. Every call site that needs a model name for a
 * request calls this, not `featureModel` (which returns the stored string
 * verbatim and is for the settings UI / reconciliation only).
 */
export function resolveFeatureModel(settings: FeatureRoutingSlice, f: FeatureId): string {
	const stored = featureModel(settings, f);
	if (stored) return stored;
	const role = FEATURE_MODEL_ROLE[f];
	if (!role) return '';
	const provider = featureProvider(settings, f) ?? 'gemini';
	return getDefaultModelForRole(role, provider);
}

/**
 * Model for provider-bound Gemini grounding calls (maps). Follows the
 * web-search model when web search is on Gemini, else the bundled Gemini chat
 * default.
 */
export function geminiGroundingModel(settings: FeatureRoutingSlice): string {
	const route = featureRoute(settings, 'webSearch');
	return resolveGenerateContentModel(route.provider === 'gemini' ? route.model : '', 'chat');
}

/**
 * Resolve the chat model for whichever provider currently serves chat. Use
 * this anywhere the "current chat model" is needed for a request or for
 * history metadata; the Gemini-cloud tools (search grounding, URL context,
 * RAG) intentionally resolve their own model via `geminiGroundingModel` /
 * `resolveGenerateContentModel` since they always call Google's API.
 */
export function getActiveChatModel(settings: FeatureRoutingSlice): string {
	return resolveFeatureModel(settings, 'chat');
}

/**
 * Stale-model reconciliation over the dense `features` table: retired models
 * migrate to their successor (`RETIRED_MODEL_SUCCESSORS`, checked before the
 * validity short-circuit — a stale persisted `remoteModelCache` can still
 * advertise a 404'd model), and anything else naming a model no longer in its
 * *own* provider's list resets to `''` (role default). `providerModelMemory`
 * is reconciled the same way, each entry against its own provider's list.
 * Only runs once a provider's model list is known — Ollama/OpenAI models load
 * lazily, and an empty list means "not loaded yet", not "nothing available".
 */
export function getUpdatedFeatureRoutes(
	features: FeatureRoutes,
	memory: ProviderModelMemory
): { features: FeatureRoutes; memory: ProviderModelMemory; changed: boolean; info: string[] } {
	let changed = false;
	const info: string[] = [];
	const newFeatures: FeatureRoutes = { ...features };
	const newMemory: ProviderModelMemory = {};
	// Defensive: a caller (or a not-yet-migrated settings fixture) may pass no
	// memory at all, not just an empty one.
	const sourceMemory = memory ?? {};
	for (const p of PROVIDER_IDS) {
		if (sourceMemory[p]) newMemory[p] = { ...sourceMemory[p] };
	}

	const providerModels = (provider: ModelProvider): GeminiModel[] =>
		GEMINI_MODELS.filter((m) => getModelProvider(m) === provider);
	const modelValuesFor = (provider: ModelProvider, role: ModelRole): Set<string> =>
		new Set(
			providerModels(provider)
				.filter((m) => isModelEligibleForRole(m, role))
				.map((m) => m.value)
		);

	const reconcile = (provider: ModelProvider, role: ModelRole, previous: string, label: string): string => {
		if (!previous) return previous;
		const values = modelValuesFor(provider, role);
		const successor = RETIRED_MODEL_SUCCESSORS[previous];
		if (successor === undefined && values.has(previous)) return previous;
		// The provider's list isn't loaded yet — tolerate the stale value rather
		// than blanking it (mirrors the pre-redesign Ollama/OpenAI gating).
		if (providerModels(provider).length === 0) return previous;
		const useSuccessor = successor !== undefined && values.has(successor);
		const next = useSuccessor ? successor : getDefaultModelForRole(role, provider);
		if (next === previous) return previous;
		info.push(
			`${label}: '${previous}' -> '${next || '(default)'}' ${useSuccessor ? '(retired model migrated to successor)' : '(legacy model update)'}`
		);
		changed = true;
		return next;
	};

	for (const f of FEATURE_IDS) {
		const role = FEATURE_MODEL_ROLE[f];
		if (!role) continue;
		const route = newFeatures[f];
		if (!route || route.provider === 'none') continue;
		const next = reconcile(route.provider, role, route.model, `${f} model`);
		if (next !== route.model) {
			newFeatures[f] = { ...route, model: next };
		}
	}

	for (const p of PROVIDER_IDS) {
		const entries = newMemory[p];
		if (!entries) continue;
		for (const f of FEATURE_IDS) {
			const role = FEATURE_MODEL_ROLE[f];
			if (!role) continue;
			const previous = entries[f];
			if (!previous) continue;
			const next = reconcile(p, role, previous, `${p} ${f} model memory`);
			if (next !== previous) {
				if (next) {
					entries[f] = next;
				} else {
					delete entries[f];
				}
			}
		}
	}

	return { features: newFeatures, memory: newMemory, changed, info };
}
