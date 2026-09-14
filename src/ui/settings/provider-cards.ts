/**
 * Provider connection cards (settings-redesign design doc §6). Each card is a
 * `SettingDefinitionPage` on the Providers page: credentials/endpoint, a
 * "Models" group with a refresh affordance, and read-only "Includes" /
 * "Used by" lines. **Assignment never happens here** — a card never routes a
 * feature to itself; that only happens on the Features page.
 */

import { Notice, SecretComponent, type SettingDefinitionItem, type SettingDefinitionPage } from 'obsidian';
import type { ObsidianGemini } from '../../types/plugin';
import { t, type TranslationKey } from '../../i18n';
import { getErrorMessage } from '../../utils/error-utils';
import { getCapabilities } from '../../api/providers/registry';
import { providerConnection } from '../../api/provider-status';
import { featuresUsing } from '../../api/feature-routing';
import type { SettingsContext } from './context';
import { readSettingPath } from './paths';
import { includesLine, usedByLine, providerCardDisplay } from './display-values';
import {
	modelCountCache,
	modelCountGeneration,
	bumpGeneration,
	invalidateModelCount,
	type CardProviderId,
} from './model-count-cache';
export type { CardProviderId } from './model-count-cache';
export { invalidateModelCount } from './model-count-cache';

export type AuthRow =
	| { kind: 'secret'; settingsKey: 'apiKeySecretName' | 'openaiApiKeySecretName' | 'anthropicApiKeySecretName' }
	| { kind: 'baseUrl'; settingsKey: 'customBaseUrl' | 'ollamaBaseUrl' | 'openaiBaseUrl'; optional: boolean }
	| { kind: 'subscription'; provider: 'openai' };

export interface ProviderCardSpec {
	id: CardProviderId;
	labelKey: TranslationKey;
	/** `false` = card renders but the provider is not offered on any Features row. */
	routable: boolean;
	auth: AuthRow[];
	/** Model refresh affordance + "N available" line. */
	models: 'remote' | 'daemon' | 'list' | 'none';
	/** Only for placeholder cards with no `ProviderDefinition` (Anthropic). */
	placeholderDocsUrl?: string;
}

export const PROVIDER_CARDS: ProviderCardSpec[] = [
	{
		id: 'gemini',
		labelKey: 'settings.providers.cardNameGemini',
		routable: true,
		auth: [
			{ kind: 'secret', settingsKey: 'apiKeySecretName' },
			{ kind: 'baseUrl', settingsKey: 'customBaseUrl', optional: true },
		],
		models: 'remote',
	},
	{
		id: 'ollama',
		labelKey: 'settings.providers.shortLabel.ollama',
		routable: true,
		auth: [{ kind: 'baseUrl', settingsKey: 'ollamaBaseUrl', optional: false }],
		models: 'daemon',
	},
	{
		id: 'openai',
		labelKey: 'settings.providers.shortLabel.openai',
		routable: true,
		auth: [
			{ kind: 'subscription', provider: 'openai' },
			{ kind: 'secret', settingsKey: 'openaiApiKeySecretName' },
			{ kind: 'baseUrl', settingsKey: 'openaiBaseUrl', optional: true },
		],
		models: 'list',
	},
	{
		id: 'anthropic',
		labelKey: 'settings.providers.shortLabel.anthropic',
		routable: false,
		auth: [{ kind: 'secret', settingsKey: 'anthropicApiKeySecretName' }],
		models: 'none',
	},
];

/**
 * Begin an interactive subscription sign-in for a provider. No implementation
 * ships in this release — the OpenAI "Sign in with your ChatGPT subscription"
 * row is disabled and its description says so. This is the seam a later
 * OAuth package plugs into; registering an entry here lights the row up with
 * no other change. Intentionally unread/unwritten outside this file today
 * (design doc §6.4) — exported so that later package can import it.
 * @public
 */
export type SubscriptionSignIn = (plugin: ObsidianGemini) => Promise<'signed-in' | 'cancelled'>;
/** @public */
export const SUBSCRIPTION_SIGN_IN: Partial<Record<CardProviderId, SubscriptionSignIn>> = {};

/**
 * Moved from the deleted `src/ui/settings-general.ts` (settings redesign
 * §6.2) — the Gemini card's "Refresh" button on the Models group.
 */
