import { GeminiPrompts } from '../../src/prompts/gemini-prompts';
import type ObsidianGemini from '../../src/main';
import type { ExtendedModelRequest } from '../../src/api/interfaces/model-api';
import { getLanguage } from 'obsidian';

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
				warn: vi.fn(),
			},
		};
		geminiPrompts = new GeminiPrompts(mockPlugin as ObsidianGemini);
		(getLanguage as ReturnType<typeof vi.fn>).mockReturnValue('fr'); // Set language to French
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
		(getLanguage as ReturnType<typeof vi.fn>).mockReturnValue('');
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

	describe('buildExtendedSystemInstruction', () => {
		const baseRequest: ExtendedModelRequest = {
			kind: 'extended',
			model: 'gemini-test',
			prompt: '',
			conversationHistory: [],
			userMessage: 'hi',
		};

		it('loads AGENTS.md memory and skill summaries and feeds them into the system prompt', async () => {
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('AGENTS body') };
			mockPlugin.skillManager = {
				getSkillSummaries: vi.fn().mockResolvedValue([{ name: 'echo', description: 'echoes things' }]),
			};

			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');
			await geminiPrompts.buildExtendedSystemInstruction({
				...baseRequest,
				availableTools: [{ name: 't', description: 'd', parameters: { type: 'object', properties: {} } }],
			});

			expect(mockPlugin.agentsMemory.read).toHaveBeenCalledTimes(1);
			expect(mockPlugin.skillManager.getSkillSummaries).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith(
				expect.any(Array),
				undefined,
				'AGENTS body',
				[{ name: 'echo', description: 'echoes things' }],
				undefined,
				undefined
			);
		});

		it('renders the prompt with empty memory when plugin is undefined', async () => {
			const orphan = new GeminiPrompts(undefined);
			const spy = vi.spyOn(orphan, 'getSystemPromptWithCustom');
			const result = await orphan.buildExtendedSystemInstruction(baseRequest);
			expect(typeof result).toBe('string');
			expect(spy).toHaveBeenCalledWith(undefined, undefined, null, [], undefined, undefined);
		});

		it('falls back to empty memory when plugin has no agentsMemory', async () => {
			mockPlugin.agentsMemory = undefined;
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');
			await geminiPrompts.buildExtendedSystemInstruction(baseRequest);
			expect(spy).toHaveBeenCalledWith(undefined, undefined, null, [], undefined, undefined);
		});

		it('swallows agentsMemory.read() rejection and logs a warning', async () => {
			const err = new Error('read fail');
			mockPlugin.agentsMemory = { read: vi.fn().mockRejectedValue(err) };
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');

			await geminiPrompts.buildExtendedSystemInstruction(baseRequest);

			expect(mockPlugin.logger.warn).toHaveBeenCalledWith('Failed to load AGENTS.md:', err);
			expect(spy).toHaveBeenCalledWith(undefined, undefined, null, [], undefined, undefined);
		});

		it('falls back to no skills when plugin has no skillManager', async () => {
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = undefined;
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');
			await geminiPrompts.buildExtendedSystemInstruction(baseRequest);
			expect(spy).toHaveBeenCalledWith(undefined, undefined, '', [], undefined, undefined);
		});

		it('swallows getSkillSummaries() rejection and logs a warning', async () => {
			const err = new Error('skills fail');
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockRejectedValue(err) };
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');

			await geminiPrompts.buildExtendedSystemInstruction(baseRequest);

			expect(mockPlugin.logger.warn).toHaveBeenCalledWith('Failed to load skill summaries:', err);
			expect(spy).toHaveBeenCalledWith(undefined, undefined, '', [], undefined, undefined);
		});

		it('filters skills down to projectSkills when the list is non-empty', async () => {
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = {
				getSkillSummaries: vi.fn().mockResolvedValue([
					{ name: 'echo', description: 'a' },
					{ name: 'hello', description: 'b' },
					{ name: 'world', description: 'c' },
				]),
			};
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');

			await geminiPrompts.buildExtendedSystemInstruction({
				...baseRequest,
				projectSkills: ['echo', 'world'],
			});

			expect(spy).toHaveBeenCalledWith(
				undefined,
				undefined,
				'',
				[
					{ name: 'echo', description: 'a' },
					{ name: 'world', description: 'c' },
				],
				undefined,
				undefined
			);
		});

		it('does not filter skills when projectSkills is an empty array', async () => {
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			const allSkills = [
				{ name: 'echo', description: 'a' },
				{ name: 'hello', description: 'b' },
			];
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue(allSkills) };
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');

			await geminiPrompts.buildExtendedSystemInstruction({ ...baseRequest, projectSkills: [] });

			expect(spy).toHaveBeenCalledWith(undefined, undefined, '', allSkills, undefined, undefined);
		});

		it('forwards request fields (customPrompt, projectInstructions, sessionStartedAt) verbatim', async () => {
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			const spy = vi.spyOn(geminiPrompts, 'getSystemPromptWithCustom');

			const customPrompt = {
				name: 'custom',
				description: 'test',
				version: 1,
				overrideSystemPrompt: false,
				tags: [],
				content: 'custom',
			};
			await geminiPrompts.buildExtendedSystemInstruction({
				...baseRequest,
				customPrompt,
				projectInstructions: 'be helpful',
				sessionStartedAt: '2026-05-28T10:00:00Z',
			});

			expect(spy).toHaveBeenCalledWith(undefined, customPrompt, '', [], 'be helpful', '2026-05-28T10:00:00Z');
		});
	});
});
