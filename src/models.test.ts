import {
	getOllamaModels,
	getDefaultModelForRole,
	getUpdatedModelSettings,
	OllamaModel,
	GEMINI_MODELS,
	ModelRole
} from './models';
import ObsidianGemini from '../main';
import { ApiProvider } from './api/api-factory';
import { OllamaApi } from './api/implementations/ollama-api';

// Mock OllamaApi
jest.mock('./api/implementations/ollama-api');

// Mock console.warn and console.error to avoid polluting test output
global.console.warn = jest.fn();
global.console.error = jest.fn();

const mockDefaultGeminiChatModel = GEMINI_MODELS.find(m => m.defaultForRoles?.includes('chat'))?.value || GEMINI_MODELS[0].value;
const mockDefaultGeminiSummaryModel = GEMINI_MODELS.find(m => m.defaultForRoles?.includes('summary'))?.value || GEMINI_MODELS[0].value;
const mockDefaultGeminiCompletionsModel = GEMINI_MODELS.find(m => m.defaultForRoles?.includes('completions'))?.value || GEMINI_MODELS[0].value;


describe('Ollama Integration in models.ts', () => {
	let mockPlugin: ObsidianGemini;
	let mockOllamaApiInstance: jest.Mocked<OllamaApi>;

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks();
		(global.console.warn as jest.Mock).mockClear();
		(global.console.error as jest.Mock).mockClear();

		// Setup mock plugin
		mockPlugin = {
			settings: {
				apiProvider: ApiProvider.OLLAMA,
				ollamaBaseUrl: 'http://localhost:11434',
				apiKey: 'test-key',
				chatModelName: 'ollama-chat',
				summaryModelName: 'ollama-summary',
				completionsModelName: 'ollama-completions',
				sendContext: false,
				maxContextDepth: 2,
				searchGrounding: false,
				summaryFrontmatterKey: 'summary',
				userName: 'User',
				rewriteFiles: false,
				chatHistory: false,
				historyFolder: 'gemini-scribe',
				showModelPicker: false,
				debugMode: false,
				maxRetries: 3,
				initialBackoffDelay: 1000,
			},
			// Mock other plugin methods/properties if needed by the functions under test
		} as unknown as ObsidianGemini; // Type assertion for simplicity

		// Setup OllamaApi mock instance
		// The OllamaApi constructor is mocked by jest.mock at the top
		// We can then access the mock implementation to control its methods
		mockOllamaApiInstance = new OllamaApi(mockPlugin) as jest.Mocked<OllamaApi>;
		(OllamaApi as jest.Mock).mockImplementation(() => mockOllamaApiInstance);
	});

	describe('getOllamaModels', () => {
		it('should return transformed models when OllamaApi.listModels succeeds', async () => {
			const mockApiResponse = {
				models: [
					{ name: 'model1:latest', modified_at: 'sometime', size: 123, details: { family: 'llama' } },
					{ name: 'model2:7b', modified_at: 'sometime', size: 456, details: { family: 'mistral' } },
				],
			};
			mockOllamaApiInstance.listModels.mockResolvedValue(mockApiResponse as any);

			const result = await getOllamaModels(mockPlugin);

			expect(OllamaApi).toHaveBeenCalledWith(mockPlugin);
			expect(mockOllamaApiInstance.listModels).toHaveBeenCalledTimes(1);
			expect(result).toEqual([
				{ name: 'model1:latest', value: 'model1:latest', details: { family: 'llama' } },
				{ name: 'model2:7b', value: 'model2:7b', details: { family: 'mistral' } },
			]);
		});

		it('should return an empty array when OllamaApi.listModels returns no models', async () => {
			const mockApiResponse = { models: [] };
			mockOllamaApiInstance.listModels.mockResolvedValue(mockApiResponse as any);

			const result = await getOllamaModels(mockPlugin);
			expect(result).toEqual([]);
		});

		it('should return an empty array when OllamaApi.listModels returns null models property', async () => {
			const mockApiResponse = { models: null }; // Or undefined
			mockOllamaApiInstance.listModels.mockResolvedValue(mockApiResponse as any);

			const result = await getOllamaModels(mockPlugin);
			expect(result).toEqual([]);
		});


		it('should return null and log a warning when OllamaApi.listModels throws an error', async () => {
			const error = new Error('Ollama server not available');
			mockOllamaApiInstance.listModels.mockRejectedValue(error);

			const result = await getOllamaModels(mockPlugin);

			expect(result).toBeNull();
			expect(console.warn).toHaveBeenCalledWith(
				"ObsidianGemini: Could not fetch Ollama models. Please ensure Ollama is running and the Base URL is correct in settings.",
				error
			);
		});
	});

	describe('getDefaultModelForRole', () => {
		describe('Ollama Provider', () => {
			beforeEach(() => {
				mockPlugin.settings.apiProvider = ApiProvider.OLLAMA;
			});

			it('should return the first model from getOllamaModels if models are available', async () => {
				const mockOllamaModels: OllamaModel[] = [
					{ name: 'ollama-model-1', value: 'ollama-model-1' },
					{ name: 'ollama-model-2', value: 'ollama-model-2' },
				];
				// Instead of mocking getOllamaModels directly, we ensure the underlying listModels provides the data
				mockOllamaApiInstance.listModels.mockResolvedValue({ models: mockOllamaModels.map(m => ({name: m.value, details: {}})) } as any);


				const result = await getDefaultModelForRole('chat', mockPlugin);
				expect(result).toBe('ollama-model-1');
			});

			it('should return null if getOllamaModels returns an empty list', async () => {
				mockOllamaApiInstance.listModels.mockResolvedValue({ models: [] } as any);
				const result = await getDefaultModelForRole('chat', mockPlugin);
				expect(result).toBeNull();
				expect(console.warn).toHaveBeenCalledWith(
					"ObsidianGemini: No Ollama models found or error fetching them. Cannot set default for role 'chat'."
				);
			});

			it('should return null if getOllamaModels returns null (error case)', async () => {
				mockOllamaApiInstance.listModels.mockRejectedValue(new Error('fetch error'));
				const result = await getDefaultModelForRole('chat', mockPlugin);
				expect(result).toBeNull();
				expect(console.warn).toHaveBeenCalledWith(
					"ObsidianGemini: No Ollama models found or error fetching them. Cannot set default for role 'chat'."
				);
			});
		});

		describe('Gemini Provider', () => {
			beforeEach(() => {
				mockPlugin.settings.apiProvider = ApiProvider.GEMINI;
			});

			it('should return the correct default Gemini model for "chat"', async () => {
				const result = await getDefaultModelForRole('chat', mockPlugin);
				expect(result).toBe(mockDefaultGeminiChatModel);
			});

			it('should return the correct default Gemini model for "summary"', async () => {
				const result = await getDefaultModelForRole('summary', mockPlugin);
				expect(result).toBe(mockDefaultGeminiSummaryModel);
			});

			it('should return the correct default Gemini model for "completions"', async () => {
				const result = await getDefaultModelForRole('completions', mockPlugin);
				expect(result).toBe(mockDefaultGeminiCompletionsModel);
			});

			it('should return the first Gemini model if no specific role default is found', async () => {
				// Temporarily remove default roles to test fallback
				const originalGeminiModels = [...GEMINI_MODELS];
				(GEMINI_MODELS as any) = [{ value: 'gemini-fallback', label: 'Fallback Model' }]; // No defaultForRoles

				const result = await getDefaultModelForRole('chat', mockPlugin);
				expect(result).toBe('gemini-fallback');
				expect(console.warn).toHaveBeenCalledWith(
					"ObsidianGemini: No default Gemini model specified for role 'chat'. Falling back to the first model in GEMINI_MODELS: Fallback Model"
				);

				// Restore original models
				(GEMINI_MODELS as any) = originalGeminiModels;
			});

			it('should return null if GEMINI_MODELS is empty (edge case)', async () => {
				const originalGeminiModels = [...GEMINI_MODELS];
				(GEMINI_MODELS as any) = []; // Empty array

				const result = await getDefaultModelForRole('chat', mockPlugin);
				expect(result).toBeNull();
				expect(console.error).toHaveBeenCalledWith(
					'ObsidianGemini: CRITICAL: GEMINI_MODELS is empty. Cannot determine a fallback model.'
				);
				// Restore original models
				(GEMINI_MODELS as any) = originalGeminiModels;
			});
		});
	});

	describe('getUpdatedModelSettings', () => {
		describe('Ollama Provider', () => {
			beforeEach(() => {
				mockPlugin.settings.apiProvider = ApiProvider.OLLAMA;
				// Mock getOllamaModels to return a fixed list for these tests
				const ollamaModelsResponse = [
					{ name: 'ollama-default', value: 'ollama-default' },
					{ name: 'ollama-another', value: 'ollama-another' },
				];
				mockOllamaApiInstance.listModels.mockResolvedValue({ models: ollamaModelsResponse.map(m => ({name: m.value, details: {}})) } as any);
			});

			it('should update invalid model names to the default Ollama model', async () => {
				const currentSettings = {
					...mockPlugin.settings,
					chatModelName: 'invalid-chat',
					summaryModelName: 'invalid-summary',
					completionsModelName: 'invalid-completions',
				};

				const result = await getUpdatedModelSettings(currentSettings, mockPlugin);

				expect(result.settingsChanged).toBe(true);
				expect(result.updatedSettings.chatModelName).toBe('ollama-default');
				expect(result.updatedSettings.summaryModelName).toBe('ollama-default');
				expect(result.updatedSettings.completionsModelName).toBe('ollama-default');
				expect(result.changedSettingsInfo).toEqual(expect.arrayContaining([
					"Chat model: 'invalid-chat' -> 'ollama-default'",
					"Summary model: 'invalid-summary' -> 'ollama-default'",
					"Completions model: 'invalid-completions' -> 'ollama-default'",
				]));
			});

			it('should not change settings if model names are valid Ollama models', async () => {
				const currentSettings = {
					...mockPlugin.settings,
					chatModelName: 'ollama-default',
					summaryModelName: 'ollama-another',
					completionsModelName: 'ollama-default',
				};

				const result = await getUpdatedModelSettings(currentSettings, mockPlugin);

				expect(result.settingsChanged).toBe(false);
				expect(result.changedSettingsInfo.length).toBe(0);
				expect(result.updatedSettings.chatModelName).toBe('ollama-default');
			});

			it('should update to null and log if Ollama models are unavailable during update for a previously set model', async () => {
				mockOllamaApiInstance.listModels.mockResolvedValue({ models: [] } as any); // No models available
				const currentSettings = {
					...mockPlugin.settings,
					chatModelName: 'some-ollama-model-that-was-set-before', // This model was valid before
				};
				const result = await getUpdatedModelSettings(currentSettings, mockPlugin);
				expect(result.settingsChanged).toBe(true);
				expect(result.updatedSettings.chatModelName).toBeNull(); // Default model is null when no models are available
				expect(result.changedSettingsInfo).toEqual(expect.arrayContaining([
					// This message reflects that the setting was changed from its previous value to 'null'
					// because no valid default could be determined from an empty list.
					"Chat model: 'some-ollama-model-that-was-set-before' -> 'null'. Ollama models unavailable.",
				]));
			});
		});

		describe('Gemini Provider', () => {
			beforeEach(() => {
				mockPlugin.settings.apiProvider = ApiProvider.GEMINI;
			});

			it('should update invalid model names to default Gemini models', async () => {
				const currentSettings = {
					...mockPlugin.settings,
					chatModelName: 'invalid-gemini-chat',
					summaryModelName: 'invalid-gemini-summary',
					completionsModelName: 'invalid-gemini-completions',
				};

				const result = await getUpdatedModelSettings(currentSettings, mockPlugin);

				expect(result.settingsChanged).toBe(true);
				expect(result.updatedSettings.chatModelName).toBe(mockDefaultGeminiChatModel);
				expect(result.updatedSettings.summaryModelName).toBe(mockDefaultGeminiSummaryModel);
				expect(result.updatedSettings.completionsModelName).toBe(mockDefaultGeminiCompletionsModel);
			});

			it('should not change settings if model names are valid Gemini models', async () => {
				const currentSettings = {
					...mockPlugin.settings,
					chatModelName: mockDefaultGeminiChatModel,
					summaryModelName: mockDefaultGeminiSummaryModel,
					completionsModelName: mockDefaultGeminiCompletionsModel,
				};

				const result = await getUpdatedModelSettings(currentSettings, mockPlugin);
				expect(result.settingsChanged).toBe(false);
			});
		});
	});
});
