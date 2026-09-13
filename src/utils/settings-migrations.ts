/**
 * One-time settings migrations that run in `ObsidianGemini.loadSettings`.
 *
 * These are pure helpers (mutate the merged settings in place, return whether a
 * change was applied) so the caller can persist + log once and so the migration
 * logic is unit-testable without standing up a full plugin instance. They detect
 * the pre-migration shape from the raw persisted data (pre-merge) rather than the
 * merged settings, whose defaults already backfill new fields.
 */

import { normalizePath } from 'obsidian';
import { PROVIDER_IDS, providerSupports, type ModelProvider, type ProviderFeatureId } from '../api/providers/registry';
import {
	FEATURE_IDS,
	FEATURE_MODEL_ROLE,
	type FeatureId,
	type FeatureRoutes,
	type ProviderModelMemory,
	type RoutedProvider,
} from '../types/features';
import type { ObsidianGeminiSettings } from '../types/settings';

function isValidProvider(value: unknown): value is ModelProvider {
	return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Migrate the pre-settings-redesign `provider` + `providerOverrides` + the ten
 * per-provider model-name fields into the dense `features` / `providerModelMemory`
 * model (`settingsSchemaVersion` 1 -> 2).
 *
 * **Guard.** Runs when `rawData` exists and (`(rawData.settingsSchemaVersion ?? 1) < 2`
 * OR `rawData.features` is missing). The second clause matters: a downgrade to a
 * pre-redesign release and back up would otherwise leave `settingsSchemaVersion: 2`
 * on disk (carried forward by the old release's `Object.assign`) with no `features`
 * — keying only on the version would skip the migration on the way back up and
 * silently discard everything the old release wrote.
 *
 * **No silent fallback (see `api/feature-routing.ts`).** Every slot this migration
 * can't honour with the user's own configuration becomes `'none'`, never a
 * substitute provider: an absent override maps to `defaultProvider` only when that
 * provider can serve the feature, otherwise `'none'` — reproducing exactly what
 * `resolveProvider` returns `null` for today. An *explicit* override is honoured
 * even when it's itself invalid for that feature (mapping to `'none'`, never to
 * `defaultProvider`).
 *
 * @param settings - freshly merged settings (mutated in place)
 * @param rawData - raw persisted data as loaded from disk, pre-merge
 * @returns true when the migration ran (and the caller should persist)
 */
export function migrateToFeatureRouting(
	settings: ObsidianGeminiSettings,
	rawData: Record<string, unknown> | null | undefined
): boolean {
	if (!rawData) return false;
	const version = typeof rawData.settingsSchemaVersion === 'number' ? rawData.settingsSchemaVersion : 1;
	const hasFeatures = rawData.features !== undefined && rawData.features !== null;
	if (version >= 2 && hasFeatures) return false;

	const legacyProvider: ModelProvider = isValidProvider(rawData.provider) ? rawData.provider : 'gemini';
	settings.defaultProvider = legacyProvider;

	const overridesRaw = rawData.providerOverrides;
	const overrides =
		overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)
			? (overridesRaw as Record<string, unknown>)
			: {};

	// Step 1: provider routing. Mirrors `resolveProvider`'s pre-redesign
	// resolution exactly: whatever it returns `null` for today becomes `'none'`.
	const routeFor = (feature: ProviderFeatureId): RoutedProvider => {
		const override = overrides[feature];
		if (override !== undefined) {
			return isValidProvider(override) && providerSupports(override, feature) ? override : 'none';
		}
		return providerSupports(legacyProvider, feature) ? legacyProvider : 'none';
	};

	const webSearchProvider = routeFor('webSearch');
	// The old `webSearch` use case covered search, maps, URL context, AND deep
	// research; `deepResearch` inherits the same resolution.
	const deepResearchProvider: RoutedProvider =
		webSearchProvider !== 'none' && providerSupports(webSearchProvider, 'deepResearch') ? webSearchProvider : 'none';

	const features: FeatureRoutes = {
		chat: { provider: routeFor('chat'), model: '' },
		summary: { provider: routeFor('summary'), model: '' },
		completions: { provider: routeFor('completions'), model: '' },
		rewrite: { provider: routeFor('rewrite'), model: '' },
		webSearch: { provider: webSearchProvider, model: '' },
		deepResearch: { provider: deepResearchProvider, model: '' },
		rag: { provider: routeFor('rag'), model: '' },
		imageGen: { provider: routeFor('imageGen'), model: '' },
	};

	// Step 2: model memory (lossless; every old model field lands somewhere).
	const providerModelMemory: ProviderModelMemory = {};
	const remember = (provider: ModelProvider, feature: FeatureId, value: unknown) => {
		if (typeof value !== 'string' || value === '') return;
		if (!providerModelMemory[provider]) providerModelMemory[provider] = {};
		providerModelMemory[provider][feature] = value;
	};

	// Fold in the effect of the old `migrateOllamaModelSetting`: before
	// `ollamaModelName` existed, an Ollama-primary install's single model
	// picker wrote to `chatModelName`, so that field holds an Ollama model
	// (not a Gemini one) in that pre-migration shape.
	const chatModelNameIsActuallyOllama = rawData.ollamaModelName === undefined && rawData.provider === 'ollama';
	if (chatModelNameIsActuallyOllama) {
		remember('ollama', 'chat', rawData.chatModelName);
		remember('ollama', 'rewrite', rawData.chatModelName);
		remember('ollama', 'webSearch', rawData.chatModelName);
	} else {
		remember('gemini', 'chat', rawData.chatModelName);
		remember('gemini', 'rewrite', rawData.chatModelName);
		remember('gemini', 'webSearch', rawData.chatModelName);
		remember('ollama', 'chat', rawData.ollamaModelName);
		remember('ollama', 'rewrite', rawData.ollamaModelName);
		remember('ollama', 'webSearch', rawData.ollamaModelName);
	}
	remember('gemini', 'summary', rawData.summaryModelName);
	remember('gemini', 'completions', rawData.completionsModelName);
	remember('gemini', 'imageGen', rawData.imageModelName);
	// '' (inherit ollamaModelName) resolves at migration time, so the new store
	// has no inherit sentinel.
	remember('ollama', 'summary', rawData.ollamaSummaryModelName || rawData.ollamaModelName);
	remember('ollama', 'completions', rawData.ollamaCompletionsModelName || rawData.ollamaModelName);
	remember('openai', 'chat', rawData.openaiModelName);
	remember('openai', 'rewrite', rawData.openaiModelName);
	remember('openai', 'webSearch', rawData.openaiModelName);
	remember('openai', 'summary', rawData.openaiSummaryModelName);
	remember('openai', 'completions', rawData.openaiCompletionsModelName);

	// Step 3: seed the active model from memory.
	for (const f of FEATURE_IDS) {
		const route = features[f];
		if (route.provider === 'none' || FEATURE_MODEL_ROLE[f] === null) {
			route.model = '';
		} else {
			route.model = providerModelMemory[route.provider]?.[f] ?? '';
		}
	}

	// Step 4: MCP enable toggle. `!== true` (not `=== false`) is deliberate:
	// `mcpEnabled` defaulted to `false`, so a `data.json` predating the key has
	// it absent while MCP was in fact off. Treating absent as "enabled" would
	// start every configured server on the next launch.
	if (rawData.mcpEnabled !== true) {
		for (const server of settings.mcpServers) {
			server.enabled = false;
		}
	}

	settings.features = features;
	settings.providerModelMemory = providerModelMemory;
	settings.settingsSchemaVersion = 2;

	// Step 5: delete the removed keys so they don't linger in data.json
	// (Object.assign({}, DEFAULT_SETTINGS, data) is shallow and would otherwise
	// carry forward whatever value the old data.json had, even though
	// DEFAULT_SETTINGS no longer seeds these fields).
	const removedKeys = [
		'provider',
		'providerOverrides',
		'chatModelName',
		'summaryModelName',
		'completionsModelName',
		'imageModelName',
		'ollamaModelName',
		'ollamaSummaryModelName',
		'ollamaCompletionsModelName',
		'openaiModelName',
		'openaiSummaryModelName',
		'openaiCompletionsModelName',
		'maxRetries',
		'initialBackoffDelay',
		'streamingEnabled',
		'useInteractionsApi',
		'useInteractionsApiMigrated',
		'temperature',
		'topP',
		'loopDetectionEnabled',
		'loopDetectionThreshold',
		'loopDetectionTimeWindowSeconds',
		'mcpEnabled',
		'expandedSettingsSections',
	] as const;
	for (const key of removedKeys) {
		delete (settings as unknown as Record<string, unknown>)[key];
	}

	return true;
}

