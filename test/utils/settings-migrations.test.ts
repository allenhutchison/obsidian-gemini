import { migrateToFeatureRouting, normalizeStateFolderPath } from '../../src/utils/settings-migrations';
import { shouldExcludePath } from '../../src/utils/file-utils';
import type { ObsidianGeminiSettings } from '../../src/types/settings';
import type { MCPServerConfig } from '../../src/mcp/types';

/** Minimal settings fixture the function under test reads/writes; cast covers the rest. */
function makeSettings(overrides: Partial<ObsidianGeminiSettings> = {}): ObsidianGeminiSettings {
	return {
		defaultProvider: 'gemini',
		features: {} as ObsidianGeminiSettings['features'],
		providerModelMemory: {},
		mcpServers: [],
		anthropicApiKeySecretName: '',
		settingsSchemaVersion: 1,
		...overrides,
	} as ObsidianGeminiSettings;
}

const REMOVED_KEYS = [
	'provider',
	'providerOverrides',
	'chatModelName',
	'summaryModelName',
	'completionsModelName',
	'imageModelName',
	'ollamaModelName',
	'ollamaSummaryModelName',
	'ollamaCompletionsModelName',
	'openaiModelName',
	'openaiSummaryModelName',
	'openaiCompletionsModelName',
	'maxRetries',
	'initialBackoffDelay',
	'streamingEnabled',
	'useInteractionsApi',
	'useInteractionsApiMigrated',
	'temperature',
	'topP',
	'loopDetectionEnabled',
	'loopDetectionThreshold',
	'loopDetectionTimeWindowSeconds',
	'mcpEnabled',
	'expandedSettingsSections',
] as const;

