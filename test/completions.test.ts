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

		completions = new GeminiCompletions(mockPlugin);
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

		/** Run one completion with the given text before the cursor and model output. */
		async function completeWith(prefix: string, markdown: string) {
			(completions as any).completionsOn = true;
			activeView.editor.getLine.mockReturnValue(prefix);
			activeView.editor.getCursor.mockReturnValue({ line: 0, ch: prefix.length });
			mockCompletionsModel.generateModelResponse.mockResolvedValue({ markdown });
			const result = await completions.complete().next();
			expect(result.done).toBe(false);
			return result.value as { display_suggestion: string; complete_suggestion: string };
		}

		test('does not split a word when the cursor is mid-word (#1739)', async () => {
			const value = await completeWith('To make them, y', 'ou whisk the dry ingredients');
			expect(value).toEqual({
				display_suggestion: 'ou whisk the dry ingredients',
				complete_suggestion: 'ou whisk the dry ingredients',
			});
		});

		test('keeps the model-supplied leading space after a complete word', async () => {
			const value = await completeWith('The muffins are', ' quick to bake');
			expect(value.complete_suggestion).toBe(' quick to bake');
		});

		test('treats a trailing combining mark as mid-word', async () => {
			expect((await completeWith('किता', 'ब पढ़ना')).complete_suggestion).toBe('ब पढ़ना');
		});

		test('adds a space after punctuation', async () => {
			expect((await completeWith('They are done.', 'Let them cool')).complete_suggestion).toBe(' Let them cool');
			expect((await completeWith('Flour, sugar,', 'and eggs')).complete_suggestion).toBe(' and eggs');
		});

		test('does not add a space before a suggestion that starts with punctuation', async () => {
			expect((await completeWith('Mix well', ', then bake')).complete_suggestion).toBe(', then bake');
		});

		test('does not stack a second space when the prefix already ends with one', async () => {
			expect((await completeWith('The muffins are ', ' quick')).complete_suggestion).toBe('quick');
		});

		test('leaves the suggestion alone at the start of a line', async () => {
			expect((await completeWith('', 'Blueberry muffins')).complete_suggestion).toBe('Blueberry muffins');
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
				kind: 'base',
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
					id: 'toggle-completions',
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
