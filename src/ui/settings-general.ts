import type { ObsidianGemini } from '../types/plugin';
import { App, Notice, Setting, SecretComponent } from 'obsidian';
import {
	apiKeySecretNameFor,
	createAlwaysOpenSection,
	createCollapsibleSection,
	createDebouncedSave,
	selectModelSetting,
} from './settings-helpers';
import { FolderSuggest } from './folder-suggest';
import { getErrorMessage } from '../utils/error-utils';
import { t, type TranslationKey } from '../i18n';
import type { SettingsSectionContext } from './settings-helpers';
import { getOllamaModelForRole, remoteHostForModel, type ModelProvider, type ModelRole } from '../models';
import { normalizeStateFolderPath } from '../utils/settings-migrations';
import {
	activeProviders,
	isProviderActive,
	overriddenUseCases,
	primaryProvider,
	resolveProvider,
	resolveProviderOrDefault,
} from '../api/provider-routing';
import {
	getCapabilities,
	PROVIDER_IDS,
	PROVIDER_USE_CASES,
	PROVIDERS,
	providersSupporting,
	type ProviderUseCase,
} from '../api/providers/registry';
import { DEFAULT_OPENAI_BASE_URL } from '../api/providers/openai/config';

export async function renderGeneralSettings(
	containerEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext
): Promise<void> {
	const debouncedSave = createDebouncedSave(plugin);

	const generalEl = createAlwaysOpenSection(
		containerEl,
		t('settings.general.sectionTitle'),
		t('settings.general.sectionDesc')
	);
	await renderGeneralSection(generalEl, plugin, app, context, debouncedSave);
}

/**
 * Render the contents of the "General" section. Extracted so provider-specific
 * fields can be re-rendered (on Provider change / Refresh model list) without
 * tearing down the surrounding settings tab.
 */
