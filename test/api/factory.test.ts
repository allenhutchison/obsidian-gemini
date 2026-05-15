import { ModelClientFactory, ModelUseCase } from '../../src/api/factory';

// --- Mocks ---

const { MockGeminiClient, MockOllamaClient, MockRetryDecorator, MockGeminiPrompts } = vi.hoisted(() => {
	const MockGeminiClient = vi.fn().mockImplementation(function () {
		return { generateModelResponse: vi.fn() };
	});
	const MockOllamaClient = vi.fn().mockImplementation(function () {
		return { generateModelResponse: vi.fn() };
	});
	const MockRetryDecorator = vi.fn().mockImplementation(function (_client: any) {
		return { _wrappedClient: _client };
	});
	const MockGeminiPrompts = vi.fn().mockImplementation(function () {
		return {};
	});
	return { MockGeminiClient, MockOllamaClient, MockRetryDecorator, MockGeminiPrompts };
});

vi.mock('../../src/api/providers/gemini/client', () => ({
	GeminiClient: MockGeminiClient,
}));

vi.mock('../../src/api/providers/ollama/client', () => ({
	OllamaClient: MockOllamaClient,
}));

vi.mock('../../src/api/retry-decorator', () => ({
	RetryDecorator: MockRetryDecorator,
}));

vi.mock('../../src/prompts', () => ({
	GeminiPrompts: MockGeminiPrompts,
}));

// --- Helpers ---

