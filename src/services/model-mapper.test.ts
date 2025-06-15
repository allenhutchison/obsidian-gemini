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
			// User's custom roles preserved, plus ensureRoleDefaults may add completions if no other model has it
			expect(preservedModel?.defaultForRoles).toContain('chat');
			expect(preservedModel?.defaultForRoles).toContain('summary');
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

		it('should ensure all roles have defaults after merging', () => {
			const discoveredModels: GeminiModel[] = [
				{ value: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro', defaultForRoles: [] }, // No default roles
				{ value: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash', defaultForRoles: [] },
			];

			const existingWithDefaults: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Old Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-flash', label: 'Old Flash', defaultForRoles: ['summary'] },
				{ value: 'gemini-2.5-lite', label: 'Old Lite', defaultForRoles: ['completions'] },
			];

			const result = ModelMapper.mergeWithExistingModels(discoveredModels, existingWithDefaults);

			// Should have defaults assigned to new models
			const hasChat = result.some(m => m.defaultForRoles?.includes('chat'));
			const hasSummary = result.some(m => m.defaultForRoles?.includes('summary'));
			const hasCompletions = result.some(m => m.defaultForRoles?.includes('completions'));

			expect(hasChat).toBe(true);
			expect(hasSummary).toBe(true);
			expect(hasCompletions).toBe(true);
		});

		it('should preserve current defaults when same models exist', () => {
			const discoveredModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro Updated', defaultForRoles: ['summary'] }, // Different role
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash Updated', defaultForRoles: ['chat'] }, // Different role
			];

			const existingWithDefaults: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			];

			const result = ModelMapper.mergeWithExistingModels(discoveredModels, existingWithDefaults);

			// Should preserve existing role assignments
			const proModel = result.find(m => m.value === 'gemini-2.5-pro');
			const flashModel = result.find(m => m.value === 'gemini-2.5-flash');

			expect(proModel?.defaultForRoles).toContain('chat');
			expect(flashModel?.defaultForRoles).toContain('summary');
		});
	});

	describe('sortModelsByPreference', () => {
		const unsortedModels: GeminiModel[] = [
			{ value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
			{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro', defaultForRoles: ['chat'] },
		];

		it('should sort by version first (2.5 > 2.0 > 1.5 > 1.0)', () => {
			const result = ModelMapper.sortModelsByPreference(unsortedModels);

			// Extract versions and check order
			const versions = result.map(m => {
				const match = m.value.match(/gemini-(\d+(?:\.\d+)?)/);
				return match ? parseFloat(match[1]) : 0;
			});

			for (let i = 1; i < versions.length; i++) {
				expect(versions[i]).toBeLessThanOrEqual(versions[i - 1]);
			}
		});

		it('should sort by family within same version (pro > flash > lite)', () => {
			const sameVersionModels: GeminiModel[] = [
				{ value: 'gemini-2.5-flash', label: 'Flash', defaultForRoles: ['summary'] },
				{ value: 'gemini-2.5-pro', label: 'Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-lite', label: 'Lite', defaultForRoles: ['completions'] },
			];
			const result = ModelMapper.sortModelsByPreference(sameVersionModels);

			const proIndex = result.findIndex((m) => m.value.includes('pro'));
			const flashIndex = result.findIndex((m) => m.value.includes('flash'));
			const liteIndex = result.findIndex((m) => m.value.includes('lite'));

			expect(proIndex).toBeLessThan(flashIndex);
			expect(flashIndex).toBeLessThan(liteIndex);
		});

		it('should prioritize stable over experimental within same version and family', () => {
			const mixedStabilityModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro-experimental', label: 'Experimental Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-pro', label: 'Stable Pro', defaultForRoles: ['chat'] },
			];
			const result = ModelMapper.sortModelsByPreference(mixedStabilityModels);

			// Check that the first model is the stable one
			expect(result[0].value).toBe('gemini-2.5-pro');
			expect(result[1].value).toBe('gemini-2.5-pro-experimental');
		});
	});

	describe('deduplicateModels', () => {
		it('should remove duplicate models with same value', () => {
			const duplicateModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Duplicate)', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			];

			const result = ModelMapper.deduplicateModels(duplicateModels);

			expect(result).toHaveLength(2);
			expect(result.map(m => m.value)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
		});

		it('should prefer model with cleaner label when deduplicating', () => {
			const duplicateModels: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Long Descriptive Name)', defaultForRoles: ['chat'] },
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			];

			const result = ModelMapper.deduplicateModels(duplicateModels);

			expect(result).toHaveLength(1);
			expect(result[0].label).toBe('Gemini 2.5 Pro');
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