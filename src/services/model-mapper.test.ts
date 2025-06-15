import { ModelMapper } from './model-mapper';
import { GeminiModel } from '../models';
import { GoogleModel } from './model-discovery';

describe('ModelMapper', () => {
	const mockGoogleModels: GoogleModel[] = [
		{
			name: 'models/gemini-2.5-pro-preview-06-05',
			displayName: 'Gemini 2.5 Pro',
			description: 'Advanced reasoning model',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 8192,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-2.5-flash',
			displayName: 'Gemini 2.5 Flash',
			description: 'Fast model',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 8192,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-2.0-flash-lite',
			displayName: '',
			description: 'Lightweight model',
			version: '001',
			inputTokenLimit: 100000,
			outputTokenLimit: 2048,
			supportedGenerationMethods: ['generateContent'],
		},
		{
			name: 'models/gemini-experimental-thinking',
			displayName: 'Gemini Experimental Thinking',
			description: 'Experimental reasoning model',
			version: '001',
			inputTokenLimit: 1000000,
			outputTokenLimit: 8192,
			supportedGenerationMethods: ['generateContent'],
		},
	];

	describe('mapToGeminiModels', () => {
		it('should map Google models to GeminiModel format', () => {
			const result = ModelMapper.mapToGeminiModels(mockGoogleModels);

			expect(result).toHaveLength(4);
			expect(result[0]).toEqual({
				value: 'gemini-2.5-pro-preview-06-05',
				label: 'Gemini 2.5 Pro',
				defaultForRoles: ['chat'],
			});
			expect(result[1]).toEqual({
				value: 'gemini-2.5-flash',
				label: 'Gemini 2.5 Flash',
				defaultForRoles: ['summary'],
			});
		});

		it('should extract model ID correctly', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[0]]);
			expect(result[0].value).toBe('gemini-2.5-pro-preview-06-05');
		});

		it('should use displayName when available', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[0]]);
			expect(result[0].label).toBe('Gemini 2.5 Pro');
		});

		it('should generate label from model name when displayName is empty', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[2]]);
			expect(result[0].label).toBe('Gemini 2.0 Flash Lite');
		});
	});

	describe('inferDefaultRoles', () => {
		it('should assign chat role to pro models', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[0]]);
			expect(result[0].defaultForRoles).toContain('chat');
		});

		it('should assign summary role to flash models', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[1]]);
			expect(result[0].defaultForRoles).toContain('summary');
		});

		it('should assign summary role to flash-lite models (flash takes precedence)', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[2]]);
			expect(result[0].defaultForRoles).toContain('summary');
		});

		it('should assign completions role to pure lite models', () => {
			const liteOnlyModel: GoogleModel = {
				...mockGoogleModels[0],
				name: 'models/gemini-lite',
			};
			const result = ModelMapper.mapToGeminiModels([liteOnlyModel]);
			expect(result[0].defaultForRoles).toContain('completions');
		});

		it('should assign chat role to experimental models', () => {
			const result = ModelMapper.mapToGeminiModels([mockGoogleModels[3]]);
			expect(result[0].defaultForRoles).toContain('chat');
		});

		it('should default to chat role when no specific pattern matches', () => {
			const unknownModel: GoogleModel = {
				...mockGoogleModels[0],
				name: 'models/gemini-unknown-variant',
			};
			const result = ModelMapper.mapToGeminiModels([unknownModel]);
			expect(result[0].defaultForRoles).toContain('chat');
		});
	});

	describe('mergeWithExistingModels', () => {
		const discoveredModels: GeminiModel[] = [
			{
				value: 'gemini-2.5-pro',
				label: 'Gemini 2.5 Pro (Updated)',
				defaultForRoles: ['chat'],
			},
			{
				value: 'gemini-new-model',
				label: 'New Model',
				defaultForRoles: ['summary'],
			},
		];

		const existingModels: GeminiModel[] = [
			{
				value: 'gemini-2.5-pro',
				label: 'Gemini 2.5 Pro (Custom)',
				defaultForRoles: ['chat', 'summary'], // User customization
			},
			{
				value: 'gemini-old-model',
				label: 'Old Model',
				defaultForRoles: ['completions'],
			},
		];

		it('should preserve user customizations for existing models', () => {
			const result = ModelMapper.mergeWithExistingModels(discoveredModels, existingModels);

			const preservedModel = result.find((m) => m.value === 'gemini-2.5-pro');
			expect(preservedModel?.defaultForRoles).toEqual(['chat', 'summary']); // User's custom roles preserved
		});

		it('should include new discovered models', () => {
			const result = ModelMapper.mergeWithExistingModels(discoveredModels, existingModels);

			const newModel = result.find((m) => m.value === 'gemini-new-model');
			expect(newModel).toBeDefined();
			expect(newModel?.defaultForRoles).toEqual(['summary']);
		});

		it('should update labels when significantly different', () => {
			const discoveredWithDifferentLabel: GeminiModel[] = [
				{
					value: 'gemini-2.5-pro',
					label: 'Gemini 2.5 Pro Enterprise',
					defaultForRoles: ['chat'],
				},
			];

			const result = ModelMapper.mergeWithExistingModels(discoveredWithDifferentLabel, existingModels);
			const updatedModel = result.find((m) => m.value === 'gemini-2.5-pro');
			expect(updatedModel?.label).toBe('Gemini 2.5 Pro Enterprise');
		});

		it('should preserve labels when only minor differences exist', () => {
			const discoveredWithMinorChange: GeminiModel[] = [
				{
					value: 'gemini-2.5-pro',
					label: 'Gemini 2.5 Pro (custom)', // Just case/punctuation change
					defaultForRoles: ['chat'],
				},
			];

			const result = ModelMapper.mergeWithExistingModels(discoveredWithMinorChange, existingModels);
			const preservedModel = result.find((m) => m.value === 'gemini-2.5-pro');
			expect(preservedModel?.label).toBe('Gemini 2.5 Pro (Custom)'); // Original preserved
		});
	});

	describe('sortModelsByPreference', () => {
		const unsortedModels: GeminiModel[] = [
			{ value: 'gemini-experimental-model', label: 'Experimental', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.5-flash', label: 'Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-2.5-pro', label: 'Pro', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.0-flash-lite', label: 'Lite', defaultForRoles: ['completions'] },
			{ value: 'gemini-preview-model', label: 'Preview', defaultForRoles: ['chat'] },
		];

		it('should sort stable models before experimental/preview models', () => {
			const result = ModelMapper.sortModelsByPreference(unsortedModels);

			const stableModels = result.filter(
				(m) => !m.value.includes('experimental') && !m.value.includes('preview')
			);
			const unstableModels = result.filter(
				(m) => m.value.includes('experimental') || m.value.includes('preview')
			);

			expect(result.indexOf(stableModels[0])).toBeLessThan(result.indexOf(unstableModels[0]));
		});

		it('should sort by model family priority: pro > flash > lite', () => {
			const testModels: GeminiModel[] = [
				{ value: 'gemini-2.5-flash', label: 'Flash', defaultForRoles: ['summary'] },
				{ value: 'gemini-2.5-pro', label: 'Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-lite', label: 'Lite', defaultForRoles: ['completions'] },
			];
			const result = ModelMapper.sortModelsByPreference(testModels);

			const proIndex = result.findIndex((m) => m.value.includes('pro'));
			const flashIndex = result.findIndex((m) => m.value.includes('flash') && !m.value.includes('lite'));
			const liteIndex = result.findIndex((m) => m.value === 'gemini-lite');

			expect(proIndex).toBeLessThan(flashIndex);
			expect(flashIndex).toBeLessThan(liteIndex);
		});

		it('should sort alphabetically within same priority', () => {
			const sameTypeModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro-z', label: 'Pro Z', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-pro-a', label: 'Pro A', defaultForRoles: ['chat'] },
			];

			const result = ModelMapper.sortModelsByPreference(sameTypeModels);

			expect(result[0].value).toBe('gemini-2.5-pro-a');
			expect(result[1].value).toBe('gemini-2.5-pro-z');
		});
	});

	describe('filterModels', () => {
		const testModels: GeminiModel[] = [
			{ value: 'gemini-experimental-model', label: 'Experimental', defaultForRoles: ['chat'] },
			{ value: 'gemini-stable-model', label: 'Stable', defaultForRoles: ['chat'] },
			{ value: 'short', label: 'Short Name', defaultForRoles: ['chat'] },
		];

		it('should exclude experimental models when requested', () => {
			const result = ModelMapper.filterModels(testModels, { excludeExperimental: true });

			expect(result).toHaveLength(2);
			expect(result.find((m) => m.value.includes('experimental'))).toBeUndefined();
		});

		it('should filter by minimum name length', () => {
			const result = ModelMapper.filterModels(testModels, { minNameLength: 10 });

			expect(result).toHaveLength(2);
			expect(result.find((m) => m.value === 'short')).toBeUndefined();
		});

		it('should apply multiple filters together', () => {
			const result = ModelMapper.filterModels(testModels, {
				excludeExperimental: true,
				minNameLength: 10,
			});

			expect(result).toHaveLength(1);
			expect(result[0].value).toBe('gemini-stable-model');
		});

		it('should return all models when no criteria specified', () => {
			const result = ModelMapper.filterModels(testModels);

			expect(result).toHaveLength(3);
		});
	});
});