function createMockPlugin(overrides?: Record<string, any>) {
	return {
		apiKey: 'test-api-key',
		settings: {
			provider: 'gemini',
			chatModelName: 'gemini-2.0-flash',
			summaryModelName: 'gemini-2.0-flash',
			completionsModelName: 'gemini-2.0-flash-lite',
			temperature: 1.0,
			topP: 0.95,
			streamingEnabled: true,
			maxRetries: 3,
			initialBackoffDelay: 1000,
			ollamaBaseUrl: 'http://localhost:11434',
			...overrides,
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
		it('should create a GeminiClient when provider is gemini', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
			expect(MockOllamaClient).not.toHaveBeenCalled();
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		it('should create an OllamaClient when provider is ollama', () => {
			const plugin = createMockPlugin({ provider: 'ollama' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockOllamaClient).toHaveBeenCalledTimes(1);
			expect(MockGeminiClient).not.toHaveBeenCalled();
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		it('should default to gemini when provider is undefined', () => {
			const plugin = createMockPlugin({ provider: undefined });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
			expect(MockOllamaClient).not.toHaveBeenCalled();
		});

		it('should pass GeminiPrompts to the client', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockGeminiPrompts).toHaveBeenCalledWith(plugin);
			// GeminiClient gets the prompts instance as second arg
			expect(MockGeminiClient.mock.calls[0][1]).toBeDefined();
		});

		it('should pass retry config from settings', () => {
			const plugin = createMockPlugin({ maxRetries: 5, initialBackoffDelay: 2000 });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockRetryDecorator).toHaveBeenCalledWith(
				expect.anything(),
				{ maxRetries: 5, initialBackoffDelay: 2000 },
				plugin.logger
			);
		});

		it('should use default retry values when settings are undefined', () => {
			const plugin = createMockPlugin({ maxRetries: undefined, initialBackoffDelay: undefined });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			expect(MockRetryDecorator).toHaveBeenCalledWith(
				expect.anything(),
				{ maxRetries: 3, initialBackoffDelay: 1000 },
				plugin.logger
			);
		});

		it('should apply overrides to Gemini config', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT, { temperature: 0.5 });

			const geminiConfig = MockGeminiClient.mock.calls[0][0];
			expect(geminiConfig.temperature).toBe(0.5);
		});

		it('should apply overrides to Ollama config', () => {
			const plugin = createMockPlugin({ provider: 'ollama' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT, { temperature: 0.3 });

			const ollamaConfig = MockOllamaClient.mock.calls[0][0];
			expect(ollamaConfig.temperature).toBe(0.3);
		});

		it('should use Ollama base URL from settings', () => {
			const plugin = createMockPlugin({ provider: 'ollama', ollamaBaseUrl: 'http://remote:11434' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const ollamaConfig = MockOllamaClient.mock.calls[0][0];
			expect(ollamaConfig.baseUrl).toBe('http://remote:11434');
		});

		it('should default ollamaBaseUrl to localhost when empty', () => {
			const plugin = createMockPlugin({ provider: 'ollama', ollamaBaseUrl: '' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const ollamaConfig = MockOllamaClient.mock.calls[0][0];
			expect(ollamaConfig.baseUrl).toBe('http://localhost:11434');
		});
	});

	describe('resolveModelName (via createFromPlugin)', () => {
		it('should use chatModelName for CHAT use case', () => {
			const plugin = createMockPlugin({ chatModelName: 'my-chat-model' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-chat-model');
		});

		it('should use summaryModelName for SUMMARY use case', () => {
			const plugin = createMockPlugin({ summaryModelName: 'my-summary-model' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SUMMARY);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-summary-model');
		});

		it('should use completionsModelName for COMPLETIONS use case', () => {
			const plugin = createMockPlugin({ completionsModelName: 'my-completions-model' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.COMPLETIONS);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-completions-model');
		});

		it('should use chatModelName for REWRITE use case', () => {
			const plugin = createMockPlugin({ chatModelName: 'my-chat-model' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.REWRITE);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-chat-model');
		});

		it('should use chatModelName for SEARCH use case', () => {
			const plugin = createMockPlugin({ chatModelName: 'my-chat-model' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.SEARCH);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('my-chat-model');
		});

		it('should fall back to default when model name is empty', () => {
			const plugin = createMockPlugin({ chatModelName: '' });
			ModelClientFactory.createFromPlugin(plugin, ModelUseCase.CHAT);

			const config = MockGeminiClient.mock.calls[0][0];
			// Should get a non-empty default from getDefaultModelForRole
			expect(config.model).toBeTruthy();
		});
	});

	describe('createChatModel', () => {
		it('should create a chat model without session config', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createChatModel(plugin);

			expect(MockGeminiClient).toHaveBeenCalledTimes(1);
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		it('should apply session temperature override', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createChatModel(plugin, { temperature: 0.2 });

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.temperature).toBe(0.2);
		});

		it('should apply session topP override', () => {
			const plugin = createMockPlugin();
			ModelClientFactory.createChatModel(plugin, { topP: 0.5 });

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.topP).toBe(0.5);
		});

		it('should not override temperature when session config omits it', () => {
			const plugin = createMockPlugin({ temperature: 0.8 });
			ModelClientFactory.createChatModel(plugin, { topP: 0.5 });

			const config = MockGeminiClient.mock.calls[0][0];
			// Temperature should come from settings (0.8), not be overridden
			expect(config.temperature).toBe(0.8);
		});
	});

	describe('createCustom', () => {
		it('should create a GeminiClient with provided config', () => {
			const config = {
				apiKey: 'custom-key',
				model: 'custom-model',
				temperature: 0.5,
				topP: 0.9,
				streamingEnabled: false,
			};
			ModelClientFactory.createCustom(config as any);

			expect(MockGeminiClient).toHaveBeenCalledWith(config, undefined, undefined);
			expect(MockRetryDecorator).toHaveBeenCalledTimes(1);
		});

		it('should use default retry config when no plugin provided', () => {
			const config = { apiKey: 'key', model: 'model', temperature: 1, topP: 1, streamingEnabled: true };
			ModelClientFactory.createCustom(config as any);

			expect(MockRetryDecorator).toHaveBeenCalledWith(
				expect.anything(),
				{ maxRetries: 3, initialBackoffDelay: 1000 },
				undefined
			);
		});

		it('should use plugin retry config when plugin is provided', () => {
			const plugin = createMockPlugin({ maxRetries: 10, initialBackoffDelay: 5000 });
			const config = { apiKey: 'key', model: 'model', temperature: 1, topP: 1, streamingEnabled: true };
			ModelClientFactory.createCustom(config as any, undefined, plugin);

			expect(MockRetryDecorator).toHaveBeenCalledWith(
				expect.anything(),
				{ maxRetries: 10, initialBackoffDelay: 5000 },
				plugin.logger
			);
		});
	});

	describe('convenience methods', () => {
		it('createSummaryModel should use SUMMARY use case', () => {
			const plugin = createMockPlugin({ summaryModelName: 'summary-model' });
			ModelClientFactory.createSummaryModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('summary-model');
		});

		it('createCompletionsModel should use COMPLETIONS use case', () => {
			const plugin = createMockPlugin({ completionsModelName: 'completions-model' });
			ModelClientFactory.createCompletionsModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('completions-model');
		});

		it('createRewriteModel should use REWRITE use case', () => {
			const plugin = createMockPlugin({ chatModelName: 'rewrite-model' });
			ModelClientFactory.createRewriteModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('rewrite-model');
		});

		it('createSearchModel should use SEARCH use case', () => {
			const plugin = createMockPlugin({ chatModelName: 'search-model' });
			ModelClientFactory.createSearchModel(plugin);

			const config = MockGeminiClient.mock.calls[0][0];
			expect(config.model).toBe('search-model');
		});
	});
});
