/**
 * Features page (settings-redesign design doc §5.4): one row per feature
 * showing "provider · model". Opening a row gives exactly two controls (a
 * provider dropdown, and a model dropdown filtered to that provider) —
 * **assignment only happens here**, never on a provider card.
 */

import type { SettingDefinitionItem, SettingDefinitionPage, SettingGroupItem } from 'obsidian';
import { t, type TranslationKey } from '../../i18n';
import type { SettingsContext } from './context';
import { FEATURE_GROUPS, FEATURE_MODEL_ROLE, type FeatureId } from '../../types/features';
import { featureRoute } from '../../api/feature-routing';
import { featureStatus } from '../../api/provider-status';
import { PROVIDERS, providersSupporting } from '../../api/providers/registry';
import {
	FEATURE_GROUP_LABEL_KEY,
	FEATURE_LABEL_KEY,
	featureRowDisplay,
	modelOptions,
	isModelMissing,
	topLevelFeaturesDisplay,
} from './display-values';

const GROUP_DESC_KEY: Partial<Record<(typeof FEATURE_GROUPS)[number]['key'], TranslationKey>> = {
	text: 'settings.features.groupTextDesc',
	web: 'settings.features.groupWebDesc',
};

/**
 * One feature's own sub-page: the provider dropdown, and (when it has a
 * model role) the model dropdown. Design-doc-published export (§5.3);
 * `featuresPage` is the only caller today, but it's the natural unit tests
 * or a future page would target directly.
 * @public
 */
export function featurePage(ctx: SettingsContext, f: FeatureId): SettingDefinitionPage {
	const items: SettingDefinitionItem[] = [
		{
			name: t('settings.features.provider'),
			control: {
				type: 'dropdown',
				key: `features.${f}.provider`,
				options: {
					// The full descriptive label ("Google Gemini (cloud)") here — this is
					// the decision point, where the "cloud"/"local" hint matters. The
					// short label ("Gemini") is only for the row's summary text
					// (`featureRowDisplay`), matching the mockups.
					...Object.fromEntries(providersSupporting(f).map((p) => [p, t(PROVIDERS[p].labelKey as TranslationKey)])),
					none: t('settings.features.off'),
				},
			},
		},
	];

	const hasModelRole = FEATURE_MODEL_ROLE[f] !== null;
	if (hasModelRole) {
		items.push({
			name: t('settings.features.model'),
			visible: () => featureRoute(ctx.plugin.settings, f).provider !== 'none',
			control: {
				type: 'dropdown',
				key: `features.${f}.model`,
				options: modelOptions(ctx, f),
				validate: (value) => {
					if (!value) return;
					if (isModelMissing(ctx, f)) return t('settings.features.modelMissingHelp', { model: value });
				},
			},
		});
	} else {
		items.push({
			name: t('settings.features.model'),
			desc: f === 'deepResearch' ? t('settings.features.deepResearchAgent') : t('settings.features.fileSearch'),
			visible: () => featureRoute(ctx.plugin.settings, f).provider !== 'none',
		});
	}

	return {
		type: 'page',
		name: t(FEATURE_LABEL_KEY[f]),
		displayValue: () => featureRowDisplay(ctx, f),
		status: () => (featureStatus(ctx.plugin, f) === 'ok' || featureStatus(ctx.plugin, f) === 'off' ? null : 'warning'),
		items,
	};
}

/** The Features page itself: three groups (Text / Web and research / Media) of feature rows. */
export function featuresPage(ctx: SettingsContext): SettingDefinitionPage {
	const items: SettingDefinitionItem[] = FEATURE_GROUPS.map((group) => {
		const descKey = GROUP_DESC_KEY[group.key];
		const groupItems: SettingGroupItem[] = [];
		if (descKey) {
			groupItems.push({ name: t(descKey), searchable: false });
		}
		groupItems.push(...group.features.map((f) => featurePage(ctx, f)));
		return {
			type: 'group' as const,
			heading: t(FEATURE_GROUP_LABEL_KEY[group.key]),
			items: groupItems,
		};
	});

	return {
		type: 'page',
		name: t('settings.features.pageName'),
		displayValue: () => topLevelFeaturesDisplay(ctx),
		items,
	};
}
