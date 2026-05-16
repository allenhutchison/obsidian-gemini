import { GeminiSummary } from '../src/summary';
import type ObsidianGemini from '../src/main';

const { MockTFile, mockSummaryModel } = vi.hoisted(() => {
	class MockTFile {
		path = 'notes/note.md';
		stat = { mtime: 1000 };
	}
	return {
		MockTFile,
		mockSummaryModel: {
			generateModelResponse: vi.fn(),
		},
	};
});

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('obsidian')),
	TFile: MockTFile,
	Notice: vi.fn(),
}));

vi.mock('../src/api', () => ({
	ModelClientFactory: {
		createSummaryModel: vi.fn().mockReturnValue(mockSummaryModel),
	},
}));

vi.mock('../src/prompts', () => {
	class MockGeminiPrompts {
		summaryPrompt = vi.fn().mockReturnValue('rendered summary prompt text');
	}
	return {
		GeminiPrompts: MockGeminiPrompts,
	};
});

import { Notice, TFile } from 'obsidian';

describe('GeminiSummary', () => {
	let summaryService: GeminiSummary;
	let mockPlugin: any;
	let mockFile: TFile;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFile = new MockTFile() as unknown as TFile;

		mockPlugin = {
			gfile: {
				getActiveFile: vi.fn().mockReturnValue(mockFile),
			},
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('file content text'),
				},
				fileManager: {
					processFrontMatter: vi.fn().mockImplementation(async (file, cb) => {
						const frontmatter = {};
						cb(frontmatter);
						return frontmatter;
					}),
				},
			},
			settings: {
				summaryFrontmatterKey: 'summary_key',
			},
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
			},
			addCommand: vi.fn(),
		};

		summaryService = new GeminiSummary(mockPlugin as unknown as ObsidianGemini);
	});

	describe('summarizeActiveFile', () => {
		test('shows error Notice when no active file is open', async () => {
			mockPlugin.gfile.getActiveFile.mockReturnValue(null);

			await summaryService.summarizeActiveFile();

			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				'No active file to summarize. Please open a markdown file first.',
				undefined
			);
			expect(Notice).toHaveBeenCalledWith('No active file to summarize. Please open a markdown file first.');
		});

		test('calls summarizeFile and shows success Notice on success', async () => {
			mockSummaryModel.generateModelResponse.mockResolvedValue({ markdown: 'doc summary' });

			await summaryService.summarizeActiveFile();

			expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);
			expect(mockPlugin.app.fileManager.processFrontMatter).toHaveBeenCalled();
			expect(Notice).toHaveBeenCalledWith('Summary added to frontmatter successfully!');
		});

		test('shows error Notice when summarizeFile throws', async () => {
			mockPlugin.app.vault.read.mockRejectedValue(new Error('read failure'));

			await summaryService.summarizeActiveFile();

			expect(mockPlugin.logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to generate summary:'),
				expect.any(Error)
			);
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Failed to generate summary:'));
		});
	});

	describe('summarizeFile', () => {
		test('throws an error if the file content is empty', async () => {
			mockPlugin.app.vault.read.mockResolvedValue('');

			await expect(summaryService.summarizeFile(mockFile)).rejects.toThrow(
				'File "notes/note.md" is empty or unreadable'
			);
		});

		test('calls summary model API, parses frontmatter, and returns summary', async () => {
			mockSummaryModel.generateModelResponse.mockResolvedValue({ markdown: 'model generated summary' });
			const processFrontMatterSpy = mockPlugin.app.fileManager.processFrontMatter;

			const result = await summaryService.summarizeFile(mockFile);

			expect(result).toBe('model generated summary');
			expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);
			expect(mockSummaryModel.generateModelResponse).toHaveBeenCalledWith({
				prompt: 'rendered summary prompt text',
			});

			expect(processFrontMatterSpy).toHaveBeenCalledWith(mockFile, expect.any(Function));

			// Verify callback mutates frontmatter with custom settings key
			const callback = processFrontMatterSpy.mock.calls[0][1];
			const frontmatter: Record<string, any> = {};
			callback(frontmatter);
			expect(frontmatter.summary_key).toBe('model generated summary');
		});
	});

	describe('setupSummarizationCommand', () => {
		test('registers the command with obsidian', async () => {
			await summaryService.setupSummarizationCommand();
			expect(mockPlugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'gemini-scribe-summarize-active-file',
					name: 'Summarize Active File',
					callback: expect.any(Function),
				})
			);
		});
	});
});