export async function refreshGeminiModelList(
	plugin: ObsidianGemini,
	onSuccess?: () => void | Promise<void>
): Promise<void> {
	try {
		const result = await plugin.getModelManager().refreshRemoteModels();
		if (result.fetched) {
			new Notice(
				result.modelCount === 1
					? t('settings.general.modelListUpdatedSingular', { count: result.modelCount })
					: t('settings.general.modelListUpdated', { count: result.modelCount })
			);
			if (onSuccess) await onSuccess();
			return;
		}
		const reasonMessage =
			result.skippedReason === 'offline'
				? t('settings.general.refreshSkippedOffline')
				: t('settings.general.refreshSkippedNotGemini');
		new Notice(reasonMessage);
	} catch (error) {
		plugin.logger.error('Failed to refresh Gemini model list:', error);
		new Notice(t('settings.general.refreshModelListFailed', { error: getErrorMessage(error) }));
	}
}

/**
 * Async content inside the synchronous `getSettingDefinitions()` (design doc
 * §5.7): render the last known count from `modelCountCache` immediately, kick
 * the fetch, and call `tab.update()` when it resolves — guarded by
 * `modelCountGeneration` so a stale probe started before a credential/base-URL
 * change (see `invalidateModelCount`) can't overwrite a fresher one.
 */

/**
 * @param userInitiated true when the user clicked Refresh: the outcome is
 * announced with a Notice, matching the Gemini card, so the click visibly
 * did something. Background probes on render stay silent.
 */
function loadModelCount(ctx: SettingsContext, id: CardProviderId, userInitiated: boolean): void {
	if (id === 'gemini' || id === 'anthropic') return; // Gemini's count comes from the sync remote-list cache; Anthropic has no client.
	const modelManager = ctx.plugin.modelManager as typeof ctx.plugin.modelManager | undefined;
	if (!modelManager) return; // plugin still loading; the next render retries
	const generation = bumpGeneration(id);
	const service = id === 'ollama' ? modelManager.getOllamaModelsService() : modelManager.getOpenAIModelsService();
	const spec = PROVIDER_CARDS.find((card) => card.id === id);
	const providerLabel = spec ? t(spec.labelKey) : id;
	service
		.getModels(userInitiated)
		.then((models) => {
			if (modelCountGeneration.get(id) !== generation) return; // superseded by a later probe
			// `getModels` never rejects — a failed fetch returns the stale cache or
			// an empty list — so the probe result is the only reliable outcome signal.
			if (userInitiated) {
				if (service.lastProbe === 'unreachable') {
					new Notice(t('settings.providers.refreshUnreachable', { provider: providerLabel }));
				} else {
					new Notice(
						models.length === 1
							? t('settings.general.modelListUpdatedSingular', { count: models.length })
							: t('settings.general.modelListUpdated', { count: models.length })
					);
				}
			}
			modelCountCache.set(id, { total: models.length, cloud: models.filter((m) => m.remoteHost).length });
			// The model count is a plain `desc` string, not a `displayValue`/`status`
			// function — `refreshDomState()` only re-evaluates those in place, so
			// picking up the new count needs a full `update()` (design doc §5.7).
			ctx.tab.update();
		})
		.catch((error: unknown) => {
			if (userInitiated) {
				new Notice(t('settings.general.refreshModelListFailed', { error: getErrorMessage(error) }));
			}
			// Leave the last known count in place; the card's connection status already reports the failure.
		});
}

/** "N available" / "N pulled" line for a card's Models group. */
function modelsSummary(ctx: SettingsContext, id: CardProviderId): string {
	// `addSettingTab()` evaluates definitions during `onload()`, before
	// `lifecycle.setup()` has created the model manager; report "loading"
	// until it exists rather than crashing plugin load.
	const modelManager = ctx.plugin.modelManager as typeof ctx.plugin.modelManager | undefined;
	if (!modelManager) return t('settings.providers.modelsLoading');
	if (id === 'gemini') {
		const count = modelManager.getListProvider().getModels().length;
		return t('settings.providers.modelsAvailable', { count });
	}
	if (id === 'anthropic') return t('settings.providers.modelsUnavailable');
	const cached = modelCountCache.get(id);
	if (cached === undefined) {
		loadModelCount(ctx, id, false);
		return t('settings.providers.modelsLoading');
	}
	if (id !== 'ollama') return t('settings.providers.modelsAvailable', { count: cached.total });
	const pulled = cached.total - cached.cloud;
	return cached.cloud > 0
		? t('settings.providers.modelsPulledAndCloud', { count: pulled, cloud: cached.cloud })
		: t('settings.providers.modelsPulled', { count: pulled });
}

