/**
 * Features page (settings-redesign design doc §5.4): one row per feature
 * showing "provider · model". Opening a row gives exactly two controls (a
 * provider dropdown, and a searchable model picker filtered to that provider) —
 * **assignment only happens here**, never on a provider card.
 */

import type { SettingDefinitionItem, SettingDefinitionPage, SettingDefinitionRender, SettingGroupItem } from 'obsidian';
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
import { ModelPickerModal, orderModelPickerOptions } from '../components/model-picker-modal';

const GROUP_DESC_KEY: Partial<Record<(typeof FEATURE_GROUPS)[number]['key'], TranslationKey>> = {
	text: 'settings.features.groupTextDesc',
	web: 'settings.features.groupWebDesc',
};

/**
 * A feature's model row: a button showing the current choice that opens the
 * fuzzy-search `ModelPickerModal`. A `render` row rather than a declarative
 * dropdown because a native `<select>` cannot be searched, and an aggregator
 * endpoint lists hundreds of models. The pick is written through
 * `features.<f>.model`'s registered writer, exactly as the dropdown's was.
 */
function modelPickerRow(ctx: SettingsContext, f: FeatureId): SettingDefinitionRender {
	return {
		name: t('settings.features.model'),
		visible: () => featureRoute(ctx.plugin.settings, f).provider !== 'none',
		render: (setting) => {
			const { '': defaultLabel, ...models } = modelOptions(ctx, f);
			const current = featureRoute(ctx.plugin.settings, f).model;
			if (isModelMissing(ctx, f)) {
				setting.setDesc(t('settings.features.modelMissingHelp', { model: current }));
			}
			setting.addButton((button) => {
				button.buttonEl.addClass('gemini-model-picker-button');
				button.setButtonText(models[current] ?? defaultLabel ?? '').onClick(() => {
					const options = orderModelPickerOptions(
						{ value: '', label: defaultLabel ?? '' },
						Object.entries(models).map(([value, label]) => ({ value, label }))
					);
					new ModelPickerModal(ctx.app, options, (value) => {
						// Reflect the pick at once: persisting a route awaits a full
						// re-initialization, and the row is only rebuilt after it.
						button.setButtonText(models[value] ?? defaultLabel ?? '');
						void ctx.tab.setControlValue(`features.${f}.model`, value).then(() => ctx.tab.update());
					}).open();
				});
			});
		},
	};
}

/**
 * One feature's own sub-page: the provider dropdown, and (when it has a
 * model role) the model picker. Only caller is `featuresPage` below.
 */
function featurePage(ctx: SettingsContext, f: FeatureId): SettingDefinitionPage {
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
		items.push(modelPickerRow(ctx, f));
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
