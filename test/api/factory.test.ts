import { ModelClientFactory, ModelUseCase } from '../../src/api/factory';
import { FeatureUnavailableError } from '../../src/api/feature-errors';
import type { FeatureRoutes } from '../../src/types/features';

// --- Mocks ---

const { MockGeminiClient, MockOllamaClient, MockOpenAIClient, MockRetryDecorator, MockGeminiPrompts } = vi.hoisted(
	() => {
		const MockGeminiClient = vi.fn().mockImplementation(function () {
			return { generateModelResponse: vi.fn() };
		});
		const MockOllamaClient = vi.fn().mockImplementation(function () {
			return { generateModelResponse: vi.fn() };
		});
		const MockOpenAIClient = vi.fn().mockImplementation(function () {
			return { generateModelResponse: vi.fn() };
		});
		const MockRetryDecorator = vi.fn().mockImplementation(function (_client: any) {
			return { _wrappedClient: _client };
		});
		const MockGeminiPrompts = vi.fn().mockImplementation(function () {
			return {};
		});
		return { MockGeminiClient, MockOllamaClient, MockOpenAIClient, MockRetryDecorator, MockGeminiPrompts };
	}
);

vi.mock('../../src/api/providers/gemini/client', () => ({
	GeminiClient: MockGeminiClient,
}));

vi.mock('../../src/api/providers/ollama/client', () => ({
	OllamaClient: MockOllamaClient,
}));

vi.mock('../../src/api/providers/openai/client', () => ({
	OpenAIClient: MockOpenAIClient,
}));

vi.mock('../../src/api/retry-decorator', () => ({
	RetryDecorator: MockRetryDecorator,
}));

vi.mock('../../src/prompts', () => ({
	GeminiPrompts: MockGeminiPrompts,
}));

// --- Helpers ---

function routes(overrides: Partial<FeatureRoutes>): FeatureRoutes {
	const base: FeatureRoutes = {
		chat: { provider: 'gemini', model: '' },
		summary: { provider: 'gemini', model: '' },
		completions: { provider: 'gemini', model: '' },
		rewrite: { provider: 'gemini', model: '' },
		webSearch: { provider: 'gemini', model: '' },
		deepResearch: { provider: 'gemini', model: '' },
		rag: { provider: 'gemini', model: '' },
		imageGen: { provider: 'gemini', model: '' },
	};
	return { ...base, ...overrides };
}