function refreshModels(ctx: SettingsContext, id: CardProviderId): void {
	if (id === 'gemini') {
		void refreshGeminiModelList(ctx.plugin, () => ctx.tab.update());
		return;
	}
	if (id === 'anthropic') return;
	loadModelCount(ctx, id, true);
}

function authRows(ctx: SettingsContext, spec: ProviderCardSpec): SettingDefinitionItem[] {
	const { plugin, app } = ctx;
	return spec.auth.map((row): SettingDefinitionItem => {
		if (row.kind === 'secret') {
			return {
				name: t('settings.providers.apiKeyName'),
				desc: t('settings.providers.apiKeyDesc'),
				render: (setting) => {
					setting.components.push(
						new SecretComponent(app, setting.controlEl)
							.setValue((readSettingPath(plugin.settings, row.settingsKey) as string) ?? '')
							.onChange(async (value) => {
								plugin.settings[row.settingsKey] = value;
								await plugin.saveSettings();
								// The cached model count (and any probe already in flight) was
								// measured against the old key and no longer reflects reality.
								invalidateModelCount(spec.id);
								ctx.tab.update();
							})
					);
				},
			};
		}
		if (row.kind === 'baseUrl') {
			return {
				name: t('settings.providers.baseUrlName'),
				desc: row.optional ? t('settings.providers.baseUrlOptionalDesc') : t('settings.providers.baseUrlRequiredDesc'),
				control: {
					type: 'text',
					key: row.settingsKey,
					placeholder: t('settings.providers.baseUrlPlaceholder'),
					validate: (value) => {
						if (!value && row.optional) return;
						try {
							new URL(value);
						} catch {
							return t('settings.providers.baseUrlInvalid');
						}
					},
				},
			};
		}
		// row.kind === 'subscription'
		return {
			name: t('settings.providers.subscriptionSignInName'),
			desc: t('settings.providers.subscriptionComingSoon'),
			disabled: () => SUBSCRIPTION_SIGN_IN[row.provider] === undefined,
			action: () => {
				const handler = SUBSCRIPTION_SIGN_IN[row.provider];
				if (handler) void handler(plugin);
			},
		};
	});
}

/** Build the full navigable page for one provider card. */
export function providerCardPage(ctx: SettingsContext, spec: ProviderCardSpec): SettingDefinitionPage {
	const { id } = spec;
	const isRealProvider = id !== 'anthropic';
	const caps = isRealProvider ? getCapabilities(id) : null;

	const items: SettingDefinitionItem[] = [...authRows(ctx, spec)];

	if (spec.models !== 'none') {
		items.push({
			type: 'group',
			heading: t('settings.providers.modelsHeading'),
			items: [
				{
					name: t('settings.providers.modelsRowName'),
					desc: modelsSummary(ctx, id),
					render: (setting) => {
						setting.addButton((button) =>
							button.setButtonText(t('settings.providers.refreshButton')).onClick(() => refreshModels(ctx, id))
						);
					},
				},
			],
		});
	}

	if (isRealProvider && caps && (caps.maps || caps.webSearch)) {
		items.push({
			name: t('settings.providers.includesHeading'),
			desc: includesLine(ctx, id),
		});
	}

	if (isRealProvider) {
		items.push({
			name: t('settings.providers.usedByHeading'),
			desc: usedByLine(ctx, id),
		});
	} else {
		items.push({
			name: t('settings.providers.notYetRoutableHeading'),
			desc: t('settings.providers.anthropicPlaceholderDesc'),
		});
	}

	return {
		type: 'page',
		name: t(spec.labelKey),
		displayValue: () => (isRealProvider ? providerCardDisplay(ctx, id) : connectionLabelForPlaceholder(ctx)),
		status: () =>
			isRealProvider &&
			providerConnection(ctx.plugin, id) !== 'connected' &&
			featuresUsing(ctx.plugin.settings, id).length > 0
				? 'warning'
				: null,
		items,
	};
}

function connectionLabelForPlaceholder(ctx: SettingsContext): string {
	return ctx.plugin.settings.anthropicApiKeySecretName
		? t('settings.providers.statusConnected')
		: t('settings.providers.statusNeedsKey');
}
