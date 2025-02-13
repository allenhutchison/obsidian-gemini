export interface GeminiModel {
    value: string;
    label: string;
}

export const GEMINI_MODELS: GeminiModel[] = [
    { value: 'gemini-2.0-pro-exp-02-05', label: 'Gemini 2.0 Pro' },
    { value: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-2.0-flash-lite-preview-02-05', label: 'Gemini 2.0 Flash Lite Preview' },
    { value: 'gemini-2.0-flash-thinking-exp-01-21', label: 'Gemini 2.0 Flash Thinking' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
    { value: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b' }
]; 