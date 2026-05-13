// @ts-ignore — esbuild JSON loader
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

export interface ModelUpdateResult {
	updatedSettings: any; // Ideally, this would be ObsidianGeminiSettings, but that would create a circular dependency
	settingsChanged: boolean;
	changedSettingsInfo: string[];
}

export function getUpdatedModelSettings(currentSettings: any): ModelUpdateResult {
	const provider: ModelProvider = currentSettings?.provider === 'ollama' ? 'ollama' : 'gemini';
	const availableModelValues = new Set(
		GEMINI_MODELS.filter((m) => getModelProvider(m) === provider).map((m) => m.value)
	);
	let settingsChanged = false;
	const changedSettingsInfo: string[] = [];
	const newSettings = { ...currentSettings };

	// Helper function to check if a model needs updating.
	// For Ollama we tolerate empty *only* while the model list hasn't loaded
	// yet — once /api/tags has resolved, an empty value should be backfilled
	// to a real default (otherwise a Gemini → Ollama switch made before the
	// daemon was reachable would leave chat/summary/completions blank
	// indefinitely, since the empty value never re-triggers reconciliation).
	const needsUpdate = (modelName: string) => {
		if (!modelName) {
			return provider !== 'ollama' || availableModelValues.size > 0;
		}
		return !availableModelValues.has(modelName);
	};

	const reconcile = (
		key: 'chatModelName' | 'summaryModelName' | 'completionsModelName',
		role: ModelRole,
		label: string
	) => {
		if (!needsUpdate(newSettings[key])) return;
		const next = getDefaultModelForRole(role, provider);
		// When the active provider has no default available (e.g. Ollama before
		// /api/tags has resolved), clear the stale value so the factory falls
		// through to its "no model selected" path instead of sending a
		// cross-provider model name (e.g. `gemini-flash-latest` to Ollama).
		const previous = newSettings[key];
		newSettings[key] = next;
		changedSettingsInfo.push(
			next
				? `${label}: '${previous}' -> '${next}' (legacy model update)`
				: `${label}: cleared stale '${previous}' (no default for provider '${provider}')`
		);
		settingsChanged = true;
	};

	reconcile('chatModelName', 'chat', 'Chat model');
	reconcile('summaryModelName', 'summary', 'Summary model');
	reconcile('completionsModelName', 'completions', 'Completions model');

	// Image generation is Gemini-only in Phase 1 — only reconcile when on Gemini.
	if (provider === 'gemini' && needsUpdate(newSettings.imageModelName)) {
		const newDefaultImage = getDefaultModelForRole('image', 'gemini');
		if (newDefaultImage) {
			changedSettingsInfo.push(
				`Image model: '${newSettings.imageModelName}' -> '${newDefaultImage}' (legacy model update)`
			);
			newSettings.imageModelName = newDefaultImage;
			settingsChanged = true;
		}
	}

	return {
		updatedSettings: newSettings,
		settingsChanged,
		changedSettingsInfo,
	};
}
