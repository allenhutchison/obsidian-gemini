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
const { mockSelectModelSetting, capturedDropdowns, capturedRows, capturedButtons, capturedSecrets } = vi.hoisted(
	() => ({
		mockSelectModelSetting: vi.fn(),
		// Records each rendered dropdown as { name, options, value, disabled } so
		// tests can assert on the options a row actually offers.
		capturedDropdowns: [] as Array<{ name: string; options: string[]; value: string; disabled: boolean }>,
		// Records every rendered Setting row's name/description i18n key, so the
		// privacy notices (which render as plain name+desc rows) can be asserted on.
		capturedRows: [] as Array<{ name: string; desc: string }>,
		// Records each rendered button as { name, text, onClick } so tests can
		// invoke the handler directly (e.g. the refresh-model-list buttons).
		capturedButtons: [] as Array<{ name: string; text: string; onClick: () => void | Promise<void> }>,
		// Records each rendered SecretComponent as { value, onChange } so tests can
		// assert which settings field an API key row is bound to.
		capturedSecrets: [] as Array<{ value: string; onChange?: (v: string) => void }>,
	})
);

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

// Echo the key, appending interpolation vars so tests can assert on which
// models/hosts a notice actually names, not just that a notice appeared.
vi.mock('../../src/i18n', () => ({
	t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));

vi.mock('../../src/utils/error-utils', () => ({
	getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('obsidian', () => {
	class Setting {
		name = '';
		private row: { name: string; desc: string };
		constructor(public containerEl: any) {
			this.row = { name: '', desc: '' };
			capturedRows.push(this.row);
		}
		setName(n?: string) {
			this.name = n ?? '';
			this.row.name = this.name;
			return this;
		}
		setDesc(d?: string) {
			this.row.desc = d ?? '';
			return this;
		}
		addButton(cb: (c: any) => void) {
			const record = { name: this.name, text: '', onClick: (() => {}) as () => void | Promise<void> };
			const c: any = {};
			c.setButtonText = (text: string) => {
				record.text = text;
				return c;
			};
			c.onClick = (handler: () => void | Promise<void>) => {
				record.onClick = handler;
				return c;
			};
			cb(c);
			capturedButtons.push(record);
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
		private record: { value: string; onChange?: (v: string) => void };
		constructor(_app: any, _el: any) {
			this.record = { value: '' };
			capturedSecrets.push(this.record);
		}
		setValue(v: string) {
			this.record.value = v;
			return this;
		}
		onChange(fn: (v: string) => void) {
			this.record.onChange = fn;
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

function createMockPlugin(provider: 'gemini' | 'ollama' | 'openai', providerOverrides: Record<string, string> = {}) {
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
			openaiModelName: 'openai-chat-model',
			openaiSummaryModelName: 'openai-summary-model',
			openaiCompletionsModelName: 'openai-completions-model',
			openaiBaseUrl: 'https://api.openai.com/v1',
			openaiApiKeySecretName: 'openai-test-secret',
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

	// OpenAI has no single-resident-model constraint (perUseCaseModels), so unlike
	// Ollama each use case gets its own field and no "inherit the chat model"
	// option (#1237).
	it('routes every picker to its own OpenAI field, with no inherit option', async () => {
		const plugin = createMockPlugin('openai');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(renderedModelCalls()).toEqual([
			{
				settingName: 'openaiModelName',
				label: 'settings.general.chatModelName',
				desc: 'settings.general.openaiChatModelDesc',
				provider: 'openai',
			},
			{
				settingName: 'openaiSummaryModelName',
				label: 'settings.general.summaryModelName',
				desc: 'settings.general.summaryModelDesc',
				provider: 'openai',
			},
			{
				settingName: 'openaiCompletionsModelName',
				label: 'settings.general.completionModelName',
				desc: 'settings.general.completionModelDesc',
				provider: 'openai',
			},
		]);
		// No inherit-option arg (7th call arg) for any OpenAI row.
		for (const call of mockSelectModelSetting.mock.calls) {
			expect(call[7]).toBeUndefined();
		}
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
		expect(chat?.options).toEqual(['', 'ollama', 'openai']);
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

/**
 * "Provider: Ollama" stopped implying "runs on this machine" once Ollama shipped
 * cloud models: they appear in /api/tags and go through the local daemon, but
 * inference happens on ollama.com. The local-only reassurance must not be shown
 * in that case — it would be an actively false privacy claim.
 */
describe('renderGeneralSettings — local-only vs cloud-hosted model notice', () => {
	const LOCAL = 'gemma4:12b-mlx';
	const CLOUD = 'deepseek-v4-pro:cloud';
	const CLOUD_COMPLETIONS = 'gpt-oss:120b-cloud';

	let restoreModels: () => void;

	beforeEach(async () => {
		vi.clearAllMocks();
		capturedDropdowns.length = 0;
		capturedRows.length = 0;

		const { setGeminiModels, GEMINI_MODELS } = await import('../../src/models');
		const original = [...GEMINI_MODELS];
		setGeminiModels([
			{ value: LOCAL, label: LOCAL, provider: 'ollama' as const },
			{ value: CLOUD, label: CLOUD, provider: 'ollama' as const, remoteHost: 'https://ollama.com' },
			{
				value: CLOUD_COMPLETIONS,
				label: CLOUD_COMPLETIONS,
				provider: 'ollama' as const,
				remoteHost: 'https://ollama.com',
			},
		]);
		restoreModels = () => setGeminiModels(original);
	});

	afterEach(() => restoreModels());

	const rowNamed = (name: string) => capturedRows.find((r) => r.name === name);
	const REMOTE = 'settings.general.remoteModelNoticeName';
	const LOCAL_ONLY = 'settings.general.localOnlyNoticeName';

	async function renderWith(settings: Record<string, unknown>) {
		const plugin = createMockPlugin('ollama');
		Object.assign(plugin.settings, settings);
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());
		return plugin;
	}

	it('reassures that everything is local when every selected model is local', async () => {
		await renderWith({ ollamaModelName: LOCAL });

		expect(rowNamed(LOCAL_ONLY)).toBeDefined();
		expect(rowNamed(REMOTE)).toBeUndefined();
	});

	it('replaces the reassurance with a warning when the chat model is cloud-hosted', async () => {
		await renderWith({ ollamaModelName: CLOUD });

		expect(rowNamed(LOCAL_ONLY)).toBeUndefined();
		const notice = rowNamed(REMOTE);
		expect(notice?.desc).toContain(CLOUD);
		expect(notice?.desc).toContain('https://ollama.com');
	});

	// Summary/completions default to inheriting the chat model, but a user who
	// opts into a distinct model there can send notes to the cloud via that path
	// alone — the notice has to follow every Ollama-served use case.
	it('warns when only a per-use-case model is cloud-hosted', async () => {
		await renderWith({ ollamaModelName: LOCAL, ollamaCompletionsModelName: CLOUD_COMPLETIONS });

		expect(rowNamed(LOCAL_ONLY)).toBeUndefined();
		expect(rowNamed(REMOTE)?.desc).toContain(CLOUD_COMPLETIONS);
	});

	it('names each distinct cloud model once when several are selected', async () => {
		await renderWith({ ollamaModelName: CLOUD, ollamaCompletionsModelName: CLOUD_COMPLETIONS });

		const desc = rowNamed(REMOTE)?.desc ?? '';
		expect(desc).toContain(CLOUD);
		expect(desc).toContain(CLOUD_COMPLETIONS);
		// The host is shared, so it should not be repeated per model.
		expect(desc.match(/https:\/\/ollama\.com/g)).toHaveLength(1);
	});

	// An inherited cloud model reaches chat, summary and completions alike; the
	// notice should name it once rather than three times.
	it('does not repeat a single inherited cloud model', async () => {
		await renderWith({ ollamaModelName: CLOUD });

		expect(rowNamed(REMOTE)?.desc.match(new RegExp(CLOUD, 'g'))).toHaveLength(1);
	});

	// A model missing from the list (daemon unreachable) can't be shown to be
	// remote, so the existing local-only behaviour stands.
	it('treats an unknown model as local rather than guessing', async () => {
		await renderWith({ ollamaModelName: 'never-registered:latest' });

		expect(rowNamed(LOCAL_ONLY)).toBeDefined();
		expect(rowNamed(REMOTE)).toBeUndefined();
	});

	// A mixed setup already gets the stronger "these features use another
	// provider" warning, which returns before either of these rows.
	it('defers to the mixed-provider notice', async () => {
		const plugin = createMockPlugin('ollama', { imageGen: 'gemini' });
		plugin.settings.ollamaModelName = CLOUD;
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(rowNamed('settings.general.mixedProviderNoticeName')).toBeDefined();
		expect(rowNamed(REMOTE)).toBeUndefined();
		expect(rowNamed(LOCAL_ONLY)).toBeUndefined();
	});
});

/**
 * Credentials/endpoint block for OpenAI (#1237), mirroring the Gemini API key
 * row and the Ollama base-URL/refresh rows.
 */
describe('renderGeneralSettings — OpenAI credentials/endpoint block', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedDropdowns.length = 0;
		capturedRows.length = 0;
		capturedButtons.length = 0;
		capturedSecrets.length = 0;
	});

	const rowNamed = (name: string) => capturedRows.find((r) => r.name === name);
	const API_KEY = 'settings.general.openaiApiKeyName';
	const BASE_URL = 'settings.general.openaiBaseUrlName';
	const REFRESH = 'settings.general.refreshOpenaiModelListName';

	it('renders the API key, base URL, and refresh rows when OpenAI is active', async () => {
		const plugin = createMockPlugin('openai');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(rowNamed(API_KEY)).toBeDefined();
		expect(rowNamed(BASE_URL)).toBeDefined();
		expect(rowNamed(REFRESH)).toBeDefined();
	});

	it('hides the OpenAI block when no use case is routed to OpenAI', async () => {
		const plugin = createMockPlugin('gemini');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(rowNamed(API_KEY)).toBeUndefined();
		expect(rowNamed(BASE_URL)).toBeUndefined();
		expect(rowNamed(REFRESH)).toBeUndefined();
	});

	// Credentials are rendered for every provider serving *some* use case, not
	// just the primary — a Gemini-primary install that overrides summary to
	// OpenAI still needs the OpenAI key field (mirrors #704's rule for Ollama).
	it('shows the OpenAI block when only an override routes a use case to it', async () => {
		const plugin = createMockPlugin('gemini', { summary: 'openai' });
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(rowNamed(API_KEY)).toBeDefined();
	});

	it('binds the API key row to openaiApiKeySecretName, not the Gemini field', async () => {
		const plugin = createMockPlugin('openai');
		plugin.settings.openaiApiKeySecretName = 'my-openai-secret';
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		const secret = capturedSecrets.find((s) => s.value === 'my-openai-secret');
		expect(secret).toBeDefined();

		secret!.onChange!('rotated-secret');
		expect(plugin.settings.openaiApiKeySecretName).toBe('rotated-secret');
		expect(plugin.settings.apiKeySecretName).toBe('test-secret'); // Gemini field untouched.
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it('refresh button invalidates the OpenAI models service and refetches with forceRefresh', async () => {
		const invalidate = vi.fn();
		const getAvailableModels = vi.fn().mockResolvedValue([{ value: 'gpt-5.6', label: 'gpt-5.6' }]);
		const plugin = createMockPlugin('openai');
		plugin.getModelManager = vi.fn().mockReturnValue({
			getOpenAIModelsService: () => ({ invalidate }),
			getAvailableModels,
		});

		// The refresh handler calls back into rerender(), which re-empties and
		// re-renders this section — give the container a working `empty()`.
		await renderGeneralSettings({ empty: () => {} } as any, plugin, {} as any, createContext());

		const button = capturedButtons.find((b) => b.name === REFRESH);
		expect(button).toBeDefined();

		await button!.onClick();

		expect(invalidate).toHaveBeenCalledOnce();
		expect(getAvailableModels).toHaveBeenCalledWith({ forceRefresh: true }, 'openai');
	});
});

/**
 * Regression coverage for the missing-key notice now checking each active
 * provider's own secret field (#1237) instead of assuming Gemini's
 * `apiKeySecretName` — a Gemini key being present must not mask a missing
 * OpenAI key, and vice versa.
 */
describe('renderGeneralSettings — missing-key notice is per-provider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedDropdowns.length = 0;
		capturedRows.length = 0;
	});

	const rowNamed = (name: string) => capturedRows.find((r) => r.name === name);
	const MISSING_KEY = 'settings.general.missingKeyNoticeName';

	it('warns when the OpenAI key is missing even though the unrelated Gemini field is set', async () => {
		const plugin = createMockPlugin('openai');
		plugin.settings.openaiApiKeySecretName = '';
		plugin.settings.apiKeySecretName = 'unrelated-gemini-secret';
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		const notice = rowNamed(MISSING_KEY);
		expect(notice).toBeDefined();
		expect(notice?.desc).toContain('settings.general.providerOptionOpenai');
	});

	it('does not warn once the OpenAI key is configured', async () => {
		const plugin = createMockPlugin('openai');
		plugin.settings.openaiApiKeySecretName = 'configured-secret';
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(rowNamed(MISSING_KEY)).toBeUndefined();
	});
});
