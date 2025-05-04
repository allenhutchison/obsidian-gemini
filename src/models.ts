export interface GeminiModel {
	value: string;
	label: string;
}

export const GEMINI_MODELS: GeminiModel[] = [
	{ value: 'gemini-2.5-pro-preview-03-25', label: 'Gemini 2.5 Pro' },
	{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash' },
	{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
];