async function renderGeneralSection(
	sectionEl: HTMLElement,
	plugin: ObsidianGemini,
	app: App,
	context: SettingsSectionContext,
	debouncedSave: () => void
): Promise<void> {
	new Setting(sectionEl)
		.setName(t('settings.general.documentationName'))
		.setDesc(t('settings.general.documentationDesc'))
		.addButton((button) =>
			button.setButtonText(t('settings.general.viewDocumentationButton')).onClick(() => {
				window.open('https://allenhutchison.github.io/obsidian-gemini/', '_blank');
			})
		);

	const rerender = async () => {
		// Re-render only the General section so routing-dependent fields show/hide
		// without tearing down sections rendered later in the settings tab.
		sectionEl.empty();
		await renderGeneralSection(sectionEl, plugin, app, context, debouncedSave);
	};

	new Setting(sectionEl)
		.setName(t('settings.general.providerName'))
		.setDesc(t('settings.general.providerDesc'))
		.addDropdown((dropdown) => {
			for (const id of PROVIDER_IDS) {
				dropdown.addOption(id, t(PROVIDERS[id].labelKey as Parameters<typeof t>[0]));
			}
			return dropdown.setValue(primaryProvider(plugin.settings)).onChange(async (value) => {
				plugin.settings.provider = value as ModelProvider;
				await plugin.saveSettings();
				await rerender();
			});
		});

	await renderPerFeatureProviders(sectionEl, plugin, rerender);

	const usesOllama = isProviderActive(plugin.settings, 'ollama');
	const usesGemini = isProviderActive(plugin.settings, 'gemini');

	// Credentials and endpoints are rendered for every provider that serves *some*
	// use case, not just the primary — an otherwise-local install that routes
	// search or RAG to Gemini still needs the API key field (#704).
	if (usesGemini) {
		new Setting(sectionEl)
			.setName(t('settings.general.apiKeyName'))
			.setDesc(t('settings.general.apiKeyDesc'))
			.addComponent((el) =>
				new SecretComponent(app, el).setValue(plugin.settings.apiKeySecretName).onChange(async (secretName) => {
					plugin.settings.apiKeySecretName = secretName;
					await plugin.saveSettings();
				})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.refreshModelListName'))
			.setDesc(t('settings.general.refreshModelListGeminiDesc'))
			.addButton((button) =>
				button
					.setButtonText(t('settings.general.refreshButton'))
					.onClick(async () => refreshGeminiModelList(plugin, rerender))
			);
	}

	if (usesOllama) {
		new Setting(sectionEl)
			.setName(t('settings.general.ollamaBaseUrlName'))
			.setDesc(t('settings.general.ollamaBaseUrlDesc'))
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case -- default endpoint URL, shown verbatim
					.setPlaceholder('http://localhost:11434')
					.setValue(plugin.settings.ollamaBaseUrl)
					.onChange((value) => {
						plugin.settings.ollamaBaseUrl = value.trim() || 'http://localhost:11434';
						debouncedSave();
					})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.refreshOllamaModelListName'))
			.setDesc(t('settings.general.refreshModelListOllamaDesc'))
			.addButton((button) =>
				button.setButtonText(t('settings.general.refreshButton')).onClick(async () => {
					try {
						const manager = plugin.getModelManager();
						manager.getOllamaModelsService().invalidate();
						const models = await manager.getAvailableModels({ forceRefresh: true }, 'ollama');
						new Notice(
							models.length === 1
								? t('settings.general.ollamaModelsFoundSingular', { count: models.length })
								: t('settings.general.ollamaModelsFound', { count: models.length })
						);
						await rerender();
					} catch (error) {
						new Notice(t('settings.general.refreshFailedNotice', { error: getErrorMessage(error) }));
					}
				})
			);
	}

	const usesOpenai = isProviderActive(plugin.settings, 'openai');
	if (usesOpenai) {
		new Setting(sectionEl)
			.setName(t('settings.general.openaiApiKeyName'))
			.setDesc(t('settings.general.openaiApiKeyDesc'))
			.addComponent((el) =>
				new SecretComponent(app, el).setValue(plugin.settings.openaiApiKeySecretName).onChange(async (secretName) => {
					plugin.settings.openaiApiKeySecretName = secretName;
					await plugin.saveSettings();
				})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.openaiBaseUrlName'))
			.setDesc(t('settings.general.openaiBaseUrlDesc'))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_OPENAI_BASE_URL)
					.setValue(plugin.settings.openaiBaseUrl)
					.onChange((value) => {
						plugin.settings.openaiBaseUrl = value.trim() || DEFAULT_OPENAI_BASE_URL;
						debouncedSave();
					})
			);

		new Setting(sectionEl)
			.setName(t('settings.general.refreshOpenaiModelListName'))
			.setDesc(t('settings.general.refreshModelListOpenaiDesc'))
			.addButton((button) =>
				button.setButtonText(t('settings.general.refreshButton')).onClick(async () => {
					try {
						const manager = plugin.getModelManager();
						manager.getOpenAIModelsService().invalidate();
						const models = await manager.getAvailableModels({ forceRefresh: true }, 'openai');
						new Notice(
							models.length === 1
								? t('settings.general.openaiModelsFoundSingular', { count: models.length })
								: t('settings.general.openaiModelsFound', { count: models.length })
						);
						await rerender();
					} catch (error) {
						new Notice(t('settings.general.refreshFailedNotice', { error: getErrorMessage(error) }));
					}
				})
			);
	}

	renderPrivacyNotice(sectionEl, plugin);
	await renderModelPickers(sectionEl, plugin);

	new Setting(sectionEl)
		.setName(t('settings.general.stateFolderName'))
		.setDesc(t('settings.general.stateFolderDesc'))
		.addText((text) => {
			new FolderSuggest(app, text.inputEl, (folder) => {
				plugin.settings.historyFolder = folder;
				// FolderSuggest writes clean TFolder paths, but hand-typed text can
				// still reach this callback; normalize before it persists (#1374).
				normalizeStateFolderPath(plugin.settings);
				debouncedSave();
			});
			text.setValue(plugin.settings.historyFolder);
		});

	new Setting(sectionEl)
		.setName(t('settings.general.showAdvancedName'))
		.setDesc(t('settings.general.showAdvancedDesc'))
		.addToggle((toggle) =>
			toggle.setValue(context.showDeveloperSettings).onChange((value) => {
				context.setShowDeveloperSettings(value);
				context.redisplay();
			})
		);
}

