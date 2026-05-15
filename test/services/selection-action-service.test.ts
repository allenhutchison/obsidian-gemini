// Mock obsidian module
vi.mock('obsidian', () => ({
	TFile: class {
		path: string;
		constructor(path: string = 'test.md') {
			this.path = path;
		}
	},
	Notice: vi.fn(),
	normalizePath: (p: string) => p,
}));

// Mock ModelClientFactory
const mockGenerateModelResponse = vi.fn();
vi.mock('../../src/api', () => ({
	ModelClientFactory: {
		createChatModel: vi.fn().mockReturnValue({
			generateModelResponse: (...args: any[]) => mockGenerateModelResponse(...args),
		}),
	},
}));

// Mock ExplainPromptSelectionModal
vi.mock('../../src/ui/explain-prompt-modal', () => ({
	ExplainPromptSelectionModal: vi.fn().mockImplementation(function (
		_app: any,
		_plugin: any,
		_prompts: any,
		onSelect: any
	) {
		return {
			open: vi.fn(),
			_onSelect: onSelect,
		};
	}),
}));

// Mock SelectionResponseModal and AskQuestionModal
const mockShowResponse = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../src/ui/selection-response-modal', () => ({
	SelectionResponseModal: vi.fn().mockImplementation(function () {
		return {
			open: vi.fn(),
			showResponse: mockShowResponse,
			showError: mockShowError,
		};
	}),
	AskQuestionModal: vi.fn().mockImplementation(function (_app: any, _selection: any, onSubmit: any) {
		return {
			open: vi.fn(),
			_onSubmit: onSubmit,
		};
	}),
}));

