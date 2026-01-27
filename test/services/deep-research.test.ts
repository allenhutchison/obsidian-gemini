import { DeepResearchService, DeepResearchParams } from '../../src/services/deep-research';
import { TFile } from 'obsidian';

// Mock obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	TFile: class TFile {
		path: string = '';
		name: string = '';
	},
}));

// Mock ResearchManager and ReportGenerator from gemini-utils
const mockStartResearch = jest.fn();
const mockPoll = jest.fn();
const mockCancel = jest.fn();
const mockGenerateMarkdown = jest.fn();

jest.mock('@allenhutchison/gemini-utils', () => ({
	ResearchManager: jest.fn().mockImplementation(() => ({
		startResearch: mockStartResearch,
		poll: mockPoll,
		cancel: mockCancel,
	})),
	ReportGenerator: jest.fn().mockImplementation(() => ({
		generateMarkdown: mockGenerateMarkdown,
	})),
}));

// Mock Google GenAI
jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn().mockImplementation(() => ({})),
}));

describe('DeepResearchService', () => {
	let service: DeepResearchService;
	let mockPlugin: any;
	let mockVault: any;
	let mockLogger: any;
	let mockRagIndexing: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();
		mockStartResearch.mockClear();
		mockPoll.mockClear();
		mockCancel.mockClear();
		mockGenerateMarkdown.mockClear();

		// Setup mock logger
		mockLogger = {
			log: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};

		// Setup mock vault
		mockVault = {
			getAbstractFileByPath: jest.fn(),
			modify: jest.fn(),
			create: jest.fn(),
		};

		// Setup mock RAG indexing
		mockRagIndexing = {
			getStoreName: jest.fn().mockReturnValue('stores/test-store'),
		};

		// Setup mock plugin
		mockPlugin = {
			app: {
				vault: mockVault,
			},
			settings: {
				apiKey: 'test-api-key',
			},
			logger: mockLogger,
			ragIndexing: mockRagIndexing,
		};

		service = new DeepResearchService(mockPlugin);
	});

	describe('conductResearch', () => {
		it('should throw error if API key is not configured', async () => {
			mockPlugin.settings.apiKey = '';

			const params: DeepResearchParams = {
				topic: 'Test Topic',
			};

			await expect(service.conductResearch(params)).rejects.toThrow('Google API key not configured');
		});

		it('should conduct research with default scope (both)', async () => {
			// Mock successful research
			mockStartResearch.mockResolvedValue({
				id: 'interaction-123',
				status: 'in_progress',
			});
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [
					{
						type: 'text',
						text: 'Research results here',
						annotations: [{ source: 'https://example.com' }],
					},
				],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\nResearch results here\n');

			const params: DeepResearchParams = {
				topic: 'AI Research',
			};

			const result = await service.conductResearch(params);

			expect(result.topic).toBe('AI Research');
			expect(result.report).toContain('AI Research');
			expect(result.sourceCount).toBe(1);
			expect(mockStartResearch).toHaveBeenCalledWith({
				input: 'AI Research',
				fileSearchStoreNames: ['stores/test-store'],
			});
			expect(mockLogger.log).toHaveBeenCalled();
		});

		it('should conduct research with web_only scope', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const params: DeepResearchParams = {
				topic: 'Test',
				scope: 'web_only',
			};

			await service.conductResearch(params);

			expect(mockStartResearch).toHaveBeenCalledWith({
				input: 'Test',
				fileSearchStoreNames: undefined,
			});
		});

		it('should conduct research with vault_only scope', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const params: DeepResearchParams = {
				topic: 'Test',
				scope: 'vault_only',
			};

			await service.conductResearch(params);

			expect(mockStartResearch).toHaveBeenCalledWith({
				input: 'Test',
				fileSearchStoreNames: ['stores/test-store'],
			});
		});

		it('should throw error for vault_only scope when RAG is not configured', async () => {
			mockRagIndexing.getStoreName.mockReturnValue(null);

			const params: DeepResearchParams = {
				topic: 'Test',
				scope: 'vault_only',
			};

			await expect(service.conductResearch(params)).rejects.toThrow(
				'Vault-only research requires RAG indexing to be enabled and configured'
			);
		});

		it('should fall back to web-only when RAG is not configured with default scope', async () => {
			mockRagIndexing.getStoreName.mockReturnValue(null);
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const params: DeepResearchParams = {
				topic: 'Test',
			};

			await service.conductResearch(params);

			expect(mockStartResearch).toHaveBeenCalledWith({
				input: 'Test',
				fileSearchStoreNames: undefined,
			});
		});

		it('should save report to file if outputFile is specified', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const mockFile = new TFile();
			mockFile.path = 'test-report.md';
			mockVault.create.mockResolvedValue(mockFile);

			const params: DeepResearchParams = {
				topic: 'Test',
				outputFile: 'test-report.md',
			};

			const result = await service.conductResearch(params);

			expect(mockVault.create).toHaveBeenCalledWith('test-report.md', expect.any(String));
			expect(result.outputFile).toBe(mockFile);
		});

		it('should modify existing file if it exists', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const mockFile = new TFile();
			mockFile.path = 'existing-report.md';
			mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
			mockVault.modify.mockResolvedValue(undefined);

			const params: DeepResearchParams = {
				topic: 'Test',
				outputFile: 'existing-report.md',
			};

			await service.conductResearch(params);

			expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expect.any(String));
			expect(mockVault.create).not.toHaveBeenCalled();
		});

		it('should handle failed research status', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'failed',
				error: { message: 'Research quota exceeded' },
			});

			const params: DeepResearchParams = {
				topic: 'Test',
			};

			await expect(service.conductResearch(params)).rejects.toThrow('Research failed: Research quota exceeded');
		});

		it('should handle cancelled research status', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'cancelled',
			});

			const params: DeepResearchParams = {
				topic: 'Test',
			};

			await expect(service.conductResearch(params)).rejects.toThrow('Research was cancelled');
		});

		it('should return null outputFile if save fails', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');
			mockVault.create.mockRejectedValue(new Error('Save failed'));

			const params: DeepResearchParams = {
				topic: 'Test',
				outputFile: 'test.md',
			};

			const result = await service.conductResearch(params);

			expect(result.outputFile).toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalledWith('DeepResearch: Failed to save report:', expect.any(Error));
		});
	});

	describe('cancelResearch', () => {
		it('should cancel ongoing research', async () => {
			// Start research first
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockImplementation(
				() =>
					new Promise((resolve) => {
						// Simulate long-running research
						setTimeout(() => resolve({ id: 'interaction-123', status: 'completed', outputs: [] }), 10000);
					})
			);
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			// Start research but don't await
			void service.conductResearch({ topic: 'Test' });

			// Wait a bit for research to start
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Cancel
			await service.cancelResearch();

			expect(mockCancel).toHaveBeenCalledWith('interaction-123');
		});

		it('should not call cancel if no research is in progress', async () => {
			await service.cancelResearch();

			expect(mockCancel).not.toHaveBeenCalled();
		});
	});

	describe('isResearching', () => {
		it('should return false when no research is in progress', () => {
			expect(service.isResearching()).toBe(false);
		});
	});

	describe('report formatting', () => {
		it('should include topic and date in report', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [{ type: 'text', text: 'Content here' }],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\nContent here\n');

			const params: DeepResearchParams = {
				topic: 'Test Topic',
			};

			const result = await service.conductResearch(params);

			expect(result.report).toContain('# Test Topic');
			expect(result.report).toContain('*Generated on');
		});

		it('should count unique sources from annotations', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [
					{
						type: 'text',
						text: 'Content',
						annotations: [
							{ source: 'https://source1.com' },
							{ source: 'https://source2.com' },
							{ source: 'https://source1.com' }, // Duplicate
						],
					},
					{
						type: 'text',
						text: 'More content',
						annotations: [{ source: 'https://source3.com' }],
					},
				],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const result = await service.conductResearch({ topic: 'Test' });

			expect(result.sourceCount).toBe(3); // Unique sources
		});

		it('should handle outputs without annotations', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				outputs: [{ type: 'text', text: 'Content without sources' }],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const result = await service.conductResearch({ topic: 'Test' });

			expect(result.sourceCount).toBe(0);
		});
	});
});