/** i18n keys for each routable use case's row label and description. */
const USE_CASE_LABELS: Record<ProviderUseCase, { name: TranslationKey; desc: TranslationKey }> = {
	chat: { name: 'settings.general.useCaseChatName', desc: 'settings.general.useCaseChatDesc' },
	summary: { name: 'settings.general.useCaseSummaryName', desc: 'settings.general.useCaseSummaryDesc' },
	completions: { name: 'settings.general.useCaseCompletionsName', desc: 'settings.general.useCaseCompletionsDesc' },
	rewrite: { name: 'settings.general.useCaseRewriteName', desc: 'settings.general.useCaseRewriteDesc' },
	webSearch: { name: 'settings.general.useCaseWebSearchName', desc: 'settings.general.useCaseWebSearchDesc' },
	rag: { name: 'settings.general.useCaseRagName', desc: 'settings.general.useCaseRagDesc' },
	imageGen: { name: 'settings.general.useCaseImageGenName', desc: 'settings.general.useCaseImageGenDesc' },
};

/**
 * "Per-feature provider" rows: one dropdown per use case, each offering only
 * the providers that can actually serve it (#704).
 *
 * Every row defaults to "use the primary provider", so the section is inert
 * until a user deliberately splits something out. A use case whose only
 * candidate is the primary still renders — with the dropdown disabled — so the
 * capability gap is visible rather than silently missing.
 */
async function renderPerFeatureProviders(
	sectionEl: HTMLElement,
	plugin: ObsidianGemini,
	rerender: () => Promise<void>
): Promise<void> {
	const primary = primaryProvider(plugin.settings);
	const container = createCollapsibleSection(
		plugin,
		sectionEl,
		t('settings.general.perFeatureProviderTitle'),
		'per-feature-provider',
		{ description: t('settings.general.perFeatureProviderDesc') }
	);

	for (const useCase of PROVIDER_USE_CASES) {
		const candidates = providersSupporting(useCase);
		const labels = USE_CASE_LABELS[useCase];
		const primarySupports = candidates.includes(primary);

		const setting = new Setting(container).setName(t(labels.name)).setDesc(t(labels.desc));

		setting.addDropdown((dropdown) => {
			// The default option follows the primary, and names it so the row
			// reads correctly without cross-referencing the dropdown above.
			dropdown.addOption(
				'',
				primarySupports
					? t('settings.general.useProviderDefault', {
							provider: t(PROVIDERS[primary].labelKey as TranslationKey),
						})
					: t('settings.general.useCaseUnavailableOption')
			);
			// Skip the primary — the default option above already represents it.
			// Listing it again would show the same provider label twice, and
			// picking the second copy would persist an override equal to the
			// primary: inert today, but it defeats the sparse-override design.
			const explicit = candidates.filter((id) => id !== primary);
			for (const id of explicit) {
				dropdown.addOption(id, t(PROVIDERS[id].labelKey as TranslationKey));
			}

			// Fall back to the default option for any stored value with no
			// matching option (an override equal to the primary, or one left
			// behind by a hand-edited data.json). A `select` given an unknown
			// value renders blank, which reads as a broken row.
			const stored = plugin.settings.providerOverrides[useCase];
			dropdown.setValue(stored && explicit.includes(stored) ? stored : '');

			// Nothing to choose when the primary is the only candidate.
			if (explicit.length === 0) {
				dropdown.setDisabled(true);
			}

			return dropdown.onChange(async (value) => {
				if (value === '') {
					delete plugin.settings.providerOverrides[useCase];
				} else {
					plugin.settings.providerOverrides[useCase] = value as ModelProvider;
				}
				await plugin.saveSettings();
				// Model pickers and credential rows depend on this choice.
				await rerender();
			});
		});
	}
}

/**
 * Warn when a use case is routed away from the primary provider.
 *
 * Routing a feature to a cloud provider means that feature's data leaves the
 * machine, which is exactly the expectation a local primary sets. The plugin
 * never makes that jump on its own — this row exists so the consequence of the
 * choice the user *did* make stays visible in the settings UI.
 */
