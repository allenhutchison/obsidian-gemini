import { DeepResearchService, DeepResearchParams } from '../../src/services/deep-research';
import { TFile } from 'obsidian';

// Mock obsidian
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
	TFile: class TFile {
		path: string = '';
		name: string = '';
	},
}));

// Mock ResearchManager and ReportGenerator from gemini-utils
const mockStartResearch = vi.fn();
const mockPoll = vi.fn();
const mockCancel = vi.fn();
const mockGenerateMarkdown = vi.fn();

vi.mock('@allenhutchison/gemini-utils', () => ({
	ResearchManager: vi.fn().mockImplementation(function () {
		return {
			startResearch: mockStartResearch,
			poll: mockPoll,
			cancel: mockCancel,
		};
	}),
	ReportGenerator: vi.fn().mockImplementation(function () {
		return {
			generateMarkdown: mockGenerateMarkdown,
		};
	}),
}));

// Mock Google GenAI with interactions structure for proxyFetch injection
vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(function () {
		return {
			interactions: {
				_client: {
					fetch: undefined,
				},
			},
		};
	}),
}));

describe('DeepResearchService', () => {
	let service: DeepResearchService;
	let mockPlugin: any;
	let mockVault: any;
	let mockLogger: any;
	let mockRagIndexing: any;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();
		mockStartResearch.mockClear();
		mockPoll.mockClear();
		mockCancel.mockClear();
		mockGenerateMarkdown.mockClear();

		// Setup mock logger
		mockLogger = {
			log: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};

		// Setup mock vault
		mockVault = {
			getAbstractFileByPath: vi.fn(),
			modify: vi.fn(),
			create: vi.fn(),
		};

		// Setup mock RAG indexing
		mockRagIndexing = {
			getStoreName: vi.fn().mockReturnValue('stores/test-store'),
		};

		// Setup mock plugin
		mockPlugin = {
			app: {
				vault: mockVault,
			},
			apiKey: 'test-api-key',
			settings: {},
			logger: mockLogger,
			ragIndexing: mockRagIndexing,
		};

		service = new DeepResearchService(mockPlugin);
	});

	describe('conductResearch', () => {
		it('should throw error if API key is not configured', async () => {
			mockPlugin.apiKey = '';

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
				steps: [
					{
						type: 'model_output',
						content: [
							{
								type: 'text',
								text: 'Research results here',
								annotations: [{ type: 'url_citation', url: 'https://example.com' }],
							},
						],
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
				steps: [],
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
				steps: [],
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
				steps: [],
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
				steps: [],
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
				steps: [],
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
				steps: [],
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
			// Create a controllable promise for the poll
			let pollResolve: (value: any) => void;
			const pollPromise = new Promise((resolve) => {
				pollResolve = resolve;
			});

			// Start research first
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockReturnValue(pollPromise);
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			// Start research but don't await - capture the promise to check later
			const researchPromise = service.conductResearch({ topic: 'Test' });

			// Wait for startResearch to complete and currentInteractionId to be set
			// Need to flush multiple promise microtasks due to retry wrapper
			await new Promise((resolve) => window.setTimeout(resolve, 0));

			// Cancel the research
			await service.cancelResearch();

			expect(mockCancel).toHaveBeenCalledWith('interaction-123');

			// Now resolve the poll to clean up - simulate cancelled status
			pollResolve!({ id: 'interaction-123', status: 'cancelled', outputs: [] });

			// The research should throw due to cancellation
			await expect(researchPromise).rejects.toThrow('Research was cancelled');
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
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Content here' }] }],
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
				steps: [
					{
						type: 'model_output',
						content: [
							{
								type: 'text',
								text: 'Content',
								annotations: [
									{ type: 'url_citation', url: 'https://source1.com' },
									{ type: 'url_citation', url: 'https://source2.com' },
									{ type: 'url_citation', url: 'https://source1.com' }, // Duplicate
								],
							},
							{
								type: 'text',
								text: 'More content',
								annotations: [{ type: 'url_citation', url: 'https://source3.com' }],
							},
						],
					},
				],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const result = await service.conductResearch({ topic: 'Test' });

			expect(result.sourceCount).toBe(3); // Unique sources
		});

		it('should aggregate sources across multiple model_output steps and ignore other step types', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				steps: [
					{ type: 'user_input', content: 'ignored' },
					{
						type: 'model_output',
						content: [
							{
								type: 'text',
								text: 'A',
								annotations: [{ type: 'url_citation', url: 'https://a.com' }],
							},
						],
					},
					{ type: 'function_call', name: 'ignored' },
					{
						type: 'model_output',
						content: [
							{
								type: 'text',
								text: 'B',
								annotations: [
									{ type: 'url_citation', url: 'https://b.com' },
									{ type: 'url_citation', url: 'https://a.com' }, // dedup across steps
								],
							},
						],
					},
				],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const result = await service.conductResearch({ topic: 'Test' });

			expect(result.sourceCount).toBe(2);
		});

		it('should handle outputs without annotations', async () => {
			mockStartResearch.mockResolvedValue({ id: 'interaction-123' });
			mockPoll.mockResolvedValue({
				id: 'interaction-123',
				status: 'completed',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Content without sources' }] }],
			});
			mockGenerateMarkdown.mockReturnValue('# Research Report\n\n');

			const result = await service.conductResearch({ topic: 'Test' });

			expect(result.sourceCount).toBe(0);
		});
	});

	describe('validateAndNormalizeFilePath (output-path validator)', () => {
		// Pin the state-folder allowlist behavior added in #724: Background-Tasks/
		// is the one allowed subtree under the plugin state folder; everything
		// else under it must still be rejected.
		const validate = (path: string): string => (service as any).validateAndNormalizeFilePath(path);

		beforeEach(() => {
			mockPlugin.settings.historyFolder = 'gemini-scribe';
		});

		it('allows a file under [state-folder]/Background-Tasks/', () => {
			expect(validate('gemini-scribe/Background-Tasks/2026-01-01 topic.md')).toBe(
				'gemini-scribe/Background-Tasks/2026-01-01 topic.md'
			);
		});

		it('rejects other subfolders under the state folder', () => {
			expect(() => validate('gemini-scribe/Skills/foo.md')).toThrow(/plugin state folder/);
			expect(() => validate('gemini-scribe/Agent-Sessions/foo.md')).toThrow(/plugin state folder/);
		});

		it('rejects the bare state folder', () => {
			expect(() => validate('gemini-scribe')).toThrow(/plugin state folder/);
		});

		it('rejects sibling-prefix paths that start with Background-Tasks but are not the subfolder', () => {
			// Without the trailing-slash check, "Background-Tasks-Other/foo" would
			// sneak past startsWith('Background-Tasks') — guard that.
			expect(() => validate('gemini-scribe/Background-Tasks-Other/foo.md')).toThrow(/plugin state folder/);
		});

		it('rejects paths inside .obsidian/', () => {
			expect(() => validate('.obsidian/snippets/foo.md')).toThrow(/protected system folder/);
		});

		it('allows arbitrary paths outside the state folder', () => {
			expect(validate('Notes/foo.md')).toBe('Notes/foo.md');
		});
	});
});
