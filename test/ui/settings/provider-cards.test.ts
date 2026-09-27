/**
 * Provider-card model-count probe: a card must never contact a provider that
 * has no credentials (no traffic to providers the user hasn't set up).
 */
import type { App, SettingDefinitionItem, SettingDefinitionPage } from 'obsidian';
import { Notice } from 'obsidian';
import type { Mock } from 'vitest';
import { providerCardPage, PROVIDER_CARDS } from '../../../src/ui/settings/provider-cards';
import { modelCountCache, invalidateModelCount } from '../../../src/ui/settings/model-count-cache';
import type { SettingsContext } from '../../../src/ui/settings/context';
import type { ModelProvider } from '../../../src/api/providers/registry';
import type { ObsidianGeminiSettings } from '../../../src/types/settings';
import { en } from '../../../src/i18n/en';
import { buildPlugin, buildApp } from './fixtures';

function buildCtx(settings: Partial<ObsidianGeminiSettings> = {}) {
	const plugin = buildPlugin(settings);
	const tab = { update: vi.fn(), refreshDomState: vi.fn() };
	const ctx: SettingsContext = { plugin, app: buildApp() as unknown as App, tab };
	const manager = plugin.modelManager as unknown as {
		getProviderModelsService: (p: ModelProvider) => { getModels: Mock };
	};
	const getModels = (id: ModelProvider) => manager.getProviderModelsService(id).getModels;
	return { ctx, tab, getModels };
}

function cardSpec(id: ModelProvider) {
	const spec = PROVIDER_CARDS.find((card) => card.id === id);
	if (!spec) throw new Error(`no card for ${id}`);
	return spec;
}

/** The Models group's single row: count summary + Refresh button. */
function modelsRow(page: SettingDefinitionPage): SettingDefinitionItem & { desc: string } {
	const group = (page.items ?? []).find((item) => (item as { type?: string }).type === 'group') as unknown as {
		items: (SettingDefinitionItem & { desc: string })[];
	};
	return group.items[0];
}

describe('provider card model-count probe', () => {
	beforeEach(() => {
		for (const card of PROVIDER_CARDS) invalidateModelCount(card.id);
		(Notice as unknown as Mock).mockClear();
	});

	it.each(['openai', 'anthropic'] as const)('does not fetch %s models when the provider has no API key', (id) => {
		const { ctx, getModels } = buildCtx();

		const page = providerCardPage(ctx, cardSpec(id));

		expect(getModels(id)).not.toHaveBeenCalled();
		expect(modelsRow(page).desc).toBe(en['settings.providers.statusNeedsKey'].message);
	});

	it('probes a keyed provider when the card renders', async () => {
		const { ctx, getModels, tab } = buildCtx({ openaiApiKeySecretName: 'openai-key' });

		const page = providerCardPage(ctx, cardSpec('openai'));

		expect(modelsRow(page).desc).toBe(en['settings.providers.modelsLoading'].message);
		expect(getModels('openai')).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(tab.update).toHaveBeenCalled());
		expect(modelCountCache.get('openai')).toEqual({ total: 0, cloud: 0 });
	});

	it('still probes a keyless OpenAI-compatible custom endpoint', () => {
		const { ctx, getModels } = buildCtx({ openaiBaseUrl: 'http://localhost:1234/v1' });

		providerCardPage(ctx, cardSpec('openai'));

		expect(getModels('openai')).toHaveBeenCalledTimes(1);
	});

	it('explains a Refresh click on an unconfigured provider instead of fetching', () => {
		const { ctx, getModels } = buildCtx();
		const page = providerCardPage(ctx, cardSpec('anthropic'));
		let onClick: (() => void) | undefined;
		const button = {
			setButtonText: vi.fn(() => button),
			onClick: vi.fn((cb: () => void) => {
				onClick = cb;
				return button;
			}),
		};
		const setting = { addButton: (cb: (b: typeof button) => void) => cb(button) };

		(modelsRow(page) as unknown as { render: (s: typeof setting) => void }).render(setting);
		onClick?.();

		expect(getModels('anthropic')).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Anthropic'));
	});

	it('keeps probing Ollama, which needs no key', () => {
		const { ctx, getModels } = buildCtx();

		providerCardPage(ctx, cardSpec('ollama'));

		expect(getModels('ollama')).toHaveBeenCalledTimes(1);
	});
});
