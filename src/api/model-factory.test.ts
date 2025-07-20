import { ModelFactory, ModelType } from './model-factory';
import { ApiFactory } from './api-factory';
import { ApiProvider } from './index';
import ObsidianGemini from '../main';
import { SessionModelConfig } from '../types/agent';

// Mock the API factory
jest.mock('./api-factory');

describe('ModelFactory', () => {
	let mockPlugin: ObsidianGemini;
	let mockApi: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Create mock plugin
		mockPlugin = {
			settings: {
				apiProvider: ApiProvider.GEMINI,
				apiKey: 'test-key',
				chatModelName: 'gemini-2.5-pro',
				summaryModelName: 'gemini-2.5-flash',
				completionsModelName: 'gemini-2.5-flash-lite',
				temperature: 0.7,
				topP: 0.95,
				maxRetries: 3,
				initialBackoffDelay: 1000,
				searchGrounding: false,
				streamingEnabled: true,
			},
		} as ObsidianGemini;

		// Create mock API
		mockApi = {
			generateModelResponse: jest.fn(),
			generateStreamingResponse: jest.fn(),
		};

		// Mock ApiFactory
		(ApiFactory.createApiWithConfig as jest.Mock).mockReturnValue(mockApi);
		(ApiFactory.createConfigFromPlugin as jest.Mock).mockImplementation((plugin, overrides) => ({
			provider: plugin.settings.apiProvider,
			modelConfig: {
				apiKey: plugin.settings.apiKey,
				model: overrides?.modelConfig?.model || plugin.settings.chatModelName,
				temperature: overrides?.modelConfig?.temperature ?? plugin.settings.temperature,
				topP: overrides?.modelConfig?.topP ?? plugin.settings.topP,
			},
			retryConfig: {
				maxRetries: plugin.settings.maxRetries,
				initialBackoffDelay: plugin.settings.initialBackoffDelay,
			},
			features: {
				searchGrounding: plugin.settings.searchGrounding,
				streamingEnabled: plugin.settings.streamingEnabled,
			},
			...overrides,
		}));
	});

	describe('createModel', () => {
		it('should create a chat model with correct configuration', () => {
			const api = ModelFactory.createModel(mockPlugin, ModelType.CHAT);

			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-pro',
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(ApiFactory.createApiWithConfig).toHaveBeenCalled();
			expect(api).toBe(mockApi);
		});

		it('should create a summary model with correct configuration', () => {
			const api = ModelFactory.createModel(mockPlugin, ModelType.SUMMARY);

			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-flash',
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(api).toBe(mockApi);
		});

		it('should create a completions model with correct configuration', () => {
			const api = ModelFactory.createModel(mockPlugin, ModelType.COMPLETIONS);

			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-flash-lite',
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(api).toBe(mockApi);
		});

		it('should apply session configuration overrides', () => {
			const sessionConfig: SessionModelConfig = {
				model: 'gemini-2.5-pro-custom',
				temperature: 0.5,
				topP: 0.8,
			};

			const api = ModelFactory.createModel(mockPlugin, ModelType.CHAT, sessionConfig);

			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-pro-custom',
					temperature: 0.5,
					topP: 0.8,
				},
			});
			expect(api).toBe(mockApi);
		});
	});

	describe('convenience methods', () => {
		it('should create chat model using createChatModel', () => {
			const api = ModelFactory.createChatModel(mockPlugin);
			
			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-pro',
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(api).toBe(mockApi);
		});

		it('should create summary model using createSummaryModel', () => {
			const api = ModelFactory.createSummaryModel(mockPlugin);
			
			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-flash',
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(api).toBe(mockApi);
		});

		it('should create completions model using createCompletionsModel', () => {
			const api = ModelFactory.createCompletionsModel(mockPlugin);
			
			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-flash-lite',
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(api).toBe(mockApi);
		});

		it('should create rewrite model using summary model', () => {
			const api = ModelFactory.createRewriteModel(mockPlugin);
			
			expect(ApiFactory.createConfigFromPlugin).toHaveBeenCalledWith(mockPlugin, {
				modelConfig: {
					apiKey: 'test-key',
					model: 'gemini-2.5-flash', // Should use summary model
					temperature: 0.7,
					topP: 0.95,
				},
			});
			expect(api).toBe(mockApi);
		});
	});

	describe('createCustomModel', () => {
		it('should create model with custom configuration', () => {
			const customConfig = {
				provider: ApiProvider.GEMINI,
				modelConfig: {
					apiKey: 'custom-key',
					model: 'gemini-3.0-ultra',
					temperature: 0.3,
					topP: 0.9,
				},
				retryConfig: {
					maxRetries: 5,
					initialBackoffDelay: 2000,
				},
				features: {
					searchGrounding: true,
					streamingEnabled: false,
				},
			};

			const api = ModelFactory.createCustomModel(customConfig);

			expect(ApiFactory.createApiWithConfig).toHaveBeenCalledWith(customConfig);
			expect(api).toBe(mockApi);
		});
	});
});