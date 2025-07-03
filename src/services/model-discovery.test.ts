import { ModelDiscoveryService, GoogleModel, ModelDiscoveryResult } from './model-discovery';

// Mock ObsidianGemini plugin
const mockPlugin = {
	settings: {
		apiKey: 'test-api-key',
	},
	loadData: jest.fn(),
	saveData: jest.fn(),
} as any;

// Mock fetch globally
global.fetch = jest.fn();

// Mock sample Google models
const mockGoogleModels: GoogleModel[] = [
	{
		name: 'models/gemini-2.5-pro',
		displayName: 'Gemini 2.5 Pro',
		description: 'Latest Gemini Pro model',
		version: '001',
		inputTokenLimit: 1000000,
		outputTokenLimit: 8192,
		supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
	},
	{
		name: 'models/gemini-2.5-flash',
		displayName: 'Gemini 2.5 Flash',
		description: 'Fast Gemini model',
		version: '001',
		inputTokenLimit: 1000000,
		outputTokenLimit: 8192,
		supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
	},
	{
		name: 'models/gemini-vision-pro',
		displayName: 'Gemini Vision Pro',
		description: 'Vision-only model',
		version: '001',
		inputTokenLimit: 1000000,
		outputTokenLimit: 8192,
		supportedGenerationMethods: ['generateContent'],
	},
];