/**
 * Normalize the state-folder setting (`settings.historyFolder`) at the settings
 * boundary (#1374).
 *
 * The state folder is set from a free-text field and is the argument
 * `isPathInFolder` is built on: `path === folder || path.startsWith(folder + '/')`.
 * A persisted trailing (or duplicate/leading) slash makes both arms dead —
 * containment reports that nothing lives inside the folder — so every exclusion
 * built on the setting silently stops excluding (file mention modal, tool
 * guards) and every `${historyFolder}/...` path doubles its slash.
 *
 * Normalizing here (not inside `isPathInFolder`) keeps the predicate pure and
 * fixes both the containment checks and the path building in one place; the
 * load-time call covers vaults that already persisted a malformed value.
 *
 * @param settings - settings object with the `historyFolder` field (mutated in place)
 * @returns true if the value was malformed and has been rewritten
 */
export function normalizeStateFolderPath(settings: { historyFolder: string }): boolean {
	if (!settings.historyFolder) {
		return false;
	}
	// normalizePath leaves surrounding whitespace untouched on some inputs;
	// trim explicitly so the result is unambiguous.
	const candidate = settings.historyFolder.trim();
	if (!candidate) {
		return false;
	}
	const normalized = normalizePath(candidate);
	if (normalized === settings.historyFolder) {
		return false;
	}
	settings.historyFolder = normalized;
	return true;
}
