export type ModelRole = 'chat' | 'summary' | 'completions' | 'rewrite' | 'image';

export interface GeminiModel {
	value: string;
	label: string;
	defaultForRoles?: ModelRole[];
	supportsImageGeneration?: boolean;
}

export let GEMINI_MODELS: GeminiModel[] = [
	{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
	{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary', 'rewrite'] },
	{ value: 'gemini-2.5-flash-lite-preview-06-17', label: 'Gemini 2.5 Flash Lite', defaultForRoles: ['completions'] },
	{ value: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image', defaultForRoles: ['image'], supportsImageGeneration: true },
];

/**
 * Set the models list (used by ModelManager for dynamic updates)
 */
export function setGeminiModels(newModels: GeminiModel[]): void {
	GEMINI_MODELS.length = 0;
	GEMINI_MODELS.push(...newModels);
}

export function getDefaultModelForRole(role: ModelRole): string {
	const modelForRole = GEMINI_MODELS.find((m) => m.defaultForRoles?.includes(role));
	if (modelForRole) {
		return modelForRole.value;
	}

	// If no specific default is found in GEMINI_MODELS, and assuming GEMINI_MODELS is never empty,
	// fall back to the first model in the list.
	if (GEMINI_MODELS.length > 0) {
		// Note: No default model specified for role, falling back to first model in GEMINI_MODELS
		return GEMINI_MODELS[0].value;
	}

	// This case should ideally be unreachable if GEMINI_MODELS is guaranteed to be non-empty.
	// Adding a safeguard for an extremely unlikely scenario.
	// This indicates a serious configuration problem.
	throw new Error('CRITICAL: GEMINI_MODELS array is empty. Please configure available models.');
}

export interface ModelUpdateResult {
	updatedSettings: any; // Ideally, this would be ObsidianGeminiSettings, but that would create a circular dependency
	settingsChanged: boolean;
	changedSettingsInfo: string[];
}

export function getUpdatedModelSettings(currentSettings: any): ModelUpdateResult {
	const availableModelValues = new Set(GEMINI_MODELS.map((m) => m.value));
	let settingsChanged = false;
	const changedSettingsInfo: string[] = [];
	const newSettings = { ...currentSettings };

	// Helper function to check if a model needs updating
	const needsUpdate = (modelName: string) => {
		// Update if model is empty/undefined OR if the model is no longer available
		return !modelName || !availableModelValues.has(modelName);
	};

	// Check chat model - only update if truly needed
	if (needsUpdate(newSettings.chatModelName)) {
		const newDefaultChat = getDefaultModelForRole('chat');
		if (newDefaultChat) {
			changedSettingsInfo.push(
				`Chat model: '${newSettings.chatModelName}' -> '${newDefaultChat}' (legacy model update)`
			);
			newSettings.chatModelName = newDefaultChat;
			settingsChanged = true;
		}
	}

	// Check summary model - only update if truly needed
	if (needsUpdate(newSettings.summaryModelName)) {
		const newDefaultSummary = getDefaultModelForRole('summary');
		if (newDefaultSummary) {
			changedSettingsInfo.push(
				`Summary model: '${newSettings.summaryModelName}' -> '${newDefaultSummary}' (legacy model update)`
			);
			newSettings.summaryModelName = newDefaultSummary;
			settingsChanged = true;
		}
	}

	// Check completions model - only update if truly needed
	if (needsUpdate(newSettings.completionsModelName)) {
		const newDefaultCompletions = getDefaultModelForRole('completions');
		if (newDefaultCompletions) {
			changedSettingsInfo.push(
				`Completions model: '${newSettings.completionsModelName}' -> '${newDefaultCompletions}' (legacy model update)`
			);
			newSettings.completionsModelName = newDefaultCompletions;
			settingsChanged = true;
		}
	}

	return {
		updatedSettings: newSettings,
		settingsChanged,
		changedSettingsInfo,
	};
}
