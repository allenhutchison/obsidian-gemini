import ObsidianGemini, { ObsidianGeminiSettings } from '../src/main';
import { routingKey } from '../src/api/feature-routing';
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
			const secrets = new Map<string, string>([
				['gemini-key', 'test-key'],
				['openai-key', 'sk-test'],
			]);
			const app = {
				workspace: { layoutReady: false, onLayoutReady: vi.fn() },
				secretStorage: {
					getSecret: (id: string) => secrets.get(id) ?? null,
					setSecret: (id: string, value: string) => {
						secrets.set(id, value);
					},
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
				// The base-URL defaults from DEFAULT_SETTINGS: without them the
				// customBaseUrlChanged comparison sees undefined and fires a phantom
				// provider change on the first save.
				ollamaBaseUrl: 'http://localhost:11434',
				customBaseUrl: '',
				openaiBaseUrl: 'https://api.openai.com/v1',
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

		it('does not treat a folder delta as a rename before a successful init (#1553 review)', async () => {
			// No credentials: needsInit is false, so nothing else may trigger setup.
			const { plugin, setup } = makeSaveablePlugin({ apiKeySecretName: '' });
			const internal = plugin as unknown as {
				isGeminiInitialized: boolean;
				previousHistoryFolder: string;
				previousRoutingKey: string;
			};
			// Never initialized: previousHistoryFolder is still ''. Without the
			// gate, the ''-vs-'gemini-scribe' delta would be true on every save
			// of any setting, re-running a setup that already failed for lack of
			// credentials. previousRoutingKey is pinned to the current routing so
			// the phantom-provider-change condition (an uninitialized plugin
			// snapshots nothing — fixed for all conditions in #1554) doesn't
			// fire first and mask the gate under test.
			internal.isGeminiInitialized = false;
			internal.previousHistoryFolder = '';
			internal.previousRoutingKey = routingKey(plugin.settings);

			await plugin.saveSettings();

			expect(setup).not.toHaveBeenCalled();
		});

		// #1554: every change condition is gated on isGeminiInitialized, so a
		// vault that has never initialized successfully re-runs setup() only
		// via needsInit — never from a phantom previous*-baseline delta.
		it('does not re-run setup on unrelated saves while uninitialized (#1554)', async () => {
			// No credentials: needsInit is false, and every previous* baseline is
			// at its initial value. Before the gate, the phantom provider-change
			// (previousRoutingKey '' vs a valid routing key) fired setup() on
			// every save of any setting.
			const { plugin, setup } = makeSaveablePlugin({ apiKeySecretName: '' });
			const internal = plugin as unknown as { isGeminiInitialized: boolean };

			await plugin.saveSettings();
			expect(setup).not.toHaveBeenCalled();

			// A second unrelated save — e.g. the user edits an unrelated toggle —
			// behaves the same: no doomed setup re-run.
			await plugin.saveSettings();
			expect(setup).not.toHaveBeenCalled();
		});

		it('recovers from missing credentials only once they are added (#1555 review)', async () => {
			// Real journey: setup failed at load for lack of a key. An unrelated
			// save must not retry; adding the credential must.
			const noKey = makeSaveablePlugin({ apiKeySecretName: '' });
			const internal = noKey.plugin as unknown as {
				isGeminiInitialized: boolean;
				previousApiKey: string;
				previousRoutingKey: string;
				previousHistoryFolder: string;
				lastInitAttemptFingerprint: string | null;
			};
			// Simulate the failed onload attempt recording its eligibility.
			internal.isGeminiInitialized = false;
			internal.lastInitAttemptFingerprint = 'gemini:keyless-blocked';

			// Unrelated save with the credential still missing — no retry.
			await noKey.plugin.saveSettings();
			expect(noKey.setup).not.toHaveBeenCalled();

			// The user adds a credential and saves again — needsInit fires.
			noKey.plugin.settings.apiKeySecretName = 'gemini-key';
			await noKey.plugin.saveSettings();
			expect(noKey.setup).toHaveBeenCalledTimes(1);
			expect(internal.isGeminiInitialized).toBe(true);
			expect(internal.previousApiKey).toBe('test-key');
		});

		it('does not retry a failed setup on unrelated saves when eligibility is unchanged (#1555 review)', async () => {
			// Keyless provider: hasCredentials stays true, so the failed attempt
			// is recorded with that eligibility. Unrelated saves must not retry
			// setup just because the flag is still false — the fingerprint
			// guards it.
			const { plugin, setup } = makeSaveablePlugin({ apiKeySecretName: '' });
			plugin.settings.features.chat = { provider: 'ollama', model: '' };
			const internal = plugin as unknown as {
				isGeminiInitialized: boolean;
				lastInitAttemptFingerprint: string | null;
			};
			// Simulate the failed onload attempt recording its eligibility, the
			// same string the fingerprint helper produces for these settings.
			internal.isGeminiInitialized = false;
			internal.lastInitAttemptFingerprint = 'ollama:none-required:http://localhost:11434';

			await plugin.saveSettings();
			expect(setup).not.toHaveBeenCalled();

			// Still no retry on a further unrelated save.
			await plugin.saveSettings();
			expect(setup).not.toHaveBeenCalled();

			// Switching chat to a provider whose eligibility differs retries:
			// openai with a key present is credentialed, unlike gemini keyless.
			plugin.settings.features.chat = { provider: 'openai', model: '' };
			plugin.settings.openaiApiKeySecretName = 'openai-key';
			await plugin.saveSettings();
			expect(setup).toHaveBeenCalledTimes(1);
		});

		it('retries when a rejected credential is replaced (#1555 review round 3)', async () => {
			// A wrong-but-present key keeps hasCredentials true, so only the
			// credential token distinguishes the failed attempt from the fixed
			// one. Replacing the key must change the fingerprint and retry.
			const { plugin, setup } = makeSaveablePlugin();
			const internal = plugin as unknown as {
				isGeminiInitialized: boolean;
				lastInitAttemptFingerprint: string | null;
				recordInitAttemptFingerprint(): void;
			};
			// Failed onload with the (bad) credential recorded: swap the stored
			// value for a wrong one, record, then let the unrelated save pass.
			plugin.app.secretStorage.setSecret('gemini-key', 'wrong-key');
			internal.isGeminiInitialized = false;
			internal.recordInitAttemptFingerprint();

			// Unrelated save with the same bad key — no retry.
			await plugin.saveSettings();
			expect(setup).not.toHaveBeenCalled();

			// The user replaces the key in secret storage and saves — retry.
			plugin.app.secretStorage.setSecret('gemini-key', 'test-key');
			await plugin.saveSettings();
			expect(setup).toHaveBeenCalledTimes(1);
		});

		it('retries when the active chat provider base URL is corrected (#1555 review round 3)', async () => {
			// Setup failed against an unreachable Ollama server; fixing the URL
			// must change the fingerprint and retry, even though URL change
			// detection is gated off while uninitialized.
			const { plugin, setup } = makeSaveablePlugin({ apiKeySecretName: '' });
			plugin.settings.features.chat = { provider: 'ollama', model: '' };
			const internal = plugin as unknown as {
				isGeminiInitialized: boolean;
				lastInitAttemptFingerprint: string | null;
				recordInitAttemptFingerprint(): void;
			};
			// Failed onload against the default (unreachable in the scenario) URL.
			internal.isGeminiInitialized = false;
			internal.recordInitAttemptFingerprint();

			// Unrelated save — no retry.
			await plugin.saveSettings();
			expect(setup).not.toHaveBeenCalled();

			// The user corrects the base URL and saves — retry.
			plugin.settings.ollamaBaseUrl = 'http://localhost:11500';
			await plugin.saveSettings();
			expect(setup).toHaveBeenCalledTimes(1);
		});

		it('does not re-run setup while uninitialized even when the routing key changes', async () => {
			// The user rearranges routing before any init succeeded. Without
			// credentials nothing can initialize, so setup() must not run — the
			// save that eventually works is caught by needsInit.
			const { plugin, setup } = makeSaveablePlugin({ apiKeySecretName: '' });
			const internal = plugin as unknown as { isGeminiInitialized: boolean };
			internal.isGeminiInitialized = false;
			plugin.settings.features.chat = { provider: 'ollama', model: '' };

			await plugin.saveSettings();

			// needsInit: chat routed to ollama requires no key, so this DOES fire.
			expect(setup).toHaveBeenCalledTimes(1);
			expect((plugin as unknown as { isGeminiInitialized: boolean }).isGeminiInitialized).toBe(true);
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
