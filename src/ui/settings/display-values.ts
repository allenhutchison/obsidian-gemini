/**
 * "Used by", "Includes", and the various `displayValue` strings surfaced on
 * the Providers and Features pages (settings-redesign design doc §5.6). All
 * strings go through `t()`; lists are joined with `t('settings.common.listSeparator')`.
 *
 * `featureStatus`/`providerConnection` (the `ok`/`off`/`unsupported`/
 * `unconfigured` truth table and the connection probe) come from WP0's
 * `src/api/provider-status.ts` — this module only formats their result into
 * the short copy the mockups show (`"Gemini · qwen3:8b"`, not the longer
 * dropdown-option label `"Google Gemini (cloud)"`).
 */

import type { SettingsContext } from './context';
import { t, type TranslationKey } from '../../i18n';
import { featureRoute, activeProviders, featuresUsing } from '../../api/feature-routing';
import { providerConnection, featureStatus, type ProviderConnection } from '../../api/provider-status';
import { getCapabilities, type ModelProvider } from '../../api/providers/registry';
import { GEMINI_MODELS } from '../../models';
import { FEATURE_GROUPS, type FeatureId } from '../../types/features';

function sep(): string {
	return t('settings.common.listSeparator');
}

/**
 * Short provider names for row/chip copy ("Gemini", not "Google Gemini
 * (cloud)"). Covers only `ModelProvider` — the routable providers — since
 * this module never surfaces the card-only Anthropic placeholder;
 * `provider-cards.ts` keys its own `anthropic` short label directly.
 */
export const PROVIDER_SHORT_LABEL_KEY: Record<ModelProvider, TranslationKey> = {
	gemini: 'settings.providers.shortLabel.gemini',
	ollama: 'settings.providers.shortLabel.ollama',
	openai: 'settings.providers.shortLabel.openai',
};

/**
 * Heading/label key per feature group. Lives here with the other label-key
 * maps because both callers need the same one: the Features page's group
 * headings and `topLevelFeaturesDisplay`'s "Text on Ollama" summary.
 */
export const FEATURE_GROUP_LABEL_KEY: Record<(typeof FEATURE_GROUPS)[number]['key'], TranslationKey> = {
	text: 'settings.features.groupText',
	web: 'settings.features.groupWeb',
	media: 'settings.features.groupMedia',
};

export const FEATURE_LABEL_KEY: Record<FeatureId, TranslationKey> = {
	chat: 'settings.features.label.chat',
	summary: 'settings.features.label.summary',
	completions: 'settings.features.label.completions',
	rewrite: 'settings.features.label.rewrite',
	webSearch: 'settings.features.label.webSearch',
	deepResearch: 'settings.features.label.deepResearch',
	rag: 'settings.features.label.rag',
	imageGen: 'settings.features.label.imageGen',
};

/** Every feature currently served by a provider, as translated row labels. */
export function usedByLine(ctx: SettingsContext, p: ModelProvider): string {
	const list = featuresUsing(ctx.plugin.settings, p);
	if (list.length === 0) return t('settings.providers.usedByNone');
	return list.map((f) => t(FEATURE_LABEL_KEY[f])).join(sep());
}

/**
 * Capability-driven, never hardcoded per provider: a provider's card
 * advertises whichever provider-bound extras its capability row declares
 * (`maps` → Google Maps grounding, `webSearch` → page fetch by URL).
 */
export function includesLine(_ctx: SettingsContext, p: ModelProvider): string {
	const caps = getCapabilities(p);
	const parts: string[] = [];
	if (caps.maps) parts.push(t('settings.providers.includesMaps'));
	if (caps.webSearch) parts.push(t('settings.providers.includesUrlFetch'));
	if (parts.length === 0) return t('settings.providers.includesNone');
	return parts.join(sep());
}

const CONNECTION_LABEL_KEY: Record<ProviderConnection, TranslationKey> = {
	connected: 'settings.providers.statusConnected',
	'needs-key': 'settings.providers.statusNeedsKey',
	unreachable: 'settings.providers.statusUnreachable',
	unknown: 'settings.providers.statusUnknown',
};

/**
 * Translates a raw `ProviderConnection` into its display label.
 */
function connectionLabel(connection: ProviderConnection): string {
	return t(CONNECTION_LABEL_KEY[connection]);
}

/** A provider card's displayed value: its connection state. */
export function providerCardDisplay(ctx: SettingsContext, p: ModelProvider): string {
	return connectionLabel(providerConnection(ctx.plugin, p));
}

