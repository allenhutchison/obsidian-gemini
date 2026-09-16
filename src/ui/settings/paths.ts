/**
 * Dotted-path read/write for the declarative settings tab (settings-redesign
 * design doc §5.2). `PluginSettingTab.getControlValue`/`setControlValue` are
 * keyed by a flat string per `SettingControlBase.key`; this module resolves
 * that string against `plugin.settings`, either directly (`userName`,
 * `chatHistory`, …) or through a nested path (`features.chat.provider`,
 * `ragIndexing.autoSync`, …).
 *
 * Every path whose write needs more than a plain assignment — validation,
 * side effects, a confirmation modal, or a shape `writeSettingPath` can't
 * express safely (`ragIndexing.excludeFolders` is a `string[]` behind a
 * `textarea`) — is registered in `SETTING_WRITERS` instead. WP3 contributes
 * its own writers (`TOOL_POLICY_WRITERS` from `page-tool-permissions.ts`,
 * `RAG_WRITERS` from `page-vault-index.ts`); this module merges them in so
 * both packages' writers are reachable through one map.
 */

import { Notice } from 'obsidian';
import type { ObsidianGeminiSettings } from '../../types/settings';
import { normalizeStateFolderPath } from '../../utils/settings-migrations';
import { featureRoute, rememberModel, recallModel } from '../../api/feature-routing';
import { FEATURE_IDS, type FeatureId, type RoutedProvider } from '../../types/features';
import { PROVIDER_IDS, providerSupports, type ModelProvider } from '../../api/providers/registry';
import { GEMINI_MODELS } from '../../models';
import { t } from '../../i18n';
import type { SettingWriter } from './writer-types';
import { RAG_WRITERS } from './page-vault-index';
import { TOOL_POLICY_WRITERS } from './page-tool-permissions';
import { invalidateModelCount } from './model-count-cache';

/** Read a dotted path out of the settings object. `undefined` when any segment is missing. */
/**
 * Readers for paths whose stored shape differs from the control's value type.
 * Mirrors the matching entry in `SETTING_WRITERS` (`RAG_WRITERS` splits the
 * textarea back into an array); keep the two in sync.
 */
const SETTING_READERS: Record<string, (settings: ObsidianGeminiSettings) => unknown> = {
	'ragIndexing.excludeFolders': (settings) => settings.ragIndexing.excludeFolders.join('\n'),
};

/** `readSettingPath` with `SETTING_READERS` applied first. */
export function readControlValue(settings: ObsidianGeminiSettings, key: string): unknown {
	const reader = SETTING_READERS[key];
	return reader ? reader(settings) : readSettingPath(settings, key);
}

export function readSettingPath(settings: ObsidianGeminiSettings, key: string): unknown {
	const parts = key.split('.');
	let value: unknown = settings;
	for (const part of parts) {
		if (value === null || typeof value !== 'object') return undefined;
		value = (value as Record<string, unknown>)[part];
	}
	return value;
}

/**
 * Flat/nested settings paths that a plain assignment can write safely — every
 * one of them is a scalar (string/boolean/number) at every install, so there
 * is no shape to corrupt. Anything else (a non-scalar path, or a path that
 * needs validation or a side effect) belongs in `SETTING_WRITERS` instead;
 * `writeSettingPath` deliberately has no allowance for those.
 */
const WRITABLE_SCALAR_PATHS: readonly string[] = [
	'userName',
	'chatHistory',
	'alwaysShowDiffView',
	'debugMode',
	'fileLogging',
	'stopOnToolError',
	'summaryFrontmatterKey',
	'contextCompactionThreshold',
	'showTokenUsage',
	'logToolExecution',
	'autoRunCatchUp',
	'hooksEnabled',
	'ragIndexing.autoSync',
	'ragIndexing.includeAttachments',
	'apiKeySecretName',
	'openaiApiKeySecretName',
	'anthropicApiKeySecretName',
	'customBaseUrl',
	'ollamaBaseUrl',
	'openaiBaseUrl',
];

/** Write a dotted path. Returns `false` for a path not on the allowlist. */
export function writeSettingPath(settings: ObsidianGeminiSettings, key: string, value: unknown): boolean {
	if (!WRITABLE_SCALAR_PATHS.includes(key)) return false;
	const parts = key.split('.');
	let target: Record<string, unknown> = settings as unknown as Record<string, unknown>;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = target[parts[i]];
		if (typeof next !== 'object' || next === null) return false;
		target = next as Record<string, unknown>;
	}
	target[parts[parts.length - 1]] = value;
	return true;
}

