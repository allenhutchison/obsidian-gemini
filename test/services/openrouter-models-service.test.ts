import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { OpenRouterModelsService, mapOpenRouterCatalog } from '../../src/services/openrouter-models-service';

const mockedRequestUrl = requestUrl as unknown as Mock;

const buildPlugin = (apiKey = 'sk-or-test') =>
	({
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		settings: {},
		openrouterApiKey: apiKey,
	}) as any;

const TEXT_MODELS = [
	{
		id: 'google/gemini-3.5-flash',
		name: 'Google: Gemini 3.5 Flash',
		created: 300,
		context_length: 1_048_576,
		architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
		supported_parameters: ['tools', 'reasoning'],
	},
	{
		id: 'google/gemini-3-flash-preview',
		name: 'Google: Gemini 3 Flash Preview',
		created: 100,
		context_length: 1_048_576,
		architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
		supported_parameters: ['tools'],
	},
	{
		id: 'google/gemini-3.5-flash-lite',
		name: 'Google: Gemini 3.5 Flash Lite',
		created: 250,
		context_length: 1_048_576,
		architecture: { input_modalities: ['text'], output_modalities: ['text'] },
		supported_parameters: ['tools'],
	},
	{
		id: 'liquid/lfm-3-1.7b',
		name: 'Liquid: LFM 3',
		created: 400,
		context_length: 262_144,
		architecture: { input_modalities: ['text'], output_modalities: ['text'] },
		supported_parameters: [],
	},
];

const IMAGE_MODELS = [
	{ id: 'openai/gpt-image-2.6-flare', name: 'OpenAI: GPT Image 2.6 Flare', created: 50 },
	{ id: 'openai/gpt-image-2.6-sunburst', name: 'OpenAI: GPT Image 2.6 Sunburst', created: 60 },
];

describe('mapOpenRouterCatalog', () => {
	it('maps context windows and vision from the catalog metadata', () => {
		const models = mapOpenRouterCatalog(TEXT_MODELS, []);
		const flash = models.find((m) => m.value === 'google/gemini-3.5-flash');
		expect(flash).toMatchObject({
			label: 'Google: Gemini 3.5 Flash',
			provider: 'openrouter',
			supportsVision: true,
			contextWindow: 1_048_576,
		});
		expect(flash?.capabilitiesUnknown).toBeUndefined();
		expect(models.find((m) => m.value === 'liquid/lfm-3-1.7b')?.supportsVision).toBe(false);
	});

	it('marks /images/models entries as image-generation models', () => {
		const models = mapOpenRouterCatalog([], IMAGE_MODELS);
		expect(models.every((m) => m.supportsImageGeneration && m.provider === 'openrouter')).toBe(true);
		// Newest image model is the image default.
		expect(models.find((m) => m.defaultForRoles?.includes('image'))?.value).toBe('openai/gpt-image-2.6-sunburst');
	});

	it('picks the newest matching Gemini Flash models as role defaults', () => {
		const models = mapOpenRouterCatalog(TEXT_MODELS, IMAGE_MODELS);
		const defaultFor = (role: string) => models.find((m) => m.defaultForRoles?.includes(role as never))?.value;
		expect(defaultFor('chat')).toBe('google/gemini-3.5-flash');
		expect(defaultFor('summary')).toBe('google/gemini-3.5-flash');
		expect(defaultFor('rewrite')).toBe('google/gemini-3.5-flash');
		expect(defaultFor('completions')).toBe('google/gemini-3.5-flash-lite');
	});

	it('only picks a tool-capable chat default', () => {
		const models = mapOpenRouterCatalog([{ ...TEXT_MODELS[0], supported_parameters: [] }, TEXT_MODELS[1]], []);
		expect(models.find((m) => m.defaultForRoles?.includes('chat'))?.value).toBe('google/gemini-3-flash-preview');
	});

	it('skips entries without an id', () => {
		expect(mapOpenRouterCatalog([{ id: '' }, {} as never], [{ id: '' }])).toEqual([]);
	});
});

describe('OpenRouterModelsService', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('fetches both catalogs with the key', async () => {
		mockedRequestUrl.mockImplementation(async ({ url }: { url: string }) => ({
			status: 200,
			json: { data: url.endsWith('/images/models') ? IMAGE_MODELS : TEXT_MODELS },
		}));
		const svc = new OpenRouterModelsService(buildPlugin());
		const models = await svc.getModels();

		expect(models).toHaveLength(TEXT_MODELS.length + IMAGE_MODELS.length);
		expect(svc.lastProbe).toBe('reachable');
		const urls = mockedRequestUrl.mock.calls.map((c) => c[0].url);
		expect(urls).toEqual(['https://openrouter.ai/api/v1/models', 'https://openrouter.ai/api/v1/images/models']);
		expect(mockedRequestUrl.mock.calls[0][0].headers).toEqual({ Authorization: 'Bearer sk-or-test' });
	});

	it('keeps the text catalog when the image catalog fails', async () => {
		mockedRequestUrl.mockImplementation(async ({ url }: { url: string }) =>
			url.endsWith('/images/models') ? { status: 500, json: {} } : { status: 200, json: { data: TEXT_MODELS } }
		);
		const plugin = buildPlugin();
		const models = await new OpenRouterModelsService(plugin).getModels();
		expect(models).toHaveLength(TEXT_MODELS.length);
		expect(plugin.logger.warn).toHaveBeenCalled();
	});

	it('reports unreachable when the text catalog fails', async () => {
		mockedRequestUrl.mockResolvedValue({ status: 401, json: {} });
		const svc = new OpenRouterModelsService(buildPlugin());
		expect(await svc.getModels()).toEqual([]);
		expect(svc.lastProbe).toBe('unreachable');
	});

	it('sends no traffic without a key', async () => {
		const svc = new OpenRouterModelsService(buildPlugin(''));
		expect(await svc.getModels()).toEqual([]);
		expect(mockedRequestUrl).not.toHaveBeenCalled();
		expect(svc.lastProbe).toBeNull();
	});
});
