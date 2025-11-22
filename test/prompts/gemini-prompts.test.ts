import { GeminiPrompts } from '../../src/prompts/gemini-prompts';
import ObsidianGemini from '../../src/main';

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

	it('should inject language into general prompt', () => {
		const prompt = geminiPrompts.generalPrompt({ userMessage: 'Hello' });
		expect(prompt).toContain('My user interface is set to the language code: fr');
	});
});