/** Parses `features.<id>.provider` / `features.<id>.model`; `null` for anything else. */
function parseFeatureKey(key: string): { feature: FeatureId; field: 'provider' | 'model' } | null {
	const match = /^features\.([a-zA-Z]+)\.(provider|model)$/.exec(key);
	if (!match) return null;
	const [, feature, field] = match;
	if (!(FEATURE_IDS as readonly string[]).includes(feature)) return null;
	return { feature: feature as FeatureId, field: field as 'provider' | 'model' };
}

/** Whether a model value is present in the live list for the given provider. */
function modelExistsForProvider(model: string, provider: ModelProvider): boolean {
	if (!model) return false;
	return GEMINI_MODELS.some((m) => m.value === model && (m.provider ?? 'gemini') === provider);
}

/**
 * Writing a feature's provider (including `'none'`, the Off option): recalls
 * the model last picked for the (provider, feature) pair, dropping it back to
 * '' (provider default) if that model isn't in the new provider's current
 * list. Never substitutes a different provider — `'none'` is stored verbatim.
 */
const writeFeatureProvider: SettingWriter = async (plugin, key, value) => {
	const parsed = parseFeatureKey(key);
	if (!parsed || parsed.field !== 'provider') return { needsUpdate: false };
	const { feature } = parsed;
	const newProvider = value as RoutedProvider;
	if (newProvider === 'none') {
		plugin.settings.features[feature] = { provider: 'none', model: '' };
		return { needsUpdate: true };
	}
	const recalled = recallModel(plugin.settings, feature, newProvider);
	const model = modelExistsForProvider(recalled, newProvider) ? recalled : '';
	plugin.settings.features[feature] = { provider: newProvider, model };
	return { needsUpdate: true };
};

/** Writing a feature's model: also remembers it for this (provider, feature) pair. */
const writeFeatureModel: SettingWriter = async (plugin, key, value) => {
	const parsed = parseFeatureKey(key);
	if (!parsed || parsed.field !== 'model') return { needsUpdate: false };
	const { feature } = parsed;
	const route = featureRoute(plugin.settings, feature);
	if (route.provider === 'none') return { needsUpdate: false };
	const model = typeof value === 'string' ? value : '';
	plugin.settings.features[feature] = { ...route, model };
	rememberModel(plugin.settings, feature, route.provider, model);
	return { needsUpdate: false };
};

/**
 * Writing `defaultProvider`: re-points every feature whose provider was the
 * *previous* default and which the new default can serve; every other
 * feature — including one the new default cannot serve, and one the user
 * explicitly set to `'none'` — is left exactly as it was (design doc §11
 * note 1). Never invents a third provider.
 */
const writeDefaultProvider: SettingWriter = async (plugin, _key, value) => {
	const newDefault = value as ModelProvider;
	if (!(PROVIDER_IDS as readonly string[]).includes(newDefault)) return { needsUpdate: false };
	const previousDefault = plugin.settings.defaultProvider;
	if (newDefault === previousDefault) return { needsUpdate: false };
	plugin.settings.defaultProvider = newDefault;
	let moved = 0;
	for (const f of FEATURE_IDS) {
		const route = plugin.settings.features[f];
		if (route.provider === previousDefault && providerSupports(newDefault, f)) {
			const recalled = recallModel(plugin.settings, f, newDefault);
			const model = modelExistsForProvider(recalled, newDefault) ? recalled : '';
			plugin.settings.features[f] = { provider: newDefault, model };
			moved++;
		}
	}
	if (moved > 0) {
		new Notice(t('settings.providers.defaultMoved', { count: moved }));
	}
	return { needsUpdate: true };
};

/** Writing `historyFolder`: normalizes the path the way `loadSettings()` does for a persisted value. */
const writeHistoryFolder: SettingWriter = async (plugin, _key, value) => {
	plugin.settings.historyFolder = typeof value === 'string' ? value : '';
	normalizeStateFolderPath(plugin.settings);
	return { needsUpdate: false };
};

