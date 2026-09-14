/**
 * Tests for `src/ui/settings/paths.ts` (settings-redesign design doc §8.2):
 * `readSettingPath`/`writeSettingPath`, the longest-prefix `SETTING_WRITERS`
 * match, and each writer's behaviour.
 */
import {
	readSettingPath,
	writeSettingPath,
	resolveWriter,
	controlValueTypeMatches,
	SETTING_WRITERS,
} from '../../../src/ui/settings/paths';
import { recallModel } from '../../../src/api/feature-routing';
import { setGeminiModels, DEFAULT_GEMINI_MODELS } from '../../../src/models';
import { buildPlugin } from './fixtures';
import { modelCountCache, modelCountGeneration } from '../../../src/ui/settings/model-count-cache';

afterEach(() => {
	// `GEMINI_MODELS` is a shared module-level binding paths.ts reads
	// directly (not through the plugin fixture) — reset it so a test that
	// mutates the live model list doesn't leak into the next one.
	setGeminiModels([...DEFAULT_GEMINI_MODELS]);
});

describe('readSettingPath / writeSettingPath', () => {
	it('reads a flat and a nested path', () => {
		const plugin = buildPlugin();
		expect(readSettingPath(plugin.settings, 'userName')).toBe('User');
		expect(readSettingPath(plugin.settings, 'features.chat.provider')).toBe('gemini');
	});

	it('returns undefined for a missing path', () => {
		const plugin = buildPlugin();
		expect(readSettingPath(plugin.settings, 'features.doesNotExist.provider')).toBeUndefined();
	});

	it('writes a path on the allowlist', () => {
		const plugin = buildPlugin();
		expect(writeSettingPath(plugin.settings, 'userName', 'Ada')).toBe(true);
		expect(plugin.settings.userName).toBe('Ada');
	});

	it('rejects a path not on the allowlist (a non-scalar path needs a dedicated writer)', () => {
		const plugin = buildPlugin();
		expect(writeSettingPath(plugin.settings, 'ragIndexing.excludeFolders', ['a'])).toBe(false);
		expect(writeSettingPath(plugin.settings, 'features.chat.provider', 'ollama')).toBe(false);
	});
});

describe('controlValueTypeMatches (the M2 guard)', () => {
	it('accepts a scalar control bound to a matching value', () => {
		expect(controlValueTypeMatches('toggle', true)).toBe(true);
		expect(controlValueTypeMatches('text', 'hello')).toBe(true);
		expect(controlValueTypeMatches('number', 5)).toBe(true);
	});

	it('rejects a textarea (string-bound) control pointed at a raw array', () => {
		expect(controlValueTypeMatches('textarea', ['a', 'b'])).toBe(false);
	});

	it('rejects a toggle bound to a non-boolean', () => {
		expect(controlValueTypeMatches('toggle', 'yes')).toBe(false);
	});
});

describe('resolveWriter (longest-prefix match)', () => {
	it('matches an exact key over a wildcard pattern', () => {
		expect(resolveWriter('defaultProvider')).toBe(SETTING_WRITERS['defaultProvider']);
	});

	it('matches a single-wildcard pattern', () => {
		expect(resolveWriter('features.chat.provider')).toBe(SETTING_WRITERS['features.*.provider']);
		expect(resolveWriter('features.imageGen.model')).toBe(SETTING_WRITERS['features.*.model']);
	});

	it('returns undefined when nothing matches', () => {
		expect(resolveWriter('userName')).toBeUndefined();
	});
});

describe('SETTING_WRITERS: features.*.provider', () => {
	it('sets the feature to a real provider, recalling its remembered model', async () => {
		const plugin = buildPlugin();
		plugin.settings.providerModelMemory = { ollama: { chat: 'qwen3:8b' } };
		// The remembered model has to be present in the live list to be recalled.
		setGeminiModels([{ value: 'qwen3:8b', label: 'qwen3:8b', provider: 'ollama' }]);
		const result = await SETTING_WRITERS['features.*.provider'](plugin, 'features.chat.provider', 'ollama');
		expect(plugin.settings.features.chat).toEqual({ provider: 'ollama', model: 'qwen3:8b' });
		expect(result.needsUpdate).toBe(true);
	});

	it('setting the provider to "none" clears the model', async () => {
		const plugin = buildPlugin();
		const result = await SETTING_WRITERS['features.*.provider'](plugin, 'features.chat.provider', 'none');
		expect(plugin.settings.features.chat).toEqual({ provider: 'none', model: '' });
		expect(result.needsUpdate).toBe(true);
	});

	it("drops a remembered model that is no longer in the new provider's list", async () => {
		const plugin = buildPlugin();
		plugin.settings.providerModelMemory = { ollama: { chat: 'retired-model' } };
		const result = await SETTING_WRITERS['features.*.provider'](plugin, 'features.chat.provider', 'ollama');
		expect(plugin.settings.features.chat).toEqual({ provider: 'ollama', model: '' });
		expect(result.needsUpdate).toBe(true);
	});
});

