/**
 * Regression tests for provider-specific model-picker rendering in the General
 * settings section (issue #1077).
 *
 * Under Ollama a single model applies to every use case, so only one model
 * picker (bound to chatModelName) is shown; the summary / completions / image
 * pickers are hidden. Gemini keeps all four independent pickers.
 */
const { mockSelectModelSetting } = vi.hoisted(() => ({
	mockSelectModelSetting: vi.fn(),
}));

vi.mock('../../src/ui/settings-helpers', () => ({
	selectModelSetting: mockSelectModelSetting,
	// The General section is rendered directly into the element we pass in.
	createAlwaysOpenSection: (containerEl: any) => containerEl,
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
		constructor(public containerEl: any) {}
		setName() {
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
			const c: any = {};
			c.addOption = () => c;
			c.setValue = () => c;
			c.onChange = () => c;
			cb(c);
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

function createMockPlugin(provider: 'gemini' | 'ollama') {
	return {
		settings: {
			provider,
			chatModelName: 'chat-model',
			summaryModelName: 'summary-model',
			completionsModelName: 'completions-model',
			imageModelName: 'image-model',
			ollamaBaseUrl: 'http://localhost:11434',
			apiKeySecretName: 'test-secret',
			historyFolder: 'gemini-scribe',
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

// selectModelSetting(containerEl, plugin, settingName, label, description, role?).
// Capture the settingName (arg 2) plus the label/description i18n keys (args 3/4)
// so a picker wired to the wrong i18n key is caught, not just the wrong setting.
// `t()` is mocked to echo its key, so label/desc are the raw key strings.
function renderedModelCalls(): Array<{ settingName: string; label: string; desc: string }> {
	return mockSelectModelSetting.mock.calls.map((call) => ({
		settingName: call[2],
		label: call[3],
		desc: call[4],
	}));
}

describe('renderGeneralSettings — model pickers per provider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders a single ollamaModelName picker with the Ollama label/description under Ollama', async () => {
		const plugin = createMockPlugin('ollama');
		await renderGeneralSettings({} as any, plugin, {} as any, createContext());

		expect(renderedModelCalls()).toEqual([
			{
				settingName: 'ollamaModelName',
				label: 'settings.general.ollamaModelName',
				desc: 'settings.general.ollamaModelDesc',
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
			},
			{
				settingName: 'summaryModelName',
				label: 'settings.general.summaryModelName',
				desc: 'settings.general.summaryModelDesc',
			},
			{
				settingName: 'completionsModelName',
				label: 'settings.general.completionModelName',
				desc: 'settings.general.completionModelDesc',
			},
			{
				settingName: 'imageModelName',
				label: 'settings.general.imageModelName',
				desc: 'settings.general.imageModelDesc',
			},
		]);
	});
});
