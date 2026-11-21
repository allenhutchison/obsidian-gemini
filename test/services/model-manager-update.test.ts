import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { ModelManager } from '../../src/services/model-manager';
import { GeminiModel, setGeminiModels, GEMINI_MODELS, DEFAULT_GEMINI_MODELS } from '../../src/models';

/**
 * These tests verify that updateModels() preserves feature routing (settings
 * redesign: `features`/`providerModelMemory`, replacing the old per-role
 * `chatModelName`/`summaryModelName`/`completionsModelName`/`imageModelName`
 * fields) when the model list changes, preventing any feature's model from
 * being silently replaced.
 */
/** ListModels answers, so the Gemini list counts as verified and reconciliation runs. */
function mockListModels(): void {
	const mocked = requestUrl as unknown as Mock;
	mocked.mockReset();
	mocked.mockResolvedValue({
		status: 200,
		json: {
			models: DEFAULT_GEMINI_MODELS.map((m) => ({
				name: `models/${m.value}`,
				displayName: m.label,
				supportedGenerationMethods: ['generateContent'],
			})),
		},
	});
}

describe('ModelManager.updateModels — model role preservation', () => {
	let modelManager: ModelManager;
	let mockPlugin: any;
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];

		// Reset GEMINI_MODELS to static defaults (simulates a fresh plugin load)
		setGeminiModels([...DEFAULT_GEMINI_MODELS]);

		mockPlugin = {
			settings: {
				defaultProvider: 'gemini',
				features: {
					chat: { provider: 'gemini', model: 'gemini-flash-latest' },
					summary: { provider: 'gemini', model: 'gemini-flash-latest' },
					completions: { provider: 'gemini', model: 'gemini-flash-lite-latest' },
					rewrite: { provider: 'gemini', model: '' },
					webSearch: { provider: 'gemini', model: '' },
					deepResearch: { provider: 'gemini', model: '' },
					rag: { provider: 'gemini', model: '' },
					imageGen: { provider: 'gemini', model: 'gemini-2.5-flash-image' },
				},
				providerModelMemory: {},
			},
			apiKey: 'test-api-key',
			loadData: vi.fn().mockResolvedValue({}),
			saveData: vi.fn(),
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				child: vi.fn(function (this: any) {
					return this;
				}),
			},
		};

		modelManager = new ModelManager(mockPlugin);
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('should preserve image model setting when models are synced', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.imageGen.model).toBe('gemini-2.5-flash-image');
		expect(result.changedSettingsInfo.some((info) => info.includes('imageGen model'))).toBe(false);

		// Verify GEMINI_MODELS contains image models
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should preserve chat model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.chat.model).toBe('gemini-flash-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('chat model'))).toBe(false);
	});

	it('should preserve summary model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.summary.model).toBe('gemini-flash-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('summary model'))).toBe(false);
	});

	it('should preserve completions model setting', async () => {
		await modelManager.initialize();
		const result = await modelManager.updateModels();

		expect(result.updatedSettings.features.completions.model).toBe('gemini-flash-lite-latest');
		expect(result.changedSettingsInfo.some((info) => info.includes('completions model'))).toBe(false);
	});

	it('should include both text and image models in global GEMINI_MODELS', async () => {
		await modelManager.initialize();

		const textModels = GEMINI_MODELS.filter((m) => !m.supportsImageGeneration);
		const imageModels = GEMINI_MODELS.filter((m) => m.supportsImageGeneration);

		expect(textModels.length).toBeGreaterThan(0);
		expect(imageModels.length).toBeGreaterThan(0);
	});

	it('should correctly update image model if it is genuinely unavailable', async () => {
		mockListModels();
		mockPlugin.settings.features.imageGen.model = 'gemini-nonexistent-image-model';

		setGeminiModels([{ value: 'old-model', label: 'Old' }]);

		const result = await modelManager.updateModels();

		expect(result.settingsChanged).toBe(true);
		expect(result.changedSettingsInfo.some((info) => info.includes('imageGen model'))).toBe(true);

		// Should be updated to an actual image model, not a text model
		const newImageModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.features.imageGen.model);
		expect(newImageModel).toBeDefined();
		expect(newImageModel?.supportsImageGeneration || newImageModel?.value.includes('image')).toBe(true);
	});

	it('should correctly update chat model if it is genuinely unavailable', async () => {
		mockListModels();
		mockPlugin.settings.features.chat.model = 'gemini-nonexistent-chat-model';

		setGeminiModels([{ value: 'old-model', label: 'Old' }]);

		const result = await modelManager.updateModels();

		expect(result.settingsChanged).toBe(true);
		expect(result.changedSettingsInfo.some((info) => info.includes('chat model'))).toBe(true);

		// Should be updated to a valid text model in GEMINI_MODELS, not an image model
		const newChatModel = GEMINI_MODELS.find((m) => m.value === result.updatedSettings.features.chat.model);
		expect(newChatModel).toBeDefined();
		expect(newChatModel?.supportsImageGeneration).not.toBe(true);
		expect(newChatModel?.value.includes('image')).toBe(false);
	});
});

describe('ModelManager.updateModels — merged Ollama local + cloud catalog', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setGeminiModels([...DEFAULT_GEMINI_MODELS]);
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	const buildPlugin = () =>
		({
			settings: {
				defaultProvider: 'ollama',
				ollamaBaseUrl: 'http://localhost:11434',
				features: {
					chat: { provider: 'ollama', model: 'llama3.2' },
					summary: { provider: 'none', model: '' },
					completions: { provider: 'none', model: '' },
					rewrite: { provider: 'none', model: '' },
					webSearch: { provider: 'none', model: '' },
					deepResearch: { provider: 'none', model: '' },
					rag: { provider: 'none', model: '' },
					imageGen: { provider: 'none', model: '' },
				},
				providerModelMemory: {},
			},
			apiKey: '',
			ollamaApiKey: 'secret',
			loadData: vi.fn().mockResolvedValue({}),
			saveData: vi.fn(),
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		}) as any;

	/** `null` makes that host's /api/tags fail. */
	function mockHosts(local: string[] | null, cloud: string[] | null): void {
		const mocked = requestUrl as unknown as Mock;
		mocked.mockReset();
		mocked.mockImplementation((opts: { url: string }) => {
			if (opts.url.endsWith('/api/show')) {
				return Promise.resolve({ status: 200, json: { capabilities: ['completion'] } });
			}
			const names = opts.url.startsWith('https://ollama.com/') ? cloud : local;
			if (names === null) return Promise.reject(new Error('ECONNREFUSED'));
			return Promise.resolve({ status: 200, json: { models: names.map((name) => ({ name })) } });
		});
	}

	it('keeps a saved local model while only the cloud half of the list loaded', async () => {
		mockHosts(null, ['kimi-k2:1t']);
		const manager = new ModelManager(buildPlugin());
		const result = await manager.updateModels();
		expect(result.settingsChanged).toBe(false);
		expect(result.updatedSettings.features.chat.model).toBe('llama3.2');
	});

	it('still reconciles once both halves loaded', async () => {
		mockHosts(['qwen3:8b'], ['kimi-k2:1t']);
		const manager = new ModelManager(buildPlugin());
		const result = await manager.updateModels();
		// llama3.2 is gone from a complete list, so it is replaced by the local default.
		expect(result.updatedSettings.features.chat.model).toBe('qwen3:8b');
	});
});