function renderPrivacyNotice(sectionEl: HTMLElement, plugin: ObsidianGemini): void {
	const primary = primaryProvider(plugin.settings);
	const overridden = overriddenUseCases(plugin.settings);

	// A keyless provider is enough to start the plugin, so a feature routed to a
	// key-requiring provider without a key initializes fine and then fails at
	// call time with an opaque auth error. Say so up front instead. Since
	// OpenAI (#1237) more than one active provider can require a key at once,
	// so each one's own secret field is checked rather than assuming Gemini's.
	const missingKey = activeProviders(plugin.settings).filter(
		(id) => getCapabilities(id).requiresApiKey && !apiKeySecretNameFor(plugin.settings, id)
	);
	if (missingKey.length > 0) {
		const providers = missingKey.map((id) => t(PROVIDERS[id].labelKey as TranslationKey)).join(', ');
		new Setting(sectionEl)
			.setName(t('settings.general.missingKeyNoticeName'))
			.setDesc(t('settings.general.missingKeyNoticeDesc', { providers }));
	}

	if (overridden.length > 0) {
		const features = overridden.map((useCase) => t(USE_CASE_LABELS[useCase].name)).join(', ');
		new Setting(sectionEl)
			.setName(t('settings.general.mixedProviderNoticeName'))
			.setDesc(t('settings.general.mixedProviderNoticeDesc', { features }));
		return;
	}

	if (getCapabilities(primary).requiresApiKey) return;

	// "Provider: Ollama" stopped implying "runs on this machine" once Ollama
	// shipped cloud models: they appear in /api/tags and go through the local
	// daemon, but inference — and the note content in the prompt — happens on
	// ollama.com. Claiming everything is local here would be an actively false
	// privacy assurance, so a remote-served model replaces the reassurance.
	const remote = remotelyServedModels(plugin.settings);
	if (remote.length > 0) {
		const models = remote.map((m) => m.model).join(', ');
		const hosts = [...new Set(remote.map((m) => m.host))].join(', ');
		new Setting(sectionEl)
			.setName(t('settings.general.remoteModelNoticeName'))
			.setDesc(t('settings.general.remoteModelNoticeDesc', { models, hosts }));
		return;
	}

	// An all-local configuration keeps the reassurance it had before #704.
	new Setting(sectionEl)
		.setName(t('settings.general.localOnlyNoticeName'))
		.setDesc(t('settings.general.localOnlyNoticeDesc'));
}

/**
 * The selected Ollama models that are actually served by a remote host, in
 * use-case order and de-duplicated by model name.
 *
 * Only use cases genuinely routed to Ollama are inspected — a use case pointed
 * at Gemini is covered by the mixed-provider notice instead.
 */
function remotelyServedModels(
	settings: ObsidianGemini['settings']
): { useCase: ProviderUseCase; model: string; host: string }[] {
	const roles: { useCase: ProviderUseCase; role: ModelRole }[] = [
		{ useCase: 'chat', role: 'chat' },
		{ useCase: 'summary', role: 'summary' },
		{ useCase: 'completions', role: 'completions' },
	];

	const seen = new Set<string>();
	const remote: { useCase: ProviderUseCase; model: string; host: string }[] = [];
	for (const { useCase, role } of roles) {
		if (resolveProviderOrDefault(settings, useCase) !== 'ollama') continue;
		const model = getOllamaModelForRole(settings, role);
		const host = remoteHostForModel(model);
		if (!host || seen.has(model)) continue;
		seen.add(model);
		remote.push({ useCase, model, host });
	}
	return remote;
}

/** The settings keys `selectModelSetting` accepts, without re-deriving its mapped type. */
type ModelSettingKey = Parameters<typeof selectModelSetting>[2];

/** How one use case's picker is wired for one provider. */
interface ModelPickerSpec {
	/** The settings field this provider persists its choice in. */
	setting: ModelSettingKey;
	labelKey: TranslationKey;
	descKey: TranslationKey;
	/**
	 * Label for the "inherit the chat model" option. Only Ollama sets it: it
	 * keeps a single model resident, so an extra per-use-case model costs a swap
	 * on every call (#1077) and inheriting is the default. Providers with
	 * `perUseCaseModels` get a dedicated field and no inherit option.
	 */
	inheritKey?: TranslationKey;
}

