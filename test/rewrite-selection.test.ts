import { SelectionRewriter } from '../src/rewrite-selection';
import type ObsidianGemini from '../src/main';

const { MockTFile, mockRewriteModel } = vi.hoisted(() => {
	class MockTFile {
		path = 'notes/file.md';
		stat = { mtime: 2000 };
	}
	return {
		MockTFile,
		mockRewriteModel: {
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
		createRewriteModel: vi.fn().mockReturnValue(mockRewriteModel),
	},
}));

vi.mock('../src/prompts', () => {
	class MockGeminiPrompts {
		selectionRewritePrompt = vi.fn().mockReturnValue('rendered selection prompt');
	}
	return {
		GeminiPrompts: MockGeminiPrompts,
	};
});

import { Notice, TFile } from 'obsidian';

describe('SelectionRewriter', () => {
	let rewriter: SelectionRewriter;
	let mockPlugin: any;
	let mockEditor: any;
	let mockFile: TFile;

	beforeEach(() => {
		vi.clearAllMocks();
		mockFile = new MockTFile() as unknown as TFile;

		mockEditor = {
			getCursor: vi.fn().mockImplementation((dir) => {
				if (dir === 'from') return { line: 1, ch: 0 };
				return { line: 1, ch: 10 };
			}),
			posToOffset: vi.fn().mockImplementation((pos) => {
				if (pos.line === 1 && pos.ch === 0) return 10;
				return 20;
			}),
			getValue: vi.fn().mockReturnValue('original document value'),
			replaceSelection: vi.fn(),
			setValue: vi.fn(),
		};

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('original file text'),
					modify: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
				},
			},
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
			},
		};

		rewriter = new SelectionRewriter(mockPlugin as unknown as ObsidianGemini);
	});

	describe('buildSelectionPrompt (via rewriteSelection)', () => {
		test('inserts selection markers into the full content when building prompt', async () => {
			mockRewriteModel.generateModelResponse.mockResolvedValue({ markdown: 'rewritten text' });

			await rewriter.rewriteSelection(mockEditor, 'selected', 'make friendly');

			// The prompt builder private function gets called
			const promptsInstance = (rewriter as any).prompts;
			expect(promptsInstance.selectionRewritePrompt).toHaveBeenCalledWith({
				selectedText: 'selected',
				instructions: 'make friendly',
				// 'original document value' was sliced from 0-10 and 20-end ('lue')
				documentWithMarkers: 'original d[SELECTION_START]selected[SELECTION_END]lue',
			});
		});
	});

	describe('rewriteSelection', () => {
		test('calls model API, replaces selection in editor, and shows Notice', async () => {
			mockRewriteModel.generateModelResponse.mockResolvedValue({ markdown: ' rewritten friendly text\n ' });

			await rewriter.rewriteSelection(mockEditor, 'selectedText', 'instructions');

			expect(Notice).toHaveBeenCalledWith('Rewriting selected text...');
			expect(mockRewriteModel.generateModelResponse).toHaveBeenCalledWith({
				prompt: '',
				perTurnContext: 'rendered selection prompt',
				conversationHistory: [],
				userMessage: 'instructions',
			});
			// Output is trimmed
			expect(mockEditor.replaceSelection).toHaveBeenCalledWith('rewritten friendly text');
			expect(Notice).toHaveBeenCalledWith('Text rewritten successfully');
		});

		test('shows error Notice on rewrite failures', async () => {
			mockRewriteModel.generateModelResponse.mockRejectedValue(new Error('generation limit reached'));

			await rewriter.rewriteSelection(mockEditor, 'text', 'inst');

			expect(mockPlugin.logger.error).toHaveBeenCalledWith('Failed to rewrite text:', expect.any(Error));
			expect(Notice).toHaveBeenCalledWith('API error: generation limit reached', 8000);
			expect(mockEditor.replaceSelection).not.toHaveBeenCalled();
		});
	});

	describe('rewriteFullFile', () => {
		test('calls model, replaces editor contents entirely, and shows Notice', async () => {
			mockRewriteModel.generateModelResponse.mockResolvedValue({ markdown: '  completely rewritten file content  ' });

			await rewriter.rewriteFullFile(mockEditor, 'rewrite all');

			expect(Notice).toHaveBeenCalledWith('Rewriting entire file...');
			expect(mockRewriteModel.generateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: 'rewrite all',
				})
			);
			// Replaces entirely and trims output
			expect(mockEditor.setValue).toHaveBeenCalledWith('completely rewritten file content');
			expect(Notice).toHaveBeenCalledWith('File rewritten successfully');
		});

		test('shows error Notice on full file rewrite failures', async () => {
			mockRewriteModel.generateModelResponse.mockRejectedValue(new Error('model timeout'));

			await rewriter.rewriteFullFile(mockEditor, 'inst');

			expect(mockPlugin.logger.error).toHaveBeenCalledWith('Failed to rewrite file:', expect.any(Error));
			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('timed out'), 8000);
			expect(mockEditor.setValue).not.toHaveBeenCalled();
		});
	});

	describe('rewriteFile (mid-request edit safety)', () => {
		test('standard flow: reads, prompts, modifies vault file, and returns content', async () => {
			mockRewriteModel.generateModelResponse.mockResolvedValue({ markdown: ' rewritten content ' });

			const result = await rewriter.rewriteFile(mockFile, 'instruct');

			expect(result).toBe('rewritten content');
			expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);
			expect(mockPlugin.app.vault.modify).toHaveBeenCalledWith(mockFile, 'rewritten content');
		});

		test('throws error when file is modified in-flight (baseline mtime vs live mtime check)', async () => {
			mockRewriteModel.generateModelResponse.mockResolvedValue({ markdown: 'rewritten' });

			// Mock a live file that has been modified (live mtime 3000 > baseline mtime 2000)
			const liveModifiedFile = new MockTFile() as any;
			liveModifiedFile.stat.mtime = 3000;
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(liveModifiedFile);

			await expect(rewriter.rewriteFile(mockFile, 'instruct')).rejects.toThrow(
				/was modified during rewrite.*aborting to avoid clobbering/
			);

			// Modification should have been aborted cleanly
			expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
		});

		test('throws error when file is deleted in-flight', async () => {
			mockRewriteModel.generateModelResponse.mockResolvedValue({ markdown: 'rewritten' });

			// Live lookup returns null (deleted)
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			await expect(rewriter.rewriteFile(mockFile, 'instruct')).rejects.toThrow(
				'[SelectionRewriter] File "notes/file.md" was removed during rewrite — discarding result'
			);

			expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
		});
	});
});
