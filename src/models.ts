import modelData from './data/models.json';

export type ModelRole = 'chat' | 'summary' | 'completions' | 'rewrite' | 'image';

export type ModelProvider = 'gemini' | 'ollama';

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

	// No models for this provider yet (e.g. Ollama before /api/tags returns).
	// Returning an empty string lets callers handle the unconfigured state
	// rather than throwing at module load.
	if (provider === 'ollama') {
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
 * Resolve the chat model for the *active* provider. Gemini and Ollama each keep
 * their own persisted model (`chatModelName` vs `ollamaModelName`), so switching
 * providers back and forth never clobbers the other's choice. Use this anywhere
 * the "current chat model" is needed for a request or for history metadata; the
 * Gemini-cloud tools (search grounding, URL context, RAG) intentionally keep
 * reading `chatModelName` directly since they always call Google's API.
 */
export function getActiveChatModel(settings: {
	provider?: ModelProvider;
	chatModelName?: string;
	ollamaModelName?: string;
}): string {
	if ((settings.provider ?? 'gemini') === 'ollama') {
		return settings.ollamaModelName || getDefaultModelForRole('chat', 'ollama');
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
		if (previous && geminiModelValues.has(previous)) return;
		// A retired model migrates to its designated successor when that successor
		// is available; anything else falls back to the role default.
		const successor = previous ? RETIRED_MODEL_SUCCESSORS[previous] : undefined;
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
	}

	return {
		updatedSettings: newSettings,
		settingsChanged,
		changedSettingsInfo,
	};
}
