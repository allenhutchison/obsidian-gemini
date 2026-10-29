import type { GenerateContentResponse } from '@google/genai';

/**
 * Concatenate the answer text of a generateContent response.
 *
 * Walks `candidates[0].content.parts` and skips thought parts, matching the
 * documented contract of the SDK's `text` getter, so model reasoning never
 * leaks into a tool result. There is deliberately no fallback to `result.text`:
 * the getter is derived from the same parts array, so it has nothing to return
 * when that array is absent.
 *
 * Callers own what an empty result means — each raises its own error.
 */
export function collectResponseText(result: GenerateContentResponse): string {
	let text = '';
	for (const part of result.candidates?.[0]?.content?.parts ?? []) {
		if (part.text && !part.thought) {
			text += part.text;
		}
	}
	return text;
}
