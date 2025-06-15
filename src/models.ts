export type ModelRole = 'chat' | 'summary' | 'completions';

export interface GeminiModel {
	value: string;
	label: string;
	defaultForRoles?: ModelRole[];
}

export const GEMINI_MODELS: GeminiModel[] = [
	{ value: 'gemini-2.5-pro-preview-06-05', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
	{ value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
	{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
];

export function getDefaultModelForRole(role: ModelRole): string {
	const modelForRole = GEMINI_MODELS.find((m) => m.defaultForRoles?.includes(role));
	if (modelForRole) {
		return modelForRole.value;
	}

	// If no specific default is found in GEMINI_MODELS, and assuming GEMINI_MODELS is never empty,
	// fall back to the first model in the list.
	if (GEMINI_MODELS.length > 0) {
		console.warn(
			`No default model specified for role '${role}'. Falling back to the first model in GEMINI_MODELS: ${GEMINI_MODELS[0].label}`
		);
		return GEMINI_MODELS[0].value;
	}

	// This case should ideally be unreachable if GEMINI_MODELS is guaranteed to be non-empty.
	// Adding a safeguard for an extremely unlikely scenario.
	console.error('CRITICAL: GEMINI_MODELS is empty. Cannot determine a fallback model.');
	// Returning a hardcoded, very basic model name as an absolute last resort.
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

	// Check chat model
	if (!availableModelValues.has(newSettings.chatModelName)) {
		const newDefaultChat = getDefaultModelForRole('chat');
		if (newDefaultChat) {
			changedSettingsInfo.push(`Chat model: '${newSettings.chatModelName}' -> '${newDefaultChat}'`);
			newSettings.chatModelName = newDefaultChat;
			settingsChanged = true;
		}
	}

	// Check summary model
	if (!availableModelValues.has(newSettings.summaryModelName)) {
		const newDefaultSummary = getDefaultModelForRole('summary');
		if (newDefaultSummary) {
			changedSettingsInfo.push(`Summary model: '${newSettings.summaryModelName}' -> '${newDefaultSummary}'`);
			newSettings.summaryModelName = newDefaultSummary;
			settingsChanged = true;
		}
	}

	// Check completions model
	if (!availableModelValues.has(newSettings.completionsModelName)) {
		const newDefaultCompletions = getDefaultModelForRole('completions');
		if (newDefaultCompletions) {
			changedSettingsInfo.push(
				`Completions model: '${newSettings.completionsModelName}' -> '${newDefaultCompletions}'`
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
