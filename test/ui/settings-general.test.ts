/**
 * Regression tests for provider-specific model-picker rendering in the General
 * settings section (issues #1077, #704).
 *
 * Each picker is bound to the settings field and filtered to the models of the
 * provider that its own use case resolves to, so a mixed configuration shows
 * the right models in every row. Ollama's summary/completions pickers default
 * to inheriting the chat model (#1077); image generation has no picker at all
 * when no provider serves it.
 */
const { mockSelectModelSetting, capturedDropdowns } = vi.hoisted(() => ({
	mockSelectModelSetting: vi.fn(),
	// Records each rendered dropdown as { name, options, value, disabled } so
	// tests can assert on the options a row actually offers.
	capturedDropdowns: [] as Array<{ name: string; options: string[]; value: string; disabled: boolean }>,
}));

vi.mock('../../src/ui/settings-helpers', () => ({
	selectModelSetting: mockSelectModelSetting,
	// The General section is rendered directly into the element we pass in.
	createAlwaysOpenSection: (containerEl: any) => containerEl,
	createCollapsibleSection: (_plugin: any, containerEl: any) => containerEl,
	createDebouncedSave: () => () => {},
}));

vi.mock('../../src/ui/folder-suggest', () => ({
	FolderSuggest: vi.fn(),
}));

vi.mock('../../src/i18n', () => ({
	t: (key: string) => key,
}));

