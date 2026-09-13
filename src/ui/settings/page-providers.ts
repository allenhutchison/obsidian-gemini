/**
 * Providers page (settings-redesign design doc §6.1–§6.2): one connection
 * card per account/endpoint, then "Default provider" and a single privacy
 * note replacing the four privacy-notice variants (§4.8).
 */

import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import { t } from '../../i18n';
import type { SettingsContext } from './context';
import { PROVIDER_IDS } from '../../api/providers/registry';
import { providerConnection } from '../../api/provider-status';
import { featuresUsing } from '../../api/feature-routing';
import { PROVIDER_CARDS, providerCardPage } from './provider-cards';
import { PROVIDER_SHORT_LABEL_KEY, topLevelProvidersDisplay } from './display-values';

function anyUsedProviderNeedsAttention(ctx: SettingsContext): boolean {
	return PROVIDER_IDS.some(
		(p) => featuresUsing(ctx.plugin.settings, p).length > 0 && providerConnection(ctx.plugin, p) !== 'connected'
	);
}

export function providersPage(ctx: SettingsContext): SettingDefinitionPage {
	const items: SettingDefinitionItem[] = PROVIDER_CARDS.map((spec) => providerCardPage(ctx, spec));

	items.push({
		name: t('settings.providers.defaultProviderName'),
		desc: t('settings.providers.defaultProviderDesc'),
		control: {
			type: 'dropdown',
			key: 'defaultProvider',
			options: Object.fromEntries(PROVIDER_IDS.map((p) => [p, t(PROVIDER_SHORT_LABEL_KEY[p])])),
		},
	});

	items.push({
		name: t('settings.providers.privacyNoticeName'),
		desc: t('settings.providers.privacyNoticeDesc'),
	});

	return {
		type: 'page',
		name: t('settings.main.providersName'),
		displayValue: () => topLevelProvidersDisplay(ctx),
		status: () => (anyUsedProviderNeedsAttention(ctx) ? 'warning' : null),
		items,
	};
}
