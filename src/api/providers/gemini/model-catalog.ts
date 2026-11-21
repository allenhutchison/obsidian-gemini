/**
 * Mapping from Google's `ListModels` response to the plugin's model entries.
 * Read by `GeminiModelsService`, which owns the runtime Gemini model list.
 *
 * The Gemini API lists every model the key can call, including embeddings,
 * TTS, video, robotics and other non-chat models. The filter below keeps the
 * text and image-generation models the plugin can drive through
 * `generateContent`. These rules used to live in a weekly script that wrote a
 * bundled `models.json`. They now run in the plugin against the user's own key,
 * the same way every other provider discovers its models.
 */

import type { GeminiModel } from '../../../models';
import type { ModelRole } from '../../../types/features';

/** One entry of `GET /v1beta/models`. Only the fields the mapping reads are declared. */
export interface GeminiListModelsEntry {
	/** Resource name, e.g. `models/gemini-flash-latest`. */
	name?: string;
	displayName?: string;
	supportedGenerationMethods?: string[];
	inputTokenLimit?: number;
	maxTemperature?: number;
}

/**
 * Gemma models served by the Gemini API (`gemma-4-31b-it`, `gemma-4-26b-a4b-it`).
 * Opted in by prefix, so new Gemma 4 variants appear without a code change.
 * Everything else named `gemma` (embedding variants, older generations) stays
 * excluded. Gemma 4 does native function calling, so it needs no capability gate.
 */
const GEMMA_INCLUDE_PREFIX = 'gemma-4-';

/** Model-id substrings that are never offered. */
const EXCLUDE_PATTERNS = [
	'embedding',
	'aqa',
	'learnlm',
	'gemma',
	'imagen',
	'veo',
	'tts',
	'vision',
	'computer',
	'robotics',
	'gemini-2.0',
	// Retired by Google 2026-07 (404 "no longer available") but may still be
	// listed. Saved settings migrate via RETIRED_MODEL_SUCCESSORS in models.ts.
	'gemini-3-pro-preview',
	// Speech-to-text specializations: they accept generateContent but are not
	// general-purpose chat/summary/rewrite models (#1432).
	'transcribe',
	// Gemini Omni models output video only, so a text request fails with a 400
	// (#1707).
	'omni',
];

/**
 * Role defaults, as ordered preferences. The `-latest` aliases come first
 * because Google keeps them pointed at the current Flash generation, so they
 * never go stale. The patterns are fallbacks for a key or proxy that doesn't
 * list the aliases.
 */
const ROLE_PREFERENCES: Record<ModelRole, (string | RegExp)[]> = {
	chat: ['gemini-flash-latest', /^gemini-[\d.]+-flash$/],
	summary: ['gemini-flash-latest', /^gemini-[\d.]+-flash$/],
	rewrite: ['gemini-flash-latest', /^gemini-[\d.]+-flash$/],
	completions: ['gemini-flash-lite-latest', /^gemini-[\d.]+-flash-lite$/],
	image: ['gemini-2.5-flash-image', /image/],
};

function modelId(name: string): string {
	return name.replace(/^models\//, '');
}

/** Whether a `ListModels` entry is a model the plugin should offer. Exported for tests. */
export function shouldIncludeModel(entry: GeminiListModelsEntry): boolean {
	const id = modelId(entry.name ?? '').toLowerCase();
	if (!id) return false;
	if (!(entry.supportedGenerationMethods ?? []).includes('generateContent')) return false;
	if (id.startsWith(GEMMA_INCLUDE_PREFIX)) return true;
	if (!id.includes('gemini')) return false;
	return !EXCLUDE_PATTERNS.some((pattern) => id.includes(pattern));
}

function isPreview(id: string): boolean {
	return id.includes('-preview');
}

/**
 * The GA id a preview id graduates to: `gemini-2.5-flash-preview-09-2025` ->
 * `gemini-2.5-flash`, `gemini-3-pro-image-preview` -> `gemini-3-pro-image`.
 */
function gaId(id: string): string {
	return id.replace(/-preview.*$/, '');
}

function isImageModel(id: string): boolean {
	return id.includes('image') || id.includes('nano-banana');
}

/**
 * Map a `ListModels` response to model entries: filter, drop preview ids whose
 * GA version is also listed (Google keeps listing preview aliases long after
 * GA, which would show duplicate options), and stamp role defaults. Pure.
 */
export function mapGeminiModelList(entries: readonly GeminiListModelsEntry[]): GeminiModel[] {
	const included = entries.filter(shouldIncludeModel);
	const ids = new Set(included.map((e) => modelId(e.name ?? '')));
	const seen = new Set<string>();

	const models: GeminiModel[] = [];
	for (const entry of included) {
		const id = modelId(entry.name ?? '');
		if (seen.has(id)) continue;
		seen.add(id);
		if (isPreview(id) && ids.has(gaId(id))) continue;
		models.push({
			value: id,
			label: entry.displayName || id,
			provider: 'gemini',
			maxTemperature: entry.maxTemperature ?? 2,
			...(isImageModel(id) && { supportsImageGeneration: true }),
			...(entry.inputTokenLimit ? { contextWindow: entry.inputTokenLimit } : {}),
		});
	}

	// The `-latest` aliases lead the dropdowns, as they did in the curated list.
	const latest = models.filter((m) => m.value.endsWith('-latest'));
	const rest = models.filter((m) => !m.value.endsWith('-latest'));
	const ordered = [...latest, ...rest];
	stampRoleDefaults(ordered);
	return ordered;
}

function stampRoleDefaults(models: GeminiModel[]): void {
	for (const [role, preferences] of Object.entries(ROLE_PREFERENCES) as [ModelRole, (string | RegExp)[]][]) {
		const pool = models.filter((m) => Boolean(m.supportsImageGeneration) === (role === 'image'));
		const pick = pickPreferred(pool, preferences);
		if (pick) pick.defaultForRoles = [...(pick.defaultForRoles ?? []), role];
	}
}

/**
 * The first model matching the first preference that matches anything. For a
 * pattern, the highest version number wins (`gemini-3.8-flash` over
 * `gemini-3.5-flash`), since `ListModels` carries no release dates.
 */
function pickPreferred(
	models: readonly GeminiModel[],
	preferences: readonly (string | RegExp)[]
): GeminiModel | undefined {
	for (const preference of preferences) {
		if (typeof preference === 'string') {
			const exact = models.find((m) => m.value === preference);
			if (exact) return exact;
			continue;
		}
		const matches = models.filter((m) => preference.test(m.value));
		if (matches.length) {
			return matches.reduce((best, m) => (versionOf(m.value) > versionOf(best.value) ? m : best));
		}
	}
	return undefined;
}

function versionOf(id: string): number {
	const match = /^gemini-([\d.]+)-/.exec(id);
	return match ? parseFloat(match[1]) : 0;
}
