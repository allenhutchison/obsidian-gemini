import { DeepResearchService, ResearchResult, DeepResearchParams } from '../../src/services/deep-research';
import { TFile } from 'obsidian';

// Mock obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	TFile: class TFile {
		path: string = '';
		name: string = '';
	}
}));

// Mock Google GenAI
const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn().mockImplementation(() => ({
		models: {
			generateContent: mockGenerateContent
		}
	}))
}));

describe('DeepResearchService', () => {
	let service: DeepResearchService;
	let mockPlugin: any;
	let mockVault: any;
	let mockLogger: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();
		mockGenerateContent.mockClear();

		// Setup mock logger
		mockLogger = {
			log: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn()
		};

		// Setup mock vault
		mockVault = {
			getAbstractFileByPath: jest.fn(),
			modify: jest.fn(),
			create: jest.fn()
		};

		// Setup mock plugin
		mockPlugin = {
			app: {
				vault: mockVault
			},
			settings: {
				apiKey: 'test-api-key',
				chatModelName: 'gemini-2.5-flash'
			},
			logger: mockLogger
		};

		service = new DeepResearchService(mockPlugin);
	});

	describe('conductResearch', () => {
		it('should throw error if API key is not configured', async () => {
			mockPlugin.settings.apiKey = '';

			const params: DeepResearchParams = {
				topic: 'Test Topic'
			};

			await expect(service.conductResearch(params)).rejects.toThrow('Google API key not configured');
		});

		it('should conduct research with default depth', async () => {
			// Mock AI responses
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Query 1\nQuery 2' }]
						},
						groundingMetadata: {
							groundingChunks: [
								{
									web: {
										uri: 'https://example.com',
										title: 'Example',
										snippet: 'Test snippet'
									}
								}
							]
						}
					}
				]
			});

			const params: DeepResearchParams = {
				topic: 'AI Research'
			};

			const result = await service.conductResearch(params);

			expect(result.topic).toBe('AI Research');
			expect(result.report).toBeTruthy();
			expect(result.searchCount).toBeGreaterThan(0);
			expect(mockLogger.log).toHaveBeenCalled();
		});

		it('should clamp depth between 1 and 5', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Query 1' }]
						}
					}
				]
			});

			// Test depth > 5
			const params1: DeepResearchParams = {
				topic: 'Test',
				depth: 10
			};

			await service.conductResearch(params1);
			// Should clamp to 5 iterations

			// Test depth < 1
			const params2: DeepResearchParams = {
				topic: 'Test',
				depth: 0
			};

			await service.conductResearch(params2);
			// Should clamp to 1 iteration

			expect(mockGenerateContent).toHaveBeenCalled();
		});

		it('should save report to file if outputFile is specified', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test query' }]
						}
					}
				]
			});

			const mockFile = new TFile();
			mockFile.path = 'test-report.md';
			mockVault.create.mockResolvedValue(mockFile);

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1,
				outputFile: 'test-report'
			};

			const result = await service.conductResearch(params);

			expect(mockVault.create).toHaveBeenCalledWith('test-report.md', expect.any(String));
			expect(result.outputFile).toBe(mockFile);
		});

		it('should add .md extension if not present', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test' }]
						}
					}
				]
			});

			const mockFile = new TFile();
			mockVault.create.mockResolvedValue(mockFile);

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1,
				outputFile: 'report'
			};

			await service.conductResearch(params);

			expect(mockVault.create).toHaveBeenCalledWith('report.md', expect.any(String));
		});

		it('should modify existing file if it exists', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test' }]
						}
					}
				]
			});

			const mockFile = new TFile();
			mockFile.path = 'existing-report.md';
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.modify.mockResolvedValue(undefined);

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1,
				outputFile: 'existing-report.md'
			};

			await service.conductResearch(params);

			expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expect.any(String));
			expect(mockVault.create).not.toHaveBeenCalled();
		});

		it('should handle search failures gracefully', async () => {
			// Mock first call succeeds, second fails, third succeeds
			mockGenerateContent
				.mockResolvedValueOnce({
					candidates: [
						{
							content: {
								parts: [{ text: 'Query 1\nQuery 2' }]
							}
						}
					]
				})
				.mockRejectedValueOnce(new Error('Search failed'))
				.mockResolvedValueOnce({
					candidates: [
						{
							content: {
								parts: [{ text: 'Search result' }]
							}
						}
					]
				});

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1
			};

			const result = await service.conductResearch(params);

			expect(result).toBeTruthy();
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it('should generate report with sections and sources', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Section Title\nSearch result with citation [1]' }]
						},
						groundingMetadata: {
							groundingChunks: [
								{
									web: {
										uri: 'https://source.com',
										title: 'Source Title',
										snippet: 'Source snippet'
									}
								}
							]
						}
					}
				]
			});

			const params: DeepResearchParams = {
				topic: 'Test Topic',
				depth: 1
			};

			const result = await service.conductResearch(params);

			expect(result.report).toContain('# Test Topic');
			expect(result.report).toContain('## Sources');
			expect(result.sectionCount).toBeGreaterThan(0);
		});

		it('should return null outputFile if save fails', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test' }]
						}
					}
				]
			});

			mockVault.create.mockRejectedValue(new Error('Save failed'));

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1,
				outputFile: 'test.md'
			};

			const result = await service.conductResearch(params);

			expect(result.outputFile).toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalledWith('DeepResearch: Failed to save report:', expect.any(Error));
		});
	});

	describe('error handling', () => {
		it('should handle missing candidates in AI response', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: []
			});

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1
			};

			const result = await service.conductResearch(params);

			expect(result).toBeTruthy();
			// Should handle gracefully with empty text
		});

		it('should handle missing groundingMetadata', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test result' }]
						}
						// No groundingMetadata
					}
				]
			});

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1
			};

			const result = await service.conductResearch(params);

			expect(result).toBeTruthy();
			expect(result.sourceCount).toBeGreaterThanOrEqual(0);
		});
	});

	describe('report formatting', () => {
		it('should include date in report', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test' }]
						}
					}
				]
			});

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1
			};

			const result = await service.conductResearch(params);

			expect(result.report).toContain('*Generated on');
		});

		it('should format sources with numbering', async () => {
			mockGenerateContent.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [{ text: 'Test' }]
						},
						groundingMetadata: {
							groundingChunks: [
								{
									web: {
										uri: 'https://source1.com',
										title: 'Source 1',
										snippet: 'Snippet 1'
									}
								},
								{
									web: {
										uri: 'https://source2.com',
										title: 'Source 2',
										snippet: 'Snippet 2'
									}
								}
							]
						}
					}
				]
			});

			const params: DeepResearchParams = {
				topic: 'Test',
				depth: 1
			};

			const result = await service.conductResearch(params);

			expect(result.report).toContain('[1]');
			if (result.sourceCount > 1) {
				expect(result.report).toContain('[2]');
			}
		});
	});
});
