import { GeminiCompletions } from '../src/completions';
import type ObsidianGemini from '../src/main';

const { MockMarkdownView, mockCompletionsModel, mockForceFetch } = vi.hoisted(() => {
	class MockMarkdownView {
		editor = {
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 5 }),
			getLine: vi.fn().mockReturnValue('prefix text'),
			getRange: vi.fn().mockImplementation((from, _to) => {
				if (from.line === 0 && from.ch === 0) {
					return 'prefix text'; // contentBeforeCursor
				}
				return 'content after cursor'; // contentAfterCursor
			}),
			lastLine: vi.fn().mockReturnValue(1),
		};
	}
	return {
		MockMarkdownView,
		mockCompletionsModel: {
			generateModelResponse: vi.fn(),
		},
		mockForceFetch: vi.fn(),
	};
});

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('obsidian')),
	MarkdownView: MockMarkdownView,
	Notice: vi.fn(),
}));

vi.mock('codemirror-companion-extension', () => ({
	forceableInlineSuggestion: vi.fn().mockImplementation(() => ({
		extension: {},
		force_fetch: mockForceFetch,
	})),
}));

vi.mock('../src/api', () => ({
	ModelClientFactory: {
		createCompletionsModel: vi.fn().mockReturnValue(mockCompletionsModel),
	},
}));

vi.mock('../src/prompts', () => {
	class MockGeminiPrompts {
		completionsPrompt = vi.fn().mockReturnValue('rendered prompt text');
	}
	return {
		GeminiPrompts: MockGeminiPrompts,
	};
});

describe('GeminiCompletions', () => {
	let completions: GeminiCompletions;
	let mockPlugin: any;
	let activeView: InstanceType<typeof MockMarkdownView>;

	beforeEach(() => {
		vi.clearAllMocks();
		activeView = new MockMarkdownView();

		mockPlugin = {
			app: {
				workspace: {
					getActiveViewOfType: vi.fn().mockReturnValue(activeView),
				},
			},
			logger: {
				log: vi.fn(),
				debug: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
			},
			registerEditorExtension: vi.fn(),
			addCommand: vi.fn(),
		};

		completions = new GeminiCompletions(mockPlugin as unknown as ObsidianGemini);
	});

	describe('complete() generator', () => {
		test('returns early if completions are disabled', async () => {
			(completions as any).completionsOn = false;
			const generator = completions.complete();
			const result = await generator.next();
			expect(result.done).toBe(true);
		});

		test('returns early if no active markdown view exists', async () => {
			(completions as any).completionsOn = true;
			mockPlugin.app.workspace.getActiveViewOfType.mockReturnValue(null);

			const generator = completions.complete();
			const result = await generator.next();
			expect(result.done).toBe(true);
		});

		test('yields a suggestion with a prepended space if prefix does not end with space', async () => {
			(completions as any).completionsOn = true;
			// prefix is 'prefix text' (doesn't end with space)
			activeView.editor.getLine.mockReturnValue('prefix text');
			mockCompletionsModel.generateModelResponse.mockResolvedValue({ markdown: 'next sentence' });

			const generator = completions.complete();
			const result = await generator.next();

			expect(result.done).toBe(false);
			expect(result.value).toEqual({
				display_suggestion: ' next sentence',
				complete_suggestion: ' next sentence',
			});
		});

		test('yields suggestion directly if prefix already ends with space', async () => {
			(completions as any).completionsOn = true;
			// prefix ends with space
			activeView.editor.getLine.mockReturnValue('prefix text ');
			activeView.editor.getCursor.mockReturnValue({ line: 0, ch: 12 });
			mockCompletionsModel.generateModelResponse.mockResolvedValue({ markdown: 'next sentence' });

			const generator = completions.complete();
			const result = await generator.next();

			expect(result.done).toBe(false);
			expect(result.value).toEqual({
				display_suggestion: 'next sentence',
				complete_suggestion: 'next sentence',
			});
		});
	});

	describe('generateNextSentence', () => {
		test('creates model client, passes prompt and returns trimmed markdown', async () => {
			mockCompletionsModel.generateModelResponse.mockResolvedValue({ markdown: 'next line\n' });

			const result = await completions.generateNextSentence('before', 'after');

			expect(result).toBe('next line');
			expect(mockCompletionsModel.generateModelResponse).toHaveBeenCalledWith({
				prompt: 'rendered prompt text',
			});
		});
	});

	describe('setupCompletions and commands', () => {
		test('setupCompletions registers extension and sets force_fetch', async () => {
			await completions.setupCompletions();
			expect(mockPlugin.registerEditorExtension).toHaveBeenCalledWith({});
			expect((completions as any).force_fetch).toBe(mockForceFetch);
		});

		test('setupCompletionsCommands registers toggle command', async () => {
			await completions.setupCompletionsCommands();
			expect(mockPlugin.addCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'gemini-scribe-toggle-completions',
					name: 'Toggle completions',
					callback: expect.any(Function),
				})
			);
		});

		test('toggle callback toggles state and triggers force_fetch when enabling', async () => {
			await completions.setupCompletions();
			await completions.setupCompletionsCommands();
			const callback = mockPlugin.addCommand.mock.calls[0][0].callback;

			// Starts as disabled
			expect((completions as any).completionsOn).toBe(false);

			// Toggle ON
			callback();
			expect((completions as any).completionsOn).toBe(true);
			expect(mockForceFetch).toHaveBeenCalledTimes(1);

			// Toggle OFF
			callback();
			expect((completions as any).completionsOn).toBe(false);
			expect(mockForceFetch).toHaveBeenCalledTimes(1); // should not call again when disabling
		});
	});
});
