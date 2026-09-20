import { featureRowDisplay, isModelMissing, modelOptions } from '../../../src/ui/settings/display-values';
import type { SettingsContext } from '../../../src/ui/settings/context';
import { GEMINI_MODELS, setGeminiModels, type GeminiModel } from '../../../src/models';
import type { FeatureRoutes } from '../../../src/types/features';
import { buildPlugin } from './fixtures';

const MODELS: GeminiModel[] = [
	{ value: 'gemini-chat', label: 'Gemini Chat', provider: 'gemini', defaultForRoles: ['chat'] },
	{ value: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', defaultForRoles: ['chat', 'rewrite'] },
	{ value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', defaultForRoles: ['completions'] },
	{ value: 'llama3', label: 'llama3', provider: 'ollama' },
	{ value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai', defaultForRoles: ['chat'] },
	{
		value: 'gpt-image-2.5-flare',
		label: 'GPT Image 2.5 Flare',
		provider: 'openai',
		defaultForRoles: ['image'],
		supportsImageGeneration: true,
	},
	{
		value: 'custom-compatible-model',
		label: 'Custom Compatible Model',
		provider: 'openai',
		capabilitiesUnknown: true,
	},
];

function ctxWith(features: Partial<FeatureRoutes>, secrets: Record<string, string> = {}): SettingsContext {
	const plugin = buildPlugin(secrets);
	Object.assign(plugin.settings.features, features);
	return { plugin, tab: { update: vi.fn() } } as unknown as SettingsContext;
}

describe('default model labels', () => {
	let saved: GeminiModel[];
	beforeEach(() => {
		saved = [...GEMINI_MODELS];
		setGeminiModels(MODELS);
	});
	afterEach(() => setGeminiModels(saved));

	it('names the role default for each feature in the model dropdown', () => {
		const ctx = ctxWith({
			chat: { provider: 'anthropic', model: '' },
			completions: { provider: 'anthropic', model: '' },
		});
		expect(modelOptions(ctx, 'chat')['']).toBe('Default (Claude Opus 5)');
		expect(modelOptions(ctx, 'completions')['']).toBe('Default (Claude Haiku 4.5)');
	});

	it('shows the named default on the Features row too', () => {
		const ctx = ctxWith(
			{ completions: { provider: 'anthropic', model: '' } },
			{ anthropicApiKeySecretName: 'anthropic-key' }
		);
		expect(featureRowDisplay(ctx, 'completions')).toBe('Anthropic · Default (Claude Haiku 4.5)');
	});

	it('keeps "Same as chat" for a single-model provider and names the chat default there', () => {
		const ctx = ctxWith({
			chat: { provider: 'ollama', model: '' },
			summary: { provider: 'ollama', model: '' },
		});
		expect(modelOptions(ctx, 'summary')['']).toBe('Same as chat');
		expect(modelOptions(ctx, 'chat')['']).toBe('Default (llama3)');
	});

	it('falls back to the unnamed label while a provider has no models loaded', () => {
		const ctx = ctxWith({ chat: { provider: 'gemini', model: '' } });
		setGeminiModels([]);
		expect(modelOptions(ctx, 'chat')['']).toBe('Default for this provider');
	});

	it('separates OpenAI chat and image models between feature pickers', () => {
		const ctx = ctxWith({
			chat: { provider: 'openai', model: '' },
			imageGen: { provider: 'openai', model: '' },
		});

		expect(modelOptions(ctx, 'chat')).toEqual({
			'': 'Default (GPT-5.6 Sol)',
			'gpt-5.6-sol': 'GPT-5.6 Sol',
			'custom-compatible-model': 'Custom Compatible Model',
		});
		expect(modelOptions(ctx, 'imageGen')).toEqual({
			'': 'Default (GPT Image 2.5 Flare)',
			'gpt-image-2.5-flare': 'GPT Image 2.5 Flare',
			'custom-compatible-model': 'Custom Compatible Model (image support not reported)',
		});
	});

	it('accepts a compatible-endpoint model selected for image generation', () => {
		const ctx = ctxWith(
			{ imageGen: { provider: 'openai', model: 'custom-compatible-model' } },
			{ openaiApiKeySecretName: 'openai-key' }
		);

		expect(isModelMissing(ctx, 'imageGen')).toBe(false);
		expect(featureRowDisplay(ctx, 'imageGen')).toBe('OpenAI · Custom Compatible Model');
	});

	it('marks a text model stored on image generation as missing', () => {
		const ctx = ctxWith({ imageGen: { provider: 'openai', model: 'gpt-5.6-sol' } });

		expect(isModelMissing(ctx, 'imageGen')).toBe(true);
	});
});