/** Which provider card's model count needs invalidating when a given credential/base-URL path changes. */
const CREDENTIAL_PATH_PROVIDER: Record<string, ModelProvider> = {
	apiKeySecretName: 'gemini',
	customBaseUrl: 'gemini',
	openaiApiKeySecretName: 'openai',
	openaiBaseUrl: 'openai',
	ollamaBaseUrl: 'ollama',
	anthropicApiKeySecretName: 'anthropic',
};

/**
 * Writing a provider's API key secret name or base URL: a plain scalar
 * assignment (`writeSettingPath` already handles the write itself), but the
 * Providers page's cached model count for that card — and any probe already
 * in flight — was measured against the old value and no longer reflects
 * reality. Invalidate it and report `needsUpdate` so the card re-probes.
 */
const writeCredentialField: SettingWriter = async (plugin, key, value) => {
	if (!writeSettingPath(plugin.settings, key, value)) return { needsUpdate: false };
	const provider = CREDENTIAL_PATH_PROVIDER[key];
	if (provider) invalidateModelCount(provider);
	return { needsUpdate: true };
};

/**
 * Paths whose write needs extra work beyond the plain assignment
 * `writeSettingPath` performs. Keys are exact paths or a pattern with a
 * single `*` wildcard segment; see `resolveWriter` for the matching rule.
 * Merges in WP3's `TOOL_POLICY_WRITERS` / `RAG_WRITERS` so every writer is
 * reachable through this one map without `paths.ts` importing anything
 * beyond what WP3 already exports.
 */
export const SETTING_WRITERS: Record<string, SettingWriter> = {
	'features.*.provider': writeFeatureProvider,
	'features.*.model': writeFeatureModel,
	defaultProvider: writeDefaultProvider,
	historyFolder: writeHistoryFolder,
	apiKeySecretName: writeCredentialField,
	openaiApiKeySecretName: writeCredentialField,
	anthropicApiKeySecretName: writeCredentialField,
	customBaseUrl: writeCredentialField,
	ollamaBaseUrl: writeCredentialField,
	openaiBaseUrl: writeCredentialField,
	...TOOL_POLICY_WRITERS,
	...RAG_WRITERS,
};

function patternMatches(pattern: string, key: string): boolean {
	const patternParts = pattern.split('.');
	const keyParts = key.split('.');
	if (patternParts.length !== keyParts.length) return false;
	return patternParts.every((p, i) => p === '*' || p === keyParts[i]);
}

/** Index of the pattern's `*` segment, or `Infinity` for a literal (non-wildcard) pattern. */
function literalPrefixLength(pattern: string): number {
	const index = pattern.split('.').indexOf('*');
	return index === -1 ? Infinity : index;
}

/**
 * Resolve the writer for a control key: an exact match in `SETTING_WRITERS`
 * always wins; otherwise the matching wildcard pattern with the longest
 * literal prefix wins (design doc §5.2). `undefined` means "no writer — fall
 * back to `writeSettingPath`".
 */
export function resolveWriter(key: string): SettingWriter | undefined {
	const exact = SETTING_WRITERS[key];
	if (exact) return exact;
	let best: { writer: SettingWriter; specificity: number } | undefined;
	for (const [pattern, writer] of Object.entries(SETTING_WRITERS)) {
		if (!pattern.includes('*')) continue;
		if (!patternMatches(pattern, key)) continue;
		const specificity = literalPrefixLength(pattern);
		if (!best || specificity > best.specificity) {
			best = { writer, specificity };
		}
	}
	return best?.writer;
}

/**
 * Whether a value's runtime type matches what a control of this type binds
 * (`SettingControlBase<V>` in `obsidian.d.ts`). Used by
 * `test/ui/settings/definitions.test.ts` to fail on any control whose bound
 * value doesn't match its declared control type — e.g. a `textarea` (which
 * persists a `string`) pointed directly at a `string[]` settings path
 * without a `SETTING_WRITERS` entry + `getControlValue` exception to bridge
 * the shapes (design doc §5.2, the M2 review finding).
 */
export function controlValueTypeMatches(controlType: string, value: unknown): boolean {
	switch (controlType) {
		case 'toggle':
			return typeof value === 'boolean';
		case 'number':
		case 'slider':
			return typeof value === 'number';
		case 'text':
		case 'textarea':
		case 'dropdown':
		case 'folder':
		case 'file':
		case 'color':
			return typeof value === 'string';
		default:
			return true;
	}
}