function createMockPlugin(overrides?: { features?: Partial<FeatureRoutes>; settings?: Record<string, any> }) {
	return {
		apiKey: 'test-api-key',
		openaiApiKey: 'sk-test-key',
		settings: {
			defaultProvider: 'gemini',
			features: routes(overrides?.features ?? {}),
			ollamaBaseUrl: 'http://localhost:11434',
			openaiBaseUrl: 'https://api.openai.com/v1',
			...overrides?.settings,
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	} as any;
}

describe('ModelClientFactory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('createFromPlugin', () => {
		it('should create a GeminiClient when chat is routed to gemini', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
			expect(MockOllamaClient).not.toHaveBeenCalled();
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		it('should create an OllamaClient when chat is routed to ollama', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'ollama', model: '' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockOllamaClient).toHaveBeenCalledTimes(1);
			expect(MockGeminiClient).not.toHaveBeenCalled();
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		// No silent fallback: a feature routed to 'none' throws rather than
		// silently talking to Gemini.
		it('throws FeatureUnavailableError when chat is routed to none', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'none', model: '' } } });

			expect(() => ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT)).toThrow(FeatureUnavailableError);
			expect(MockGeminiClient).not.toHaveBeenCalled();
		});

		it('should pass GeminiPrompts to the client', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockGeminiPrompts).toHaveBeenCalledWith(plugin);
			// GeminiClient gets the prompts instance as second arg
			expect(MockGeminiClient.mock.calls[0][1]).toBeDefined();
		});

		it('wraps the client with a retry decorator using a fixed policy, independent of any settings', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockRetryDecorator).toHaveBeenCalledWith(expect.anything(), plugin.logger);
		});

		it('should apply overrides to Gemini config', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT, { model: 'custom-model' });

			const geminiConfig = MockGeminiClient.mock.calls[0][0];
			expect(geminiConfig.model).toBe('custom-model');
		});

		it('should apply overrides to Ollama config', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'ollama', model: '' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT, { model: 'custom-model' });

			const ollamaConfig = MockOllamaClient.mock.calls[0][0];
			expect(ollamaConfig.model).toBe('custom-model');
		});

		it('should use Ollama base URL from settings', () => {
			const plugin = createMockPlugin({
				features: { chat: { provider: 'ollama', model: '' } },
				settings: { ollamaBaseUrl: 'http://remote:11434' },
			});
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const ollamaConfig = MockOllamaClient.mock.calls[0][0];
			expect(ollamaConfig.baseUrl).toBe('http://remote:11434');
		});

		it('should default ollamaBaseUrl to localhost when empty', () => {
			const plugin = createMockPlugin({
				features: { chat: { provider: 'ollama', model: '' } },
				settings: { ollamaBaseUrl: '' },
			});
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const ollamaConfig = MockOllamaClient.mock.calls[0][0];
			expect(ollamaConfig.baseUrl).toBe('http://localhost:11434');
		});

		it('should create an OpenAIClient when chat is routed to openai', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'openai', model: '' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockOpenAIClient).toHaveBeenCalledTimes(1);
			expect(MockGeminiClient).not.toHaveBeenCalled();
			expect(MockOllamaClient).not.toHaveBeenCalled();
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		it('should use the resolved OpenAI API key and base URL from settings', () => {
			const plugin = createMockPlugin({
				features: { chat: { provider: 'openai', model: '' } },
				settings: { openaiBaseUrl: 'http://localhost:1234/v1' },
			});
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const openaiConfig = MockOpenAIClient.mock.calls[0][0];
			expect(openaiConfig.apiKey).toBe('sk-test-key');
			expect(openaiConfig.baseUrl).toBe('http://localhost:1234/v1');
		});

		it('should default openaiBaseUrl to api.openai.com when empty', () => {
			const plugin = createMockPlugin({
				features: { chat: { provider: 'openai', model: '' } },
				settings: { openaiBaseUrl: '' },
			});
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const openaiConfig = MockOpenAIClient.mock.calls[0][0];
			expect(openaiConfig.baseUrl).toBe('https://api.openai.com/v1');
		});
	});

	describe('feature -> model resolution (via createFromPlugin)', () => {
		it('should use the chat feature model for the CHAT use case', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'gemini', model: 'my-chat-model' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-chat-model');
		});

		it('should use the summary feature model for the SUMMARY use case', () => {
			const plugin = createMockPlugin({ features: { summary: { provider: 'gemini', model: 'my-summary-model' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SUMMARY);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-summary-model');
		});

		it('should use the completions feature model for the COMPLETIONS use case', () => {
			const plugin = createMockPlugin({
				features: { completions: { provider: 'gemini', model: 'my-completions-model' } },
			});
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.COMPLETIONS);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-completions-model');
		});

		it('should use the rewrite feature model for the REWRITE use case', () => {
			const plugin = createMockPlugin({ features: { rewrite: { provider: 'gemini', model: 'my-rewrite-model' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.REWRITE);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-rewrite-model');
		});

		it('should use the chat feature model for the SEARCH use case (SEARCH bills to chat)', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'gemini', model: 'my-chat-model' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SEARCH);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-chat-model');
		});

		it('should fall back to a default when the stored model is empty', () => {
			const plugin = createMockPlugin({ features: { chat: { provider: 'gemini', model: '' } } });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBeTruthy();
		});

		it('routes REWRITE and SEARCH independently of each other and of chat when each has its own route', () => {
			const plugin = createMockPlugin({
				features: {
					chat: { provider: 'gemini', model: 'chat-model' },
					rewrite: { provider: 'ollama', model: 'rewrite-model' },
				},
			});

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.REWRITE);
			expect(MockOllamaClient.mock.calls[0][0].model).toBe('rewrite-model');

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SEARCH);
			expect(MockGeminiClient.mock.calls[0][0].model).toBe('chat-model');
		});
	});

	describe('createChatModel', () => {
		it('should create a chat model', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createChatModel(plugin);

			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		// The legacy second parameter (session temperature/topP) is dropped
		// entirely as of the settings redesign, but the call must not throw when
		// an unmigrated caller still passes one.
		it('ignores a legacy second argument rather than throwing', () => {
			const plugin = createMockPlugin();
			expect(() => ModelClientFactory.createChatModel(plugin, { temperature: 0.2, topP: 0.5 })).not.toThrow();
			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
		});
	});

	describe('convenience methods', () => {
		it('createSummaryModel should use the summary feature route', () => {
			const plugin = createMockPlugin({ features: { summary: { provider: 'gemini', model: 'summary-model' } } });
			ModelClientFactory.createSummaryModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('summary-model');
		});

		it('createCompletionsModel should use the completions feature route', () => {
			const plugin = createMockPlugin({
				features: { completions: { provider: 'gemini', model: 'completions-model' } },
			});
			ModelClientFactory.createCompletionsModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('completions-model');
		});

		it('createRewriteModel should use the rewrite feature route', () => {
			const plugin = createMockPlugin({ features: { rewrite: { provider: 'gemini', model: 'rewrite-model' } } });
			ModelClientFactory.createRewriteModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('rewrite-model');
		});
	});

	// Every feature is routed independently: one session can span providers.
	describe('per-feature provider routing', () => {
		it('builds an Ollama client for one feature and Gemini for the rest', () => {
			const plugin = createMockPlugin({
				features: {
					chat: { provider: 'gemini', model: 'gemini-chat' },
					summary: { provider: 'ollama', model: 'ollama-local' },
				},
			});

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SUMMARY);
			expect(MockOllamaClient).toHaveBeenCalledTimes(1);
			expect(MockOllamaClient.mock.calls[0][0].model).toBe('ollama-local');

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);
			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
			expect(MockGeminiClient.mock.calls[0][0].model).toBe('gemini-chat');
		});

		it('builds an OpenAI client for a feature routed there while chat stays on Ollama', () => {
			const plugin = createMockPlugin({
				features: {
					chat: { provider: 'ollama', model: 'ollama-local' },
					summary: { provider: 'openai', model: 'openai-summary' },
				},
			});

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SUMMARY);
			expect(MockOpenAIClient).toHaveBeenCalledTimes(1);
			expect(MockOpenAIClient.mock.calls[0][0].model).toBe('openai-summary');
			expect(MockOllamaClient).not.toHaveBeenCalled();

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);
			expect(MockOllamaClient).toHaveBeenCalledTimes(1);
			expect(MockOllamaClient.mock.calls[0][0].model).toBe('ollama-local');
		});

		// ModelUseCase.SEARCH is a thinking-level tier on the chat path, not the
		// `webSearch` feature — it must follow chat's provider, and never be
		// gated off just because chat isn't routed to a web-search-capable provider.
		it('routes the SEARCH use case with chat, not with the webSearch feature', () => {
			const plugin = createMockPlugin({
				features: {
					chat: { provider: 'ollama', model: 'ollama-local' },
					webSearch: { provider: 'none', model: '' },
				},
			});

			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SEARCH);

			expect(MockOllamaClient).toHaveBeenCalledTimes(1);
			expect(MockGeminiClient).not.toHaveBeenCalled();
			expect(MockOllamaClient.mock.calls[0][0].model).toBe('ollama-local');
		});
	});
});
