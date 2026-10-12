/**
 * The Features page's model row: a `render` row whose button opens the shared
 * fuzzy-search picker and writes the pick through the tab's control writer.
 */
import type { App, Setting, SettingDefinitionItem, SettingDefinitionRender, SettingGroup } from 'obsidian';
import { featuresPage } from '../../../src/ui/settings/page-features';
import type { SettingsContext } from '../../../src/ui/settings/context';
import { ModelPickerModal } from '../../../src/ui/components/model-picker-modal';
import { GEMINI_MODELS, setGeminiModels, type GeminiModel } from '../../../src/models';
import type { FeatureRoutes } from '../../../src/types/features';
import { buildApp, buildPlugin } from './fixtures';

const MODELS: GeminiModel[] = [
	{ value: 'zeta/model', label: 'zeta/model', provider: 'openai', defaultForRoles: ['chat'] },
	{ value: 'alpha/model', label: 'alpha/model', provider: 'openai' },
];

function buildCtx(chat: FeatureRoutes['chat']) {
	const plugin = buildPlugin({ openaiApiKeySecretName: 'openai-key' });
	plugin.settings.features.chat = chat;
	const tab = { update: vi.fn(), refreshDomState: vi.fn(), setControlValue: vi.fn(async () => {}) };
	const ctx: SettingsContext = { plugin, app: buildApp() as unknown as App, tab };
	return { ctx, tab };
}

function chatModelRow(ctx: SettingsContext): SettingDefinitionRender {
	const groups = featuresPage(ctx).items as { items?: SettingDefinitionItem[] }[];
	const chatPage = groups
		.flatMap((g) => g.items ?? [])
		.find((i) => (i as { name?: string }).name === 'Chat and agent') as { items: SettingDefinitionItem[] };
	return chatPage.items.find((i) => (i as { name?: string }).name === 'Model') as SettingDefinitionRender;
}

/** Renders the row against a stand-in `Setting`, returning what it set and the button's click handler. */
function renderRow(row: SettingDefinitionRender) {
	const state = { text: '', desc: '', click: () => {} };
	const button = {
		buttonEl: { addClass: vi.fn() },
		setButtonText(text: string) {
			state.text = text;
			return button;
		},
		onClick(cb: () => void) {
			state.click = cb;
			return button;
		},
	};
	const setting = {
		setDesc(desc: string) {
			state.desc = desc;
			return setting;
		},
		addButton(cb: (b: typeof button) => void) {
			cb(button);
			return setting;
		},
	};
	row.render(setting as unknown as Setting, {} as SettingGroup);
	return state;
}

describe('Features page model row', () => {
	let previous: GeminiModel[];
	beforeEach(() => {
		previous = [...GEMINI_MODELS];
		setGeminiModels(MODELS);
	});
	afterEach(() => {
		setGeminiModels(previous);
		vi.restoreAllMocks();
	});

	it('is a render row, hidden while the feature is off', () => {
		const { ctx } = buildCtx({ provider: 'none', model: '' });
		const row = chatModelRow(ctx);

		expect(row.control).toBeUndefined();
		expect((row.visible as () => boolean)()).toBe(false);
	});

	it('shows the current model on the button and opens a sorted picker', () => {
		const open = vi.spyOn(ModelPickerModal.prototype, 'open').mockImplementation(function (this: ModelPickerModal) {
			expect(this.getItems().map((o) => o.value)).toEqual(['', 'alpha/model', 'zeta/model']);
			expect(this.getItems()[0].label).toBe('Default (zeta/model)');
		});
		const { ctx } = buildCtx({ provider: 'openai', model: 'alpha/model' });
		const state = renderRow(chatModelRow(ctx));

		expect(state.text).toBe('alpha/model');
		expect(state.desc).toBe('');
		state.click();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('writes the pick through the tab writer and updates the button', async () => {
		vi.spyOn(ModelPickerModal.prototype, 'open').mockImplementation(function (this: ModelPickerModal) {
			this.onChooseItem({ value: 'zeta/model', label: 'zeta/model' }, new MouseEvent('click'));
		});
		const { ctx, tab } = buildCtx({ provider: 'openai', model: '' });
		const state = renderRow(chatModelRow(ctx));

		expect(state.text).toBe('Default (zeta/model)');
		state.click();
		expect(state.text).toBe('zeta/model');
		expect(tab.setControlValue).toHaveBeenCalledWith('features.chat.model', 'zeta/model');
		await vi.waitFor(() => expect(tab.update).toHaveBeenCalled());
	});

	it('flags a stored model that fell out of the provider list', () => {
		const { ctx } = buildCtx({ provider: 'openai', model: 'gone/model' });
		const state = renderRow(chatModelRow(ctx));

		expect(state.text).toBe('gone/model (No longer available)');
		expect(state.desc).toContain('gone/model is no longer available');
	});
});