describe('migrateToFeatureRouting', () => {
	it('migrates a no-overrides Gemini install: every feature on gemini', () => {
		const settings = makeSettings();
		const migrated = migrateToFeatureRouting(settings, { provider: 'gemini' });

		expect(migrated).toBe(true);
		expect(settings.defaultProvider).toBe('gemini');
		for (const f of Object.keys(settings.features) as (keyof typeof settings.features)[]) {
			expect(settings.features[f].provider).toBe('gemini');
		}
	});

	// The B3 regression: an Ollama-primary install with no overrides must land
	// its Gemini-only features on 'none', never silently on 'gemini'.
	it('an Ollama-primary install with no overrides routes cloud-only features to none', () => {
		const settings = makeSettings();
		migrateToFeatureRouting(settings, { provider: 'ollama' });

		expect(settings.features.chat.provider).toBe('ollama');
		expect(settings.features.summary.provider).toBe('ollama');
		expect(settings.features.completions.provider).toBe('ollama');
		expect(settings.features.rewrite.provider).toBe('ollama');
		expect(settings.features.webSearch.provider).toBe('none');
		expect(settings.features.deepResearch.provider).toBe('none');
		expect(settings.features.rag.provider).toBe('none');
		expect(settings.features.imageGen.provider).toBe('none');
	});

	it('resolves ollamaSummaryModelName: "" to inherit ollamaModelName', () => {
		const settings = makeSettings();
		migrateToFeatureRouting(settings, {
			provider: 'ollama',
			ollamaModelName: 'llama3',
			ollamaSummaryModelName: '',
		});

		expect(settings.providerModelMemory.ollama?.summary).toBe('llama3');
		expect(settings.features.summary.model).toBe('llama3');
	});

	it('an explicit webSearch override also routes deepResearch to the same provider', () => {
		const settings = makeSettings();
		migrateToFeatureRouting(settings, {
			provider: 'ollama',
			providerOverrides: { rag: 'gemini', webSearch: 'gemini' },
		});

		expect(settings.features.webSearch.provider).toBe('gemini');
		expect(settings.features.deepResearch.provider).toBe('gemini');
		expect(settings.features.rag.provider).toBe('gemini');
	});

	// An explicit override is always honoured, even when the stored value is
	// itself invalid for that feature — mapping to 'none', never to defaultProvider.
	it('a hand-written capability-invalid override maps to none, not to the default provider', () => {
		const settings = makeSettings();
		migrateToFeatureRouting(settings, {
			provider: 'gemini',
			providerOverrides: { rag: 'ollama' },
		});

		expect(settings.features.rag.provider).toBe('none');
	});

	it('mcpEnabled absent with configured servers disables every server', () => {
		const servers: MCPServerConfig[] = [
			{ id: 'a', enabled: true } as unknown as MCPServerConfig,
			{ id: 'b', enabled: true } as unknown as MCPServerConfig,
		];
		const settings = makeSettings({ mcpServers: servers });
		migrateToFeatureRouting(settings, { provider: 'gemini' });

		expect(settings.mcpServers.every((s) => s.enabled === false)).toBe(true);
	});

	it('mcpEnabled: false with configured servers disables every server', () => {
		const servers: MCPServerConfig[] = [{ id: 'a', enabled: true } as unknown as MCPServerConfig];
		const settings = makeSettings({ mcpServers: servers });
		migrateToFeatureRouting(settings, { provider: 'gemini', mcpEnabled: false });

		expect(settings.mcpServers.every((s) => s.enabled === false)).toBe(true);
	});

	it("mcpEnabled: true leaves each server's own enabled flag alone", () => {
		const servers: MCPServerConfig[] = [
			{ id: 'a', enabled: true } as unknown as MCPServerConfig,
			{ id: 'b', enabled: false } as unknown as MCPServerConfig,
		];
		const settings = makeSettings({ mcpServers: servers });
		migrateToFeatureRouting(settings, { provider: 'gemini', mcpEnabled: true });

		expect(settings.mcpServers[0].enabled).toBe(true);
		expect(settings.mcpServers[1].enabled).toBe(false);
	});

	it('deletes every removed key from the result', () => {
		// Simulate Object.assign already having copied the legacy fields onto
		// the merged settings object, the way loadSettings() does. These keys no
		// longer exist on ObsidianGeminiSettings, so they're assigned outside the
		// typed fixture builder.
		const settings = makeSettings();
		Object.assign(settings, {
			provider: 'gemini',
			providerOverrides: {},
			chatModelName: 'gemini-3-pro',
			maxRetries: 3,
			temperature: 0.7,
			mcpEnabled: false,
		});
		migrateToFeatureRouting(settings, { provider: 'gemini', chatModelName: 'gemini-3-pro' });

		for (const key of REMOVED_KEYS) {
			expect((settings as unknown as Record<string, unknown>)[key]).toBeUndefined();
		}
	});

	it('leaves anthropicApiKeySecretName untouched', () => {
		const settings = makeSettings({ anthropicApiKeySecretName: 'my-secret' });
		migrateToFeatureRouting(settings, { provider: 'gemini' });
		expect(settings.anthropicApiKeySecretName).toBe('my-secret');
	});

	it('is idempotent: running it a second time on the already-migrated settings is a no-op', () => {
		const settings = makeSettings();
		migrateToFeatureRouting(settings, { provider: 'ollama', providerOverrides: { rag: 'gemini' } });
		const snapshot = JSON.parse(JSON.stringify(settings));

		const migratedAgain = migrateToFeatureRouting(settings, {
			provider: 'ollama',
			providerOverrides: { rag: 'gemini' },
			settingsSchemaVersion: 2,
			features: settings.features,
		});

		expect(migratedAgain).toBe(false);
		expect(settings).toEqual(snapshot);
	});

	// Guards the downgrade round-trip: settingsSchemaVersion survives a
	// downgrade to a pre-redesign release (which writes its own shape back),
	// but `features` doesn't — keying only on the version would skip the
	// migration on the way back up and discard what the old release wrote.
	it('re-runs when settingsSchemaVersion is 2 but features is missing (post-downgrade re-upgrade)', () => {
		const settings = makeSettings();
		const migrated = migrateToFeatureRouting(settings, {
			provider: 'ollama',
			settingsSchemaVersion: 2,
			// no `features` key — as a pre-redesign release would have written
		});

		expect(migrated).toBe(true);
		expect(settings.features.chat.provider).toBe('ollama');
	});

	it('does not run when rawData is null/undefined (fresh install)', () => {
		expect(migrateToFeatureRouting(makeSettings(), null)).toBe(false);
		expect(migrateToFeatureRouting(makeSettings(), undefined)).toBe(false);
	});

	// A schema version newer than this build understands must never be
	// migrated or have data deleted from it — that would misinterpret a
	// future shape this migration doesn't know about (#1508 review).
	it('does not migrate or delete anything when settingsSchemaVersion is newer than this build supports', () => {
		const settings = makeSettings();
		const rawData: Record<string, unknown> = {
			provider: 'ollama',
			settingsSchemaVersion: 3,
			someFutureField: 'keep-me',
		};
		const warn = vi.fn();

		const migrated = migrateToFeatureRouting(settings, rawData, { warn });

		expect(migrated).toBe(false);
		// The raw persisted data is untouched — nothing deleted from it.
		expect(rawData).toEqual({
			provider: 'ollama',
			settingsSchemaVersion: 3,
			someFutureField: 'keep-me',
		});
		// The settings object passed in wasn't mutated by this migration either.
		expect(settings.features).toEqual({});
		expect(warn).toHaveBeenCalled();
	});

	// Folds in the old migrateOllamaModelSetting: before ollamaModelName
	// existed, an Ollama-primary install's single picker wrote to
	// chatModelName, so that field held an Ollama model, not a Gemini one.
	it('a v1 Ollama install that never set ollamaModelName treats chatModelName as the Ollama model', () => {
		const settings = makeSettings();
		migrateToFeatureRouting(settings, {
			provider: 'ollama',
			chatModelName: 'llama3',
		});

		expect(settings.providerModelMemory.gemini).toBeUndefined();
		expect(settings.providerModelMemory.ollama?.chat).toBe('llama3');
		expect(settings.features.chat.model).toBe('llama3');
	});
});

