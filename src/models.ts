import { OllamaApi } from 'api/implementations/ollama-api'; // Changed path
import ObsidianGemini from '../../main';
import { ApiProvider } from 'api/api-factory'; // Changed path

export type ModelRole = 'chat' | 'summary' | 'completions';

export interface GeminiModel {
	value: string;
	label: string;
	defaultForRoles?: ModelRole[];
}

export interface OllamaModel {
	name: string; // Equivalent to 'label' for UI
	value: string; // Model ID, e.g., 'llama3.1'
	details?: object; // Optional: other details from Ollama
}

export const GEMINI_MODELS: GeminiModel[] = [
	{ value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
	{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
	{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
];

export async function getOllamaModels(plugin: ObsidianGemini): Promise<OllamaModel[] | null> {
	try {
		const tempOllamaApi = new OllamaApi(plugin);
		const ollamaListResponse = await tempOllamaApi.listModels(); // listModels is already in OllamaApi
		if (ollamaListResponse && ollamaListResponse.models) {
			return ollamaListResponse.models.map(model => ({
				name: model.name, // User-friendly name
				value: model.name, // Model ID that Ollama uses (e.g. "llama3:latest")
				details: model.details,
			}));
		}
		return []; // Return empty array if response is okay but no models
	} catch (error) {
		console.warn("ObsidianGemini: Could not fetch Ollama models. Please ensure Ollama is running and the Base URL is correct in settings.", error);
		return null;
	}
}

export async function getDefaultModelForRole(role: ModelRole, plugin: ObsidianGemini): Promise<string | null> {
	if (plugin.settings.apiProvider === ApiProvider.OLLAMA) {
		const ollamaModels = await getOllamaModels(plugin);
		if (ollamaModels && ollamaModels.length > 0) {
			// For Ollama, return the first model in the list as a generic default.
			// Specific role-based defaults might be complex if users can have any model.
			return ollamaModels[0].value;
		} else {
			console.warn(`ObsidianGemini: No Ollama models found or error fetching them. Cannot set default for role '${role}'.`);
			return null;
		}
	} else { // Default to Gemini
		const modelForRole = GEMINI_MODELS.find(m => m.defaultForRoles?.includes(role));
		if (modelForRole) {
			return modelForRole.value;
		}

		if (GEMINI_MODELS.length > 0) {
			console.warn(`ObsidianGemini: No default Gemini model specified for role '${role}'. Falling back to the first model in GEMINI_MODELS: ${GEMINI_MODELS[0].label}`);
			return GEMINI_MODELS[0].value;
		}

		console.error('ObsidianGemini: CRITICAL: GEMINI_MODELS is empty. Cannot determine a fallback model.');
		return null; // Changed from throw to return null for consistency
	}
}

export interface ModelUpdateResult {
	updatedSettings: any; // Ideally, this would be ObsidianGeminiSettings
	settingsChanged: boolean;
	changedSettingsInfo: string[];
}

export async function getUpdatedModelSettings(currentSettings: any, plugin: ObsidianGemini): Promise<ModelUpdateResult> {
	let availableModels: Array<{ value: string; label: string; }> = [];
	let settingsChanged = false;
	const changedSettingsInfo: string[] = [];
	const newSettings = { ...currentSettings };

	if (plugin.settings.apiProvider === ApiProvider.OLLAMA) {
		const ollamaModels = await getOllamaModels(plugin);
		if (ollamaModels) {
			// Adapt OllamaModel to the structure { value: string, label: string }
			availableModels = ollamaModels.map(m => ({ value: m.value, label: m.name }));
		}
		// If ollamaModels is null (error fetching), availableModels remains empty.
		// This means models won't be validated/reset if the server is down, which is reasonable.
	} else {
		availableModels = GEMINI_MODELS;
	}

	const availableModelValues = new Set(availableModels.map(m => m.value));

	// Check chat model
	if (!availableModelValues.has(newSettings.chatModelName)) {
		const newDefaultChat = await getDefaultModelForRole('chat', plugin);
		if (newDefaultChat) {
			changedSettingsInfo.push(`Chat model: '${newSettings.chatModelName}' -> '${newDefaultChat}'`);
			newSettings.chatModelName = newDefaultChat; // newDefaultChat would be null here
			settingsChanged = true;
		} else if (plugin.settings.apiProvider === ApiProvider.OLLAMA && availableModels.length === 0) {
			// If Ollama is provider but no models, and the current model is not valid (which it isn't if we're in this outer if)
			// then the model setting should be cleared and settingsChanged should be true.
			// newDefaultChat is already null in this path.
			changedSettingsInfo.push(`Chat model: '${newSettings.chatModelName}' -> '${newDefaultChat}'. Ollama models unavailable.`);
			newSettings.chatModelName = newDefaultChat; // Set to null
			settingsChanged = true;
		}
	}

	// Check summary model
	if (!availableModelValues.has(newSettings.summaryModelName)) {
		const newDefaultSummary = await getDefaultModelForRole('summary', plugin);
		if (newDefaultSummary) {
			changedSettingsInfo.push(`Summary model: '${newSettings.summaryModelName}' -> '${newDefaultSummary}'`);
			newSettings.summaryModelName = newDefaultSummary; // newDefaultSummary would be null
			settingsChanged = true;
		} else if (plugin.settings.apiProvider === ApiProvider.OLLAMA && availableModels.length === 0) {
			changedSettingsInfo.push(`Summary model: '${newSettings.summaryModelName}' -> '${newDefaultSummary}'. Ollama models unavailable.`);
			newSettings.summaryModelName = newDefaultSummary; // Set to null
			settingsChanged = true;
		}
	}

	// Check completions model
	if (!availableModelValues.has(newSettings.completionsModelName)) {
		const newDefaultCompletions = await getDefaultModelForRole('completions', plugin);
		if (newDefaultCompletions) {
			changedSettingsInfo.push(`Completions model: '${newSettings.completionsModelName}' -> '${newDefaultCompletions}'`);
			newSettings.completionsModelName = newDefaultCompletions; // newDefaultCompletions would be null
			settingsChanged = true;
		} else if (plugin.settings.apiProvider === ApiProvider.OLLAMA && availableModels.length === 0) {
			changedSettingsInfo.push(`Completions model: '${newSettings.completionsModelName}' -> '${newDefaultCompletions}'. Ollama models unavailable.`);
			newSettings.completionsModelName = newDefaultCompletions; // Set to null
			settingsChanged = true;
		}
	}

	return {
		updatedSettings: newSettings,
		settingsChanged,
		changedSettingsInfo
	};
}