import { Notice } from 'obsidian';
import { SelectionActionService } from '../../src/services/selection-action-service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockLogger(): any {
	return {
		log: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function createMockEditor(selection: string = ''): any {
	return {
		getSelection: vi.fn().mockReturnValue(selection),
		getCursor: vi.fn().mockReturnValue({ line: 5, ch: 10 }),
	};
}

function createMockPlugin(): any {
	return {
		app: {},
		settings: {
			chatModelName: 'gemini-2.5-flash',
			temperature: 1,
			topP: 0.95,
		},
		logger: createMockLogger(),
		promptManager: {
			listSelectionPrompts: vi.fn().mockResolvedValue([]),
		},
	};
}

function createMockSourceFile(path: string = 'notes/test.md'): any {
	return { path };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SelectionActionService', () => {
	let service: SelectionActionService;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = createMockPlugin();
		service = new SelectionActionService(mockPlugin);
		mockGenerateModelResponse.mockResolvedValue({ markdown: 'AI response text' });
	});

	// ── Empty selection validation ────────────────────────────────────────

	describe('handleExplainSelection - empty selection', () => {
		it('should show Notice and return early when selection is empty', async () => {
			const editor = createMockEditor('');

			await service.handleExplainSelection(editor, null);

			expect(Notice).toHaveBeenCalledWith('Please select some text first');
		});

		it('should show Notice when selection is whitespace only', async () => {
			const editor = createMockEditor('   \n\t  ');

			await service.handleExplainSelection(editor, null);

			expect(Notice).toHaveBeenCalledWith('Please select some text first');
		});
	});

	describe('handleAskAboutSelection - empty selection', () => {
		it('should show Notice and return early when selection is empty', async () => {
			const editor = createMockEditor('');

			await service.handleAskAboutSelection(editor, null);

			expect(Notice).toHaveBeenCalledWith('Please select some text first');
		});
	});

	describe('handleSelectionPrompt - empty selection', () => {
		it('should show Notice and return early when selection is empty', async () => {
			const editor = createMockEditor('');
			const prompt = { name: 'Test', content: 'Do something with {{selection}}', path: 'prompts/test.md' };

			await service.handleSelectionPrompt(editor, null, prompt as any);

			expect(Notice).toHaveBeenCalledWith('Please select some text first');
		});
	});

	// ── {{selection}} template substitution ───────────────────────────────

	describe('{{selection}} template substitution', () => {
		it('should replace {{selection}} marker with actual selection', async () => {
			const editor = createMockEditor('selected text here');
			const sourceFile = createMockSourceFile();

			// Call the private method directly
			await (service as any).generateAndShowResponseWithPosition(
				editor,
				'selected text here',
				'Explain this: {{selection}} please',
				sourceFile,
				{ line: 5, ch: 10 }
			);

			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: 'Explain this: selected text here please',
				})
			);
		});
	});

	// ── Fallback concatenation ────────────────────────────────────────────

	describe('fallback concatenation when no template marker', () => {
		it('should concatenate prompt and selection with separator when no {{selection}} marker', async () => {
			const editor = createMockEditor('my text');

			await (service as any).generateAndShowResponseWithPosition(editor, 'my text', 'Analyze the following', null, {
				line: 5,
				ch: 10,
			});

			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: 'Analyze the following\n\n---\n\nmy text',
				})
			);
		});
	});

	// ── Source file context injection ─────────────────────────────────────

	describe('source file context injection', () => {
		it('should inject source file path as prompt context', async () => {
			const sourceFile = createMockSourceFile('projects/report.md');

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				sourceFile,
				{ line: 0, ch: 0 }
			);

			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: 'Source file: projects/report.md',
				})
			);
		});

		it('should pass empty string for context when no source file', async () => {
			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: '',
				})
			);
		});
	});

	// ── API timeout handling ─────────────────────────────────────────────

	describe('API timeout handling', () => {
		it('should show error when API call times out', async () => {
			// Make generateModelResponse hang indefinitely
			mockGenerateModelResponse.mockImplementation(
				() => new Promise(() => {}) // never resolves
			);

			// Mock window.setTimeout to fire immediately for the timeout
			const _originalSetTimeout = window.setTimeout;
			vi.spyOn(window, 'setTimeout').mockImplementation((fn: any, _ms?: number) => {
				// Fire the timeout callback immediately to simulate timeout
				if (typeof fn === 'function') fn();
				return 0 as any;
			});

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('timed out'));

			// Restore
			(window.setTimeout as any).mockRestore?.();
		});
	});

	// ── Empty response detection ─────────────────────────────────────────

	describe('empty response detection', () => {
		it('should show error when AI returns empty response', async () => {
			mockGenerateModelResponse.mockResolvedValue({ markdown: '' });

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('empty response'));
		});

		it('should show error when AI returns whitespace-only response', async () => {
			mockGenerateModelResponse.mockResolvedValue({ markdown: '   \n  ' });

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('empty response'));
		});

		it('should show response when AI returns valid content', async () => {
			mockGenerateModelResponse.mockResolvedValue({ markdown: 'Valid response' });

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowResponse).toHaveBeenCalledWith('Valid response');
		});
	});

	// ── Error handling ───────────────────────────────────────────────────

	describe('error handling', () => {
		it('should show error message when API call fails', async () => {
			mockGenerateModelResponse.mockRejectedValue(new Error('Network failure'));

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowError).toHaveBeenCalledWith('Network failure');
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});
	});

	// ── handleExplainSelection – full flow with prompts ──────────────────

	describe('handleExplainSelection - full flow', () => {
		it('should show Notice when no selection prompts exist', async () => {
			const editor = createMockEditor('some text');
			mockPlugin.promptManager.listSelectionPrompts.mockResolvedValue([]);

			await service.handleExplainSelection(editor, null);

			expect(Notice).toHaveBeenCalledWith(expect.stringContaining('No selection action prompts found'));
		});

		it('should open ExplainPromptSelectionModal when prompts exist', async () => {
			const { ExplainPromptSelectionModal } = await import('../../src/ui/explain-prompt-modal');
			const editor = createMockEditor('selected text');
			const prompts = [{ name: 'Explain', content: 'Explain {{selection}}', path: 'prompts/explain.md' }];
			mockPlugin.promptManager.listSelectionPrompts.mockResolvedValue(prompts);

			await service.handleExplainSelection(editor, null);

			expect(ExplainPromptSelectionModal).toHaveBeenCalledWith(
				mockPlugin.app,
				mockPlugin,
				prompts,
				expect.any(Function)
			);
			const modalInstance = (ExplainPromptSelectionModal as any).mock.results[0].value;
			expect(modalInstance.open).toHaveBeenCalled();
		});

		it('should capture cursor position and invoke generateAndShowResponseWithPosition via onSelect', async () => {
			const { ExplainPromptSelectionModal } = await import('../../src/ui/explain-prompt-modal');
			const editor = createMockEditor('selected text');
			const sourceFile = createMockSourceFile('notes/test.md');
			const prompt = { name: 'Explain', content: 'Explain {{selection}}', path: 'prompts/explain.md' };
			mockPlugin.promptManager.listSelectionPrompts.mockResolvedValue([prompt]);

			await service.handleExplainSelection(editor, sourceFile);

			// Verify getCursor was called to capture the position
			expect(editor.getCursor).toHaveBeenCalledWith('to');

			// Trigger the onSelect callback
			const modalInstance = (ExplainPromptSelectionModal as any).mock.results[0].value;
			await modalInstance._onSelect(prompt);

			// Verify the API was called with the correct substituted message
			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: 'Explain selected text',
					prompt: 'Source file: notes/test.md',
				})
			);
			expect(mockShowResponse).toHaveBeenCalledWith('AI response text');
		});
	});

	// ── handleSelectionPrompt – full flow ────────────────────────────────

	describe('handleSelectionPrompt - full flow', () => {
		it('should capture cursor and call generateAndShowResponseWithPosition with valid selection', async () => {
			const editor = createMockEditor('my selected text');
			const sourceFile = createMockSourceFile('docs/readme.md');
			const prompt = { name: 'Summarize', content: 'Summarize: {{selection}}', path: 'prompts/summarize.md' };

			await service.handleSelectionPrompt(editor, sourceFile, prompt as any);

			expect(editor.getCursor).toHaveBeenCalledWith('to');
			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: 'Summarize: my selected text',
					prompt: 'Source file: docs/readme.md',
				})
			);
			expect(mockShowResponse).toHaveBeenCalledWith('AI response text');
		});
	});

	// ── handleAskAboutSelection – full flow ──────────────────────────────

	describe('handleAskAboutSelection - full flow', () => {
		it('should open AskQuestionModal with valid selection', async () => {
			const { AskQuestionModal } = await import('../../src/ui/selection-response-modal');
			const editor = createMockEditor('some code');

			await service.handleAskAboutSelection(editor, null);

			expect(AskQuestionModal).toHaveBeenCalledWith(mockPlugin.app, 'some code', expect.any(Function));
			const questionModalInstance = (AskQuestionModal as any).mock.results[0].value;
			expect(questionModalInstance.open).toHaveBeenCalled();
		});

		it('should build question prompt and call generateAndShowResponse via onSubmit', async () => {
			const { AskQuestionModal } = await import('../../src/ui/selection-response-modal');
			const editor = createMockEditor('some code');
			const sourceFile = createMockSourceFile('src/index.ts');

			await service.handleAskAboutSelection(editor, sourceFile);

			// Trigger the onSubmit callback
			const questionModalInstance = (AskQuestionModal as any).mock.results[0].value;
			await questionModalInstance._onSubmit('What does this do?');

			// The prompt should include the question text
			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: expect.stringContaining('What does this do?'),
				})
			);
			// generateAndShowResponse internally captures cursor and delegates
			expect(editor.getCursor).toHaveBeenCalledWith('to');
			expect(mockShowResponse).toHaveBeenCalledWith('AI response text');
		});
	});

	// ── generateAndShowResponse (private) ────────────────────────────────

	describe('generateAndShowResponse - private delegation', () => {
		it('should capture cursor position and delegate to generateAndShowResponseWithPosition', async () => {
			const editor = createMockEditor('text for private method');
			const sourceFile = createMockSourceFile('notes/note.md');

			await (service as any).generateAndShowResponse(
				editor,
				'text for private method',
				'Explain {{selection}}',
				sourceFile
			);

			// Verifies it internally called getCursor('to') and forwarded to generateAndShowResponseWithPosition
			expect(editor.getCursor).toHaveBeenCalledWith('to');
			expect(mockGenerateModelResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					userMessage: 'Explain text for private method',
					prompt: 'Source file: notes/note.md',
				})
			);
			expect(mockShowResponse).toHaveBeenCalledWith('AI response text');
		});
	});

	// ── Non-Error exception handling ─────────────────────────────────────

	describe('non-Error exception handling', () => {
		it('should show "Unknown error occurred" when thrown value is not an Error instance', async () => {
			mockGenerateModelResponse.mockRejectedValue('string error');

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowError).toHaveBeenCalledWith('Unknown error occurred');
			expect(mockPlugin.logger.error).toHaveBeenCalled();
		});

		it('should show "Unknown error occurred" when thrown value is null', async () => {
			mockGenerateModelResponse.mockRejectedValue(null);

			await (service as any).generateAndShowResponseWithPosition(
				createMockEditor('text'),
				'text',
				'Explain {{selection}}',
				null,
				{ line: 0, ch: 0 }
			);

			expect(mockShowError).toHaveBeenCalledWith('Unknown error occurred');
		});
	});
});
