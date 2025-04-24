export interface GeminiModel {
	value: string;
	label: string;
}

export const GEMINI_MODELS: GeminiModel[] = [
	{ value: 'gemini-2.5-pro-preview-03-25', label: 'Gemini 2.5 Pro' },
	{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash' },
	{ value: 'gemini-2.0-pro-exp-02-05', label: 'Gemini 2.0 Pro' },
	{ value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
	{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
	{ value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
	{ value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
	{ value: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b' },
];