/**
 * The text-model pickers, one per use case, as data.
 *
 * Each provider persists its own model per use case — re-routing chat from
 * Gemini to Ollama and back never clobbers the other's choice — so the picker
 * shown depends on the provider currently serving that use case. Keeping the
 * three use cases in one table means adding a provider is a column, not a
 * fourth copy of the same branch.
 *
 * Rewrite and search reuse the chat model, so they get no picker of their own;
 * image generation is handled separately in `renderModelPickers` because it can
 * resolve to no provider at all.
 */
const TEXT_MODEL_PICKERS: ReadonlyArray<{
	useCase: ProviderUseCase;
	byProvider: Record<ModelProvider, ModelPickerSpec>;
}> = [
	{
		useCase: 'chat',
		byProvider: {
			gemini: {
				setting: 'chatModelName',
				labelKey: 'settings.general.chatModelName',
				descKey: 'settings.general.chatModelDesc',
			},
			ollama: {
				setting: 'ollamaModelName',
				labelKey: 'settings.general.ollamaModelName',
				descKey: 'settings.general.ollamaModelDesc',
			},
			openai: {
				setting: 'openaiModelName',
				labelKey: 'settings.general.chatModelName',
				descKey: 'settings.general.openaiChatModelDesc',
			},
		},
	},
	{
		useCase: 'summary',
		byProvider: {
			gemini: {
				setting: 'summaryModelName',
				labelKey: 'settings.general.summaryModelName',
				descKey: 'settings.general.summaryModelDesc',
			},
			ollama: {
				setting: 'ollamaSummaryModelName',
				labelKey: 'settings.general.summaryModelName',
				descKey: 'settings.general.ollamaSummaryModelDesc',
				inheritKey: 'settings.general.inheritOllamaChatModel',
			},
			openai: {
				setting: 'openaiSummaryModelName',
				labelKey: 'settings.general.summaryModelName',
				descKey: 'settings.general.summaryModelDesc',
			},
		},
	},
	{
		useCase: 'completions',
		byProvider: {
			gemini: {
				setting: 'completionsModelName',
				labelKey: 'settings.general.completionModelName',
				descKey: 'settings.general.completionModelDesc',
			},
			ollama: {
				setting: 'ollamaCompletionsModelName',
				labelKey: 'settings.general.completionModelName',
				descKey: 'settings.general.ollamaCompletionsModelDesc',
				inheritKey: 'settings.general.inheritOllamaChatModel',
			},
			openai: {
				setting: 'openaiCompletionsModelName',
				labelKey: 'settings.general.completionModelName',
				descKey: 'settings.general.completionModelDesc',
			},
		},
	},
];

/**
 * Model pickers, one per use case that has a configured model, each filtered to
 * the provider actually serving it.
 */
async function renderModelPickers(sectionEl: HTMLElement, plugin: ObsidianGemini): Promise<void> {
	for (const { useCase, byProvider } of TEXT_MODEL_PICKERS) {
		// Total lookup: `resolveProviderOrDefault` only ever returns a registered
		// provider id, so every branch of the union has a spec above.
		const provider = resolveProviderOrDefault(plugin.settings, useCase);
		const spec = byProvider[provider];
		await selectModelSetting(
			sectionEl,
			plugin,
			spec.setting,
			t(spec.labelKey),
			t(spec.descKey),
			'text',
			provider,
			spec.inheritKey ? t(spec.inheritKey) : undefined
		);
	}

	// Image generation has no model to pick when no provider serves it.
	const imageProvider = resolveProvider(plugin.settings, 'imageGen');
	if (imageProvider) {
		await selectModelSetting(
			sectionEl,
			plugin,
			'imageModelName',
			t('settings.general.imageModelName'),
			t('settings.general.imageModelDesc'),
			'image',
			imageProvider
		);
	}
}

/**
 * Trigger a Gemini model-list refresh and surface the outcome via `Notice`.
 * Shared between the settings button and the command-palette entry so both
 * paths report the same skip/error/success messages.
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
