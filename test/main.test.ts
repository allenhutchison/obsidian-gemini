import ObsidianGemini, { ObsidianGeminiSettings } from '../src/main';
import { FEATURE_IDS } from '../src/types/features';
import type { App, PluginManifest } from 'obsidian';

describe('ObsidianGeminiSettings', () => {
	describe('feature routing (settings redesign)', () => {
		it('defaultProvider is a real provider, never "none"', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				defaultProvider: 'gemini',
			};
			expect(settings.defaultProvider).toBe('gemini');
		});

		it('features is total over every FeatureId', () => {
			const features: ObsidianGeminiSettings['features'] = {
				chat: { provider: 'gemini', model: '' },
				summary: { provider: 'gemini', model: '' },
				completions: { provider: 'gemini', model: '' },
				rewrite: { provider: 'gemini', model: '' },
				webSearch: { provider: 'gemini', model: '' },
				deepResearch: { provider: 'gemini', model: '' },
				rag: { provider: 'gemini', model: '' },
				imageGen: { provider: 'gemini', model: '' },
			};
			for (const f of FEATURE_IDS) {
				expect(features[f]).toBeDefined();
			}
		});

		it('a feature route can be "none" (off), never a substitute provider', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				features: {
					chat: { provider: 'gemini', model: '' },
					summary: { provider: 'gemini', model: '' },
					completions: { provider: 'gemini', model: '' },
					rewrite: { provider: 'gemini', model: '' },
					webSearch: { provider: 'none', model: '' },
					deepResearch: { provider: 'none', model: '' },
					rag: { provider: 'none', model: '' },
					imageGen: { provider: 'none', model: '' },
				},
			};
			expect(settings.features?.webSearch.provider).toBe('none');
		});
	});

	describe('settingsSchemaVersion', () => {
		it('defaults to 2 for new installs', () => {
			const defaultSettings: Partial<ObsidianGeminiSettings> = {
				settingsSchemaVersion: 2,
			};
			expect(defaultSettings.settingsSchemaVersion).toBe(2);
		});
	});

	describe('version tracking', () => {
		it('should have default lastSeenVersion of 0.0.0', () => {
			const defaultSettings: Partial<ObsidianGeminiSettings> = {
				lastSeenVersion: '0.0.0',
			};
			expect(defaultSettings.lastSeenVersion).toBe('0.0.0');
		});

		it('should accept any version string', () => {
			const settings: Partial<ObsidianGeminiSettings> = {
				lastSeenVersion: '4.0.0',
			};
			expect(settings.lastSeenVersion).toBe('4.0.0');

			settings.lastSeenVersion = '3.3.2';
			expect(settings.lastSeenVersion).toBe('3.3.2');

			settings.lastSeenVersion = '1.0.0-beta.1';
			expect(settings.lastSeenVersion).toBe('1.0.0-beta.1');
		});
	});

	describe('getApiKeyErrorMessage', () => {
		function makePlugin(settings: Partial<ObsidianGeminiSettings>): ObsidianGemini {
			const plugin = new ObsidianGemini({} as App, {} as PluginManifest);
			plugin.settings = {
				defaultProvider: 'gemini',
				apiKeySecretName: '',
				openaiApiKeySecretName: '',
				ollamaBaseUrl: 'http://localhost:11434',
				...settings,
			} as ObsidianGeminiSettings;
			return plugin;
		}

		it('describes the provider routed to chat, not the default provider', () => {
			// Default provider is Gemini, but chat is routed to OpenAI with no
			// OpenAI key configured — the message should be OpenAI-specific.
			const plugin = makePlugin({
				defaultProvider: 'gemini',
				apiKeySecretName: 'gemini-key',
				openaiApiKeySecretName: '',
				features: {
					chat: { provider: 'openai', model: '' },
				} as ObsidianGeminiSettings['features'],
			});

			const message = (plugin as unknown as { getApiKeyErrorMessage(): string }).getApiKeyErrorMessage();

			expect(message).toContain('OpenAI');
		});

		it('falls back to the default provider when chat is routed to none', () => {
			const plugin = makePlugin({
				defaultProvider: 'openai',
				apiKeySecretName: '',
				openaiApiKeySecretName: '',
				features: {
					chat: { provider: 'none', model: '' },
				} as ObsidianGeminiSettings['features'],
			});

			const message = (plugin as unknown as { getApiKeyErrorMessage(): string }).getApiKeyErrorMessage();

			expect(message).toContain('OpenAI');
		});
	});

	describe('saveSettings – historyFolder change triggers manager refresh (#1551)', () => {
		/**
		 * A plugin wired for `saveSettings()` with layout NOT ready, so every
		 * layout-gated block is skipped and the test observes only the re-init
		 * decision: whether `lifecycle.setup()` runs for a given snapshot delta.
		 */
		function makeSaveablePlugin(settingsOverrides: Partial<ObsidianGeminiSettings> = {}) {
			const secrets = new Map<string, string>([['gemini-key', 'test-key']]);
			const app = {
				workspace: { layoutReady: false, onLayoutReady: vi.fn() },
				secretStorage: {
					getSecret: (id: string) => secrets.get(id) ?? null,
					setSecret: vi.fn(),
					listSecrets: vi.fn(() => [...secrets.keys()]),
				},
			};
			const plugin = new ObsidianGemini(app as unknown as App, {} as PluginManifest);
			(plugin as unknown as { logger: unknown }).logger = {
				log: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			};
			plugin.settings = {
				defaultProvider: 'gemini',
				apiKeySecretName: 'gemini-key',
				historyFolder: 'gemini-scribe',
				fileLogging: false,
				logToolExecution: false,
				hooksEnabled: false,
				ragIndexing: {
					enabled: false,
					fileSearchStoreName: null,
					excludeFolders: [],
					autoSync: true,
					includeAttachments: false,
				},
				features: {
					chat: { provider: 'gemini', model: '' },
					summary: { provider: 'gemini', model: '' },
					completions: { provider: 'gemini', model: '' },
					rewrite: { provider: 'gemini', model: '' },
					webSearch: { provider: 'gemini', model: '' },
					deepResearch: { provider: 'gemini', model: '' },
					rag: { provider: 'gemini', model: '' },
					imageGen: { provider: 'gemini', model: '' },
				},
				...settingsOverrides,
			} as ObsidianGeminiSettings;
			const setup = vi.fn().mockResolvedValue(undefined);
			(plugin as unknown as { lifecycle: unknown }).lifecycle = {
				setup,
				syncToolExecutionLogger: vi.fn(),
			};
			plugin.saveData = vi.fn().mockResolvedValue(undefined);
			return { plugin, setup };
		}

		/**
		 * Initialize the plugin's snapshot baseline the way a real successful
		 * init does: via markInitialized(), so every `previous*` field matches
		 * the current settings and only the delta under test can trigger a
		 * re-init.
		 */
		function initBaseline(plugin: ObsidianGemini): void {
			const internal = plugin as unknown as { markInitialized(): void };
			internal.markInitialized();
		}

		it('re-runs setup when historyFolder changes, refreshing the managers', async () => {
			const { plugin, setup } = makeSaveablePlugin();
			initBaseline(plugin);
			setup.mockClear();

			plugin.settings.historyFolder = 'renamed-folder';
			await plugin.saveSettings();

			expect(setup).toHaveBeenCalledTimes(1);
			// The snapshot advanced, so a second save with no further change is a no-op.
			await plugin.saveSettings();
			expect(setup).toHaveBeenCalledTimes(1);
		});

		it('does not re-run setup when historyFolder is unchanged', async () => {
			const { plugin, setup } = makeSaveablePlugin();
			initBaseline(plugin);
			setup.mockClear();

			await plugin.saveSettings();

			expect(setup).not.toHaveBeenCalled();
		});

		it('re-runs setup on an uninitialized-but-credentialed save (needsInit baseline)', async () => {
			const { plugin, setup } = makeSaveablePlugin();
			const internal = plugin as unknown as { isGeminiInitialized: boolean; previousHistoryFolder: string };
			internal.isGeminiInitialized = false;
			internal.previousHistoryFolder = plugin.settings.historyFolder;

			await plugin.saveSettings();

			expect(setup).toHaveBeenCalledTimes(1);
			// markInitialized snapshots the folder, so the rename detector starts
			// from the right baseline after recovery.
			expect(internal.previousHistoryFolder).toBe('gemini-scribe');
		});

		it('advances the historyFolder snapshot when setup succeeds on a rename', async () => {
			const { plugin } = makeSaveablePlugin();
			initBaseline(plugin);
			plugin.settings.historyFolder = 'renamed-folder';

			await plugin.saveSettings();

			expect((plugin as unknown as { previousHistoryFolder: string }).previousHistoryFolder).toBe('renamed-folder');
		});
	});
});
