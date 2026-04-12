import { GeminiPrompts } from '../../src/prompts/gemini-prompts';
import type ObsidianGemini from '../../src/main';

// Mock window.localStorage
const mockLocalStorage = {
	getItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
	value: mockLocalStorage,
});

describe('GeminiPrompts', () => {
	let geminiPrompts: GeminiPrompts;
	let mockPlugin: any;

	beforeEach(() => {
		mockPlugin = {
			settings: {
				userName: 'Test User',
				ragIndexing: { enabled: false },
			},
			logger: {
				warn: jest.fn(),
			},
		};
		geminiPrompts = new GeminiPrompts(mockPlugin as ObsidianGemini);
		mockLocalStorage.getItem.mockReturnValue('fr'); // Set language to French
	});

	it('should inject language into system prompt', () => {
		const prompt = geminiPrompts.systemPrompt({
			userName: 'Test User',
			date: '2023-10-27',
			time: '12:00:00',
			agentsMemory: '',
		});
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should inject language into summary prompt', () => {
		const prompt = geminiPrompts.summaryPrompt({ content: 'Some content' });
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should inject language into completion prompt', () => {
		const prompt = geminiPrompts.completionsPrompt({
			contentBeforeCursor: 'Pre',
			contentAfterCursor: 'Post',
		});
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should inject language into selection rewrite prompt', () => {
		const prompt = geminiPrompts.selectionRewritePrompt({
			instructions: 'Rewrite this',
			documentWithMarkers: 'Text',
		});
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should inject language into vault analysis prompt', () => {
		const prompt = geminiPrompts.vaultAnalysisPrompt({ existingContent: '' });
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should inject language into example prompts prompt', () => {
		const prompt = geminiPrompts.examplePromptsPrompt('Vault Info', 'Existing Prompts');
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should inject language into image prompt generator', () => {
		const prompt = geminiPrompts.imagePromptGenerator({ content: 'Image content' });
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});

	it('should default to "en" when no language is set', () => {
		mockLocalStorage.getItem.mockReturnValue(null);
		const prompt = geminiPrompts.systemPrompt({
			userName: 'Test User',
			date: '2023-10-27',
			time: '12:00:00',
			agentsMemory: '',
		});
		expect(prompt).toContain('My user interface is set to the language code: en');
	});

	describe('getSystemPromptWithCustom (implicit-cache stability)', () => {
		const baseArgs = [
			undefined, // availableTools
			undefined, // customPrompt
			null, // agentsMemory
			undefined, // availableSkills
			undefined, // projectInstructions
			undefined, // perTurnContext
		] as const;

		it('returns byte-identical output across calls with the same sessionStartedAt', () => {
			const anchor = '2026-04-12T14:23:45.123-07:00';
			const first = geminiPrompts.getSystemPromptWithCustom(...baseArgs, anchor);
			const second = geminiPrompts.getSystemPromptWithCustom(...baseArgs, anchor);
			expect(second).toBe(first);
		});

		it('includes the session-start anchor line when sessionStartedAt is provided', () => {
			const anchor = '2026-04-12T14:23:45.123-07:00';
			const prompt = geminiPrompts.getSystemPromptWithCustom(...baseArgs, anchor);
			expect(prompt).toContain(`This conversation started on ${anchor}.`);
		});

		it('omits the anchor line entirely when sessionStartedAt is empty/undefined', () => {
			const prompt = geminiPrompts.getSystemPromptWithCustom(...baseArgs, undefined);
			expect(prompt).not.toContain('This conversation started on');
		});

		it('does not inject volatile date or time fields into the prompt', () => {
			// Regression guard: the pre-fix template had `Today's date is:` and
			// `The current time is:` lines that changed per call and broke the
			// implicit prefix cache. They must stay out.
			const prompt = geminiPrompts.getSystemPromptWithCustom(...baseArgs, '2026-04-12T14:23:45.123-07:00');
			expect(prompt).not.toContain("Today's date is:");
			expect(prompt).not.toContain('The current time is:');
		});
	});
});