/** The model label shown for a feature row/page: the live list's label, or the appropriate "no model" copy. */
function featureModelLabel(ctx: SettingsContext, f: FeatureId): string {
	if (f === 'deepResearch') return t('settings.features.deepResearchAgent');
	if (f === 'rag') return t('settings.features.fileSearch');
	const route = featureRoute(ctx.plugin.settings, f);
	const provider = route.provider === 'none' ? null : route.provider;
	if (!route.model) {
		const caps = provider ? getCapabilities(provider) : null;
		return caps && !caps.perUseCaseModels && f !== 'chat'
			? t('settings.features.sameAsChat')
			: t('settings.features.modelDefault');
	}
	const entry = GEMINI_MODELS.find((m) => m.value === route.model && (m.provider ?? 'gemini') === provider);
	if (entry) return entry.label;
	return `${route.model} (${t('settings.features.modelMissing')})`;
}

/**
 * A Features-page row's displayed value: `t('settings.features.off')` when
 * the route is `'none'`; `t('settings.features.chooseProvider')` when
 * `unsupported`; `"<provider> · not connected"` when `unconfigured`;
 * otherwise `"<provider> · <model>"`. `rag` additionally shows Off when
 * `ragIndexing.enabled` is false even though it is routed (mirrors the
 * mockup's "Gemini · off").
 */
export function featureRowDisplay(ctx: SettingsContext, f: FeatureId): string {
	const { plugin } = ctx;
	const status = featureStatus(plugin, f);
	if (status === 'off') return t('settings.features.off');
	if (status === 'unsupported') return t('settings.features.chooseProvider');
	const route = featureRoute(plugin.settings, f);
	const providerLabel = t(PROVIDER_SHORT_LABEL_KEY[route.provider as ModelProvider]);
	if (status === 'unconfigured') {
		return `${providerLabel}${sep()}${t('settings.features.notConnected')}`;
	}
	if (f === 'rag' && !plugin.settings.ragIndexing.enabled) {
		return `${providerLabel}${sep()}${t('settings.features.off')}`;
	}
	return `${providerLabel}${sep()}${featureModelLabel(ctx, f)}`;
}

/**
 * Dropdown options for a feature's model control: a leading "Default for
 * this provider" / "Same as chat" entry, then every model the current
 * provider offers for this feature's role, plus the stored model itself
 * (labelled "No longer available") if it has fallen out of the live list.
 * `{}` when the feature is off (the model row is hidden in that state).
 */
export function modelOptions(ctx: SettingsContext, f: FeatureId): Record<string, string> {
	const route = featureRoute(ctx.plugin.settings, f);
	if (route.provider === 'none') return {};
	const provider = route.provider;
	const caps = getCapabilities(provider);
	const wantsImage = f === 'imageGen';
	const pool = GEMINI_MODELS.filter(
		(m) => (m.provider ?? 'gemini') === provider && Boolean(m.supportsImageGeneration) === wantsImage
	);
	const defaultLabel =
		!caps.perUseCaseModels && f !== 'chat' ? t('settings.features.sameAsChat') : t('settings.features.modelDefault');
	const options: Record<string, string> = { '': defaultLabel };
	for (const m of pool) {
		options[m.value] = m.label;
	}
	if (route.model && !(route.model in options)) {
		options[route.model] = `${route.model} (${t('settings.features.modelMissing')})`;
	}
	return options;
}

/** Whether a feature's stored model has fallen out of its provider's current list (drives an inline validation error). */
export function isModelMissing(ctx: SettingsContext, f: FeatureId): boolean {
	const route = featureRoute(ctx.plugin.settings, f);
	if (route.provider === 'none' || !route.model) return false;
	const provider = route.provider;
	return !GEMINI_MODELS.some((m) => m.value === route.model && (m.provider ?? 'gemini') === provider);
}

/** Top-level tab's "Providers" row: every provider currently used, or serving as the default, in display order. */
export function topLevelProvidersDisplay(ctx: SettingsContext): string {
	const providers = activeProviders(ctx.plugin.settings);
	if (providers.length === 0) return t('settings.providers.usedByNone');
	return providers.map((p) => t(PROVIDER_SHORT_LABEL_KEY[p])).join(sep());
}

/**
 * Top-level tab's "Features" row: a grouped summary ("Text on Ollama ·
 * Images and web on Gemini") when the feature groups cleanly split by
 * provider, else the same provider list `topLevelProvidersDisplay` shows.
 */
export function topLevelFeaturesDisplay(ctx: SettingsContext): string {
	const { plugin } = ctx;
	const parts: string[] = [];
	for (const group of FEATURE_GROUPS) {
		const providers = new Set(
			group.features
				.map((f) => featureRoute(plugin.settings, f).provider)
				.filter((p): p is ModelProvider => p !== 'none')
		);
		if (providers.size !== 1) continue;
		const [provider] = providers;
		parts.push(
			t('settings.providers.groupOnProvider', {
				group: t(FEATURE_GROUP_LABEL_KEY[group.key]),
				provider: t(PROVIDER_SHORT_LABEL_KEY[provider]),
			})
		);
	}
	if (parts.length === 0) return topLevelProvidersDisplay(ctx);
	return parts.join(sep());
}