describe('ModelDiscoveryService', () => {
	let service: ModelDiscoveryService;

	beforeEach(() => {
		service = new ModelDiscoveryService(mockPlugin);
		jest.clearAllMocks();

		// Reset cache
		(service as any).cache = null;
	});

	describe('discoverModels', () => {
		it('should fetch models from API and cache results', async () => {
			const mockResponse = {
				ok: true,
				json: jest.fn().mockResolvedValue({
					models: mockGoogleModels,
				}),
			};
			(fetch as jest.Mock).mockResolvedValue(mockResponse);
			mockPlugin.saveData.mockResolvedValue(undefined);

			const result = await service.discoverModels();

			expect(result.success).toBe(true);
			expect(result.models).toHaveLength(2); // Vision model should be filtered out
			expect(result.models[0].name).toBe('models/gemini-2.5-pro');
			expect(result.models[1].name).toBe('models/gemini-2.5-flash');
			expect(mockPlugin.saveData).toHaveBeenCalled();
		});

		it('should return cached results if cache is valid and forceRefresh is false', async () => {
			const cachedResult: ModelDiscoveryResult = {
				models: [mockGoogleModels[0]],
				lastUpdated: Date.now() - 1000, // 1 second ago
				success: true,
			};
			(service as any).cache = cachedResult;

			const result = await service.discoverModels(false);

			expect(result).toBe(cachedResult);
			expect(fetch).not.toHaveBeenCalled();
		});

		it('should bypass cache when forceRefresh is true', async () => {
			const cachedResult: ModelDiscoveryResult = {
				models: [mockGoogleModels[0]],
				lastUpdated: Date.now() - 1000,
				success: true,
			};
			(service as any).cache = cachedResult;

			const mockResponse = {
				ok: true,
				json: jest.fn().mockResolvedValue({
					models: mockGoogleModels,
				}),
			};
			(fetch as jest.Mock).mockResolvedValue(mockResponse);

			const result = await service.discoverModels(true);

			expect(result).not.toBe(cachedResult);
			expect(fetch).toHaveBeenCalled();
		});

		it('should handle API errors gracefully', async () => {
			const mockResponse = {
				ok: false,
				status: 403,
				statusText: 'Forbidden',
			};
			(fetch as jest.Mock).mockResolvedValue(mockResponse);

			const result = await service.discoverModels();

			expect(result.success).toBe(false);
			expect(result.models).toEqual([]);
			expect(result.error).toContain('API request failed: 403 Forbidden');
		});

		it('should return cached models if API fails but cache exists', async () => {
			const cachedResult: ModelDiscoveryResult = {
				models: [mockGoogleModels[0]],
				lastUpdated: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago (stale)
				success: true,
			};
			(service as any).cache = cachedResult;

			(fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

			const result = await service.discoverModels();

			expect(result).toBe(cachedResult);
		});

		it('should throw error if API key is not configured', async () => {
			const serviceWithoutKey = new ModelDiscoveryService({
				...mockPlugin,
				settings: { apiKey: '' },
			});

			const result = await serviceWithoutKey.discoverModels();

			expect(result.success).toBe(false);
			expect(result.error).toBe('API key not configured');
		});

		it('should handle pagination correctly', async () => {
			const firstPageResponse = {
				ok: true,
				json: jest.fn().mockResolvedValue({
					models: [mockGoogleModels[0]],
					nextPageToken: 'page2-token',
				}),
			};
			const secondPageResponse = {
				ok: true,
				json: jest.fn().mockResolvedValue({
					models: [mockGoogleModels[1]],
				}),
			};
			// Mock detailed model responses
			const detailedModelResponse1 = {
				ok: true,
				json: jest.fn().mockResolvedValue({
					...mockGoogleModels[0],
					maxTemperature: 1.5,
					topP: 0.95,
				}),
			};
			const detailedModelResponse2 = {
				ok: true,
				json: jest.fn().mockResolvedValue({
					...mockGoogleModels[1],
					maxTemperature: 2.0,
					topP: 1.0,
				}),
			};

			(fetch as jest.Mock)
				.mockResolvedValueOnce(firstPageResponse)
				.mockResolvedValueOnce(secondPageResponse)
				.mockResolvedValueOnce(detailedModelResponse1)
				.mockResolvedValueOnce(detailedModelResponse2);

			const result = await service.discoverModels();

			// Should make 2 calls for pagination + 2 calls for detailed model info
			expect(fetch).toHaveBeenCalledTimes(4);
			expect(result.models).toHaveLength(2);
			// Verify that detailed information was fetched
			expect(result.models[0].maxTemperature).toBe(1.5);
			expect(result.models[1].maxTemperature).toBe(2.0);
		});
	});

	describe('isGenerativeModel', () => {
		it('should filter out vision-only models', () => {
			const isGenerative = (service as any).isGenerativeModel(mockGoogleModels[2]); // Vision model
			expect(isGenerative).toBe(false);
		});

		it('should include gemini models with generateContent support', () => {
			const isGenerative = (service as any).isGenerativeModel(mockGoogleModels[0]);
			expect(isGenerative).toBe(true);
		});

		it('should exclude non-gemini models', () => {
			const nonGeminiModel = {
				...mockGoogleModels[0],
				name: 'models/palm-2',
			};
			const isGenerative = (service as any).isGenerativeModel(nonGeminiModel);
			expect(isGenerative).toBe(false);
		});
	});

	describe('cache management', () => {
		it('should load cache from plugin data', async () => {
			const cachedData = {
				models: [mockGoogleModels[0]],
				lastUpdated: Date.now(),
				success: true,
			};
			mockPlugin.loadData.mockResolvedValue({
				modelDiscoveryCache: cachedData,
			});

			await service.loadCache();

			expect((service as any).cache).toEqual(cachedData);
		});

		it('should handle missing cache data', async () => {
			mockPlugin.loadData.mockResolvedValue({});

			await service.loadCache();

			expect((service as any).cache).toBeNull();
		});

		it('should clear cache when requested', () => {
			(service as any).cache = { models: [], lastUpdated: Date.now(), success: true };

			service.clearCache();

			expect((service as any).cache).toBeNull();
		});

		it('should report cache status correctly', () => {
			const now = Date.now();
			(service as any).cache = {
				models: [mockGoogleModels[0]],
				lastUpdated: now - 1000, // 1 second ago
				success: true,
			};

			const status = service.getCacheInfo();

			expect(status.hasCache).toBe(true);
			expect(status.isValid).toBe(true);
			expect(status.lastUpdated).toBe(now - 1000);
		});

		it('should detect stale cache', () => {
			(service as any).cache = {
				models: [mockGoogleModels[0]],
				lastUpdated: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
				success: true,
			};

			const status = service.getCacheInfo();

			expect(status.hasCache).toBe(true);
			expect(status.isValid).toBe(false);
		});
	});
});