describe('SETTING_WRITERS: features.*.model', () => {
	it('writes the model and remembers it for the (provider, feature) pair', async () => {
		const plugin = buildPlugin();
		const result = await SETTING_WRITERS['features.*.model'](plugin, 'features.chat.model', 'gemini-2.5-flash');
		expect(plugin.settings.features.chat.model).toBe('gemini-2.5-flash');
		expect(recallModel(plugin.settings, 'chat', 'gemini')).toBe('gemini-2.5-flash');
		expect(result.needsUpdate).toBe(false);
	});

	it('is a no-op for a feature routed to none', async () => {
		const plugin = buildPlugin();
		plugin.settings.features.chat = { provider: 'none', model: '' };
		await SETTING_WRITERS['features.*.model'](plugin, 'features.chat.model', 'gemini-2.5-flash');
		expect(plugin.settings.features.chat).toEqual({ provider: 'none', model: '' });
	});
});

describe('SETTING_WRITERS: defaultProvider', () => {
	it('re-points every feature whose provider was the previous default and which the new default supports', async () => {
		const plugin = buildPlugin(); // every feature defaults to gemini; defaultProvider is gemini
		const result = await SETTING_WRITERS['defaultProvider'](plugin, 'defaultProvider', 'ollama');
		expect(plugin.settings.defaultProvider).toBe('ollama');
		// chat/summary/completions/rewrite: ollama supports them -> moved.
		expect(plugin.settings.features.chat.provider).toBe('ollama');
		expect(plugin.settings.features.summary.provider).toBe('ollama');
		// webSearch/deepResearch/rag/imageGen: ollama does not support them -> left alone (still gemini).
		expect(plugin.settings.features.webSearch.provider).toBe('gemini');
		expect(plugin.settings.features.rag.provider).toBe('gemini');
		expect(result.needsUpdate).toBe(true);
	});

	it('never touches a feature the user explicitly set to none', async () => {
		const plugin = buildPlugin();
		plugin.settings.features.chat = { provider: 'none', model: '' };
		await SETTING_WRITERS['defaultProvider'](plugin, 'defaultProvider', 'ollama');
		expect(plugin.settings.features.chat).toEqual({ provider: 'none', model: '' });
	});

	it('is a no-op when the new default equals the current default', async () => {
		const plugin = buildPlugin();
		const result = await SETTING_WRITERS['defaultProvider'](plugin, 'defaultProvider', 'gemini');
		expect(result.needsUpdate).toBe(false);
	});
});

describe('SETTING_WRITERS: historyFolder', () => {
	it('normalizes the path the way loadSettings() does for a persisted value', async () => {
		const plugin = buildPlugin();
		await SETTING_WRITERS['historyFolder'](plugin, 'historyFolder', '/gemini-scribe/');
		expect(plugin.settings.historyFolder).not.toBe('/gemini-scribe/');
		expect(plugin.settings.historyFolder.startsWith('/')).toBe(false);
	});
});

describe('SETTING_WRITERS: provider credentials/base URLs invalidate the model count cache', () => {
	afterEach(() => {
		modelCountCache.clear();
		modelCountGeneration.clear();
	});

	it.each([
		['apiKeySecretName', 'gemini-key', 'gemini'],
		['customBaseUrl', 'https://example.com', 'gemini'],
		['openaiApiKeySecretName', 'openai-key', 'openai'],
		['openaiBaseUrl', 'https://example.com', 'openai'],
		['ollamaBaseUrl', 'http://localhost:9999', 'ollama'],
	] as const)(
		'writing %s clears the cached model count and bumps the generation for %s',
		async (key, value, provider) => {
			const plugin = buildPlugin();
			modelCountCache.set(provider, { total: 5, cloud: 0 });
			modelCountGeneration.set(provider, 1);

			const result = await SETTING_WRITERS[key](plugin, key, value);

			expect(plugin.settings[key]).toBe(value);
			expect(modelCountCache.has(provider)).toBe(false);
			expect(modelCountGeneration.get(provider)).toBe(2);
			expect(result.needsUpdate).toBe(true);
		}
	);
});