vi.mock('../../src/utils/error-utils', () => ({
	getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('obsidian', () => {
	class Setting {
		name = '';
		constructor(public containerEl: any) {}
		setName(n?: string) {
			this.name = n ?? '';
			return this;
		}
		setDesc() {
			return this;
		}
		addButton(cb: (c: any) => void) {
			cb({ setButtonText: () => ({ onClick: () => this }) });
			return this;
		}
		addDropdown(cb: (c: any) => void) {
			const record = { name: this.name, options: [] as string[], value: '', disabled: false };
			const c: any = {};
			c.addOption = (v: string) => {
				record.options.push(v);
				return c;
			};
			c.setValue = (v: string) => {
				record.value = v;
				return c;
			};
			c.setDisabled = (d: boolean) => {
				record.disabled = d !== false;
				return c;
			};
			c.onChange = () => c;
			cb(c);
			capturedDropdowns.push(record);
			return this;
		}
		addText(cb: (c: any) => void) {
			const c: any = {};
			c.setPlaceholder = () => c;
			c.setValue = () => c;
			c.onChange = () => c;
			c.inputEl = {};
			cb(c);
			return this;
		}
		addComponent(cb: (el: any) => void) {
			cb({});
			return this;
		}
		addToggle(cb: (c: any) => void) {
			const c: any = {};
			c.setValue = () => c;
			c.onChange = () => c;
			cb(c);
			return this;
		}
	}
	class SecretComponent {
		constructor(_app: any, _el: any) {}
		setValue() {
			return this;
		}
		onChange() {
			return this;
		}
	}
	return {
		Setting,
		SecretComponent,
		Notice: vi.fn(),
		debounce: (fn: any) => fn,
		App: class {},
	};
});

import { renderGeneralSettings } from '../../src/ui/settings-general';

function createMockPlugin(provider: 'gemini' | 'ollama', providerOverrides: Record<string, string> = {}) {
	return {
		settings: {
			provider,
			providerOverrides,
			chatModelName: 'chat-model',
			summaryModelName: 'summary-model',
			completionsModelName: 'completions-model',
			imageModelName: 'image-model',
			ollamaModelName: 'ollama-model',
			ollamaSummaryModelName: '',
			ollamaCompletionsModelName: '',
			ollamaBaseUrl: 'http://localhost:11434',
			apiKeySecretName: 'test-secret',
			historyFolder: 'gemini-scribe',
			expandedSettingsSections: [],
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		getModelManager: vi.fn(),
	} as any;
}

function createContext() {
	return {
		redisplay: vi.fn(),
		showDeveloperSettings: false,
		setShowDeveloperSettings: vi.fn(),
	};
}

// selectModelSetting(containerEl, plugin, settingName, label, description, role?, provider?).
// Capture the settingName (arg 2), the label/description i18n keys (args 3/4), and
// the provider the dropdown is filtered to (arg 6) — a picker wired to the wrong
// i18n key or offering another provider's models is caught, not just the wrong
// setting. `t()` is mocked to echo its key, so label/desc are the raw key strings.
function renderedModelCalls(): Array<{ settingName: string; label: string; desc: string; provider: string }> {
	return mockSelectModelSetting.mock.calls.map((call) => ({
		settingName: call[2],
		label: call[3],
		desc: call[4],
		provider: call[6],
	}));
}

describe('renderGeneralSettings — model pickers per provider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedDropdowns.length = 0;
	});

	const dropdownFor = (name: string) => capturedDropdowns.find((d) => d.name === name);

	it('routes every picker to Ollama, with summary/completions inheriting the chat model', async () => {
		const plugin = createMockPlugin('ollama');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		// No image picker: nothing serves imageGen in a local-only configuration.
		expect(renderedModelCalls()).toEqual([
			{
				settingName: 'ollamaModelName',
				label: 'settings.general.ollamaModelName',
				desc: 'settings.general.ollamaModelDesc',
				provider: 'ollama',
			},
			{
				settingName: 'ollamaSummaryModelName',
				label: 'settings.general.summaryModelName',
				desc: 'settings.general.ollamaSummaryModelDesc',
				provider: 'ollama',
			},
			{
				settingName: 'ollamaCompletionsModelName',
				label: 'settings.general.completionModelName',
				desc: 'settings.general.ollamaCompletionsModelDesc',
				provider: 'ollama',
			},
		]);
	});

	it('renders all four independent pickers with their own labels/descriptions under Gemini', async () => {
		const plugin = createMockPlugin('gemini');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(renderedModelCalls()).toEqual([
			{
				settingName: 'chatModelName',
				label: 'settings.general.chatModelName',
				desc: 'settings.general.chatModelDesc',
				provider: 'gemini',
			},
			{
				settingName: 'summaryModelName',
				label: 'settings.general.summaryModelName',
				desc: 'settings.general.summaryModelDesc',
				provider: 'gemini',
			},
			{
				settingName: 'completionsModelName',
				label: 'settings.general.completionModelName',
				desc: 'settings.general.completionModelDesc',
				provider: 'gemini',
			},
			{
				settingName: 'imageModelName',
				label: 'settings.general.imageModelName',
				desc: 'settings.general.imageModelDesc',
				provider: 'gemini',
			},
		]);
	});

	// The point of #704: each row follows its own use case's provider.
	it('binds each picker to its own use case provider in a mixed configuration', async () => {
		const plugin = createMockPlugin('ollama', { summary: 'gemini', imageGen: 'gemini' });
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(renderedModelCalls()).toEqual([
			{
				settingName: 'ollamaModelName',
				label: 'settings.general.ollamaModelName',
				desc: 'settings.general.ollamaModelDesc',
				provider: 'ollama',
			},
			// Summary is overridden to Gemini, so it gets the Gemini field and list.
			{
				settingName: 'summaryModelName',
				label: 'settings.general.summaryModelName',
				desc: 'settings.general.summaryModelDesc',
				provider: 'gemini',
			},
			{
				settingName: 'ollamaCompletionsModelName',
				label: 'settings.general.completionModelName',
				desc: 'settings.general.ollamaCompletionsModelDesc',
				provider: 'ollama',
			},
			// Image generation only appears once a provider is routed to it.
			{
				settingName: 'imageModelName',
				label: 'settings.general.imageModelName',
				desc: 'settings.general.imageModelDesc',
				provider: 'gemini',
			},
		]);
	});
});

describe('renderGeneralSettings — per-feature provider dropdowns', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedDropdowns.length = 0;
	});

	const dropdownFor = (name: string) => capturedDropdowns.find((d) => d.name === name);

	// The default option already means "use the primary", so listing the primary
	// again showed the same provider label twice and let the user persist an
	// override equal to the primary — inert, but it defeats the sparse-override
	// design (#1266 review).
	it('offers the primary only once, via the default option', async () => {
		const plugin = createMockPlugin('gemini');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		const chat = dropdownFor('settings.general.useCaseChatName');
		expect(chat?.options).toEqual(['', 'ollama']);
		expect(chat?.disabled).toBe(false);
	});

	it('disables a row whose only candidate is the primary', async () => {
		const plugin = createMockPlugin('gemini');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		// Gemini is the only provider that serves image generation.
		const imageGen = dropdownFor('settings.general.useCaseImageGenName');
		expect(imageGen?.options).toEqual(['']);
		expect(imageGen?.disabled).toBe(true);
	});

	it('offers a capability-gated provider when the primary cannot serve it', async () => {
		const plugin = createMockPlugin('ollama');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		const imageGen = dropdownFor('settings.general.useCaseImageGenName');
		expect(imageGen?.options).toEqual(['', 'gemini']);
		expect(imageGen?.disabled).toBe(false);
	});

	it('selects an override that differs from the primary', async () => {
		const plugin = createMockPlugin('ollama', { imageGen: 'gemini' });
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(dropdownFor('settings.general.useCaseImageGenName')?.value).toBe('gemini');
	});

	// A stored value with no matching option would render the row blank, which
	// reads as broken. Both cases fall back to the default option instead.
	it('falls back to the default option for an override equal to the primary', async () => {
		const plugin = createMockPlugin('gemini', { chat: 'gemini' });
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(dropdownFor('settings.general.useCaseChatName')?.value).toBe('');
	});
});