describe('normalizeStateFolderPath', () => {
	it('strips a hand-typed trailing slash', () => {
		const settings = { historyFolder: 'gemini-scribe/' };
		expect(normalizeStateFolderPath(settings)).toBe(true);
		expect(settings.historyFolder).toBe('gemini-scribe');
	});

	it('collapses duplicate internal slashes', () => {
		const settings = { historyFolder: 'gemini-scribe//Agent-Sessions' };
		expect(normalizeStateFolderPath(settings)).toBe(true);
		expect(settings.historyFolder).toBe('gemini-scribe/Agent-Sessions');
	});

	it('strips a leading slash and trims whitespace', () => {
		const settings = { historyFolder: '  /gemini-scribe/ ' };
		expect(normalizeStateFolderPath(settings)).toBe(true);
		expect(settings.historyFolder).toBe('gemini-scribe');
	});

	it('leaves a clean value untouched', () => {
		const settings = { historyFolder: 'gemini-scribe' };
		expect(normalizeStateFolderPath(settings)).toBe(false);
		expect(settings.historyFolder).toBe('gemini-scribe');
	});

	it('leaves an empty value alone (broader validation is out of scope, #1374)', () => {
		const settings = { historyFolder: '' };
		expect(normalizeStateFolderPath(settings)).toBe(false);

		const whitespaceOnly = { historyFolder: '   ' };
		expect(normalizeStateFolderPath(whitespaceOnly)).toBe(false);
	});

	it('a repaired setting regains exclusion (#1374 end-to-end)', () => {
		// The failure mode: a trailing-slash folder defeats isPathInFolder's
		// prefix check, so nothing is "inside" the state folder and exclusions
		// fail open. After the load boundary repairs the value, exclusion works.
		const before = { historyFolder: 'gemini-scribe/' };
		expect(shouldExcludePath('gemini-scribe/Agent-Sessions/run.md', before.historyFolder, '.obsidian')).toBe(false);

		normalizeStateFolderPath(before);
		expect(shouldExcludePath('gemini-scribe/Agent-Sessions/run.md', before.historyFolder, '.obsidian')).toBe(true);
		expect(shouldExcludePath('gemini-scribe', before.historyFolder, '.obsidian')).toBe(true);
		expect(shouldExcludePath('gemini-scribe-backup', before.historyFolder, '.obsidian')).toBe(false);
	});
});
