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
export function getModelProvider(model: GeminiModel): ModelProvider {
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

	// Gemini list should never be empty — that indicates a serious config problem.
	if (GEMINI_MODELS.length > 0) {
		return GEMINI_MODELS[0].value;
	}

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
	// For Ollama we tolerate empty (the list may not have loaded yet) — only
	// reset when the configured value is present but no longer in the list.
	const needsUpdate = (modelName: string) => {
		if (!modelName) {
			return provider !== 'ollama';
		}
		return !availableModelValues.has(modelName);
	};

	// Check chat model
	if (needsUpdate(newSettings.chatModelName)) {
		const newDefaultChat = getDefaultModelForRole('chat', provider);
		if (newDefaultChat) {
			changedSettingsInfo.push(
				`Chat model: '${newSettings.chatModelName}' -> '${newDefaultChat}' (legacy model update)`
			);
			newSettings.chatModelName = newDefaultChat;
			settingsChanged = true;
		}
	}

	// Check summary model
	if (needsUpdate(newSettings.summaryModelName)) {
		const newDefaultSummary = getDefaultModelForRole('summary', provider);
		if (newDefaultSummary) {
			changedSettingsInfo.push(
				`Summary model: '${newSettings.summaryModelName}' -> '${newDefaultSummary}' (legacy model update)`
			);
			newSettings.summaryModelName = newDefaultSummary;
			settingsChanged = true;
		}
	}

	// Check completions model
	if (needsUpdate(newSettings.completionsModelName)) {
		const newDefaultCompletions = getDefaultModelForRole('completions', provider);
		if (newDefaultCompletions) {
			changedSettingsInfo.push(
				`Completions model: '${newSettings.completionsModelName}' -> '${newDefaultCompletions}' (legacy model update)`
			);
			newSettings.completionsModelName = newDefaultCompletions;
			settingsChanged = true;
		}
	}

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
