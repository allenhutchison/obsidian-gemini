import { ParameterValidationService } from '../../src/services/parameter-validation';
import { GoogleModel } from '../../src/services/model-discovery';

describe('ParameterValidationService', () => {
	describe('getParameterRanges', () => {
		it('should return default ranges when no models are provided', () => {
			const ranges = ParameterValidationService.getParameterRanges([]);
			
			expect(ranges.temperature.min).toBe(0);
			expect(ranges.temperature.max).toBe(2);
			expect(ranges.temperature.step).toBe(0.1);
			
			expect(ranges.topP.min).toBe(0);
			expect(ranges.topP.max).toBe(1);
			expect(ranges.topP.step).toBe(0.01);
		});

		it('should use discovered model maxTemperature values', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-1.5-pro',
					displayName: 'Gemini 1.5 Pro',
					description: 'Test model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					maxTemperature: 2.5,
				},
				{
					name: 'models/gemini-1.5-flash',
					displayName: 'Gemini 1.5 Flash',
					description: 'Test model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					maxTemperature: 1.8,
				},
			];

			const ranges = ParameterValidationService.getParameterRanges(models);
			
			expect(ranges.temperature.max).toBe(2.5); // Should use the highest maxTemperature
		});

		it('should handle missing parameter values gracefully', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-test',
					displayName: 'Gemini Test',
					description: 'Test model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					// Missing maxTemperature and topP
				},
			];

			const ranges = ParameterValidationService.getParameterRanges(models);
			
			// Should fall back to defaults
			expect(ranges.temperature.max).toBe(2);
			expect(ranges.topP.max).toBe(1);
		});

		it('should handle large arrays of temperature values efficiently', () => {
			// Create a large array to test reduce() instead of spread operator
			const models: GoogleModel[] = Array.from({ length: 1000 }, (_, i) => ({
				name: `models/gemini-test-${i}`,
				displayName: `Gemini Test ${i}`,
				description: 'Test model',
				version: '001',
				inputTokenLimit: 1000000,
				outputTokenLimit: 8192,
				supportedGenerationMethods: ['generateContent'],
				maxTemperature: 1.0 + (i % 10) * 0.1, // Values from 1.0 to 1.9
			}));

			const ranges = ParameterValidationService.getParameterRanges(models);
			
			expect(ranges.temperature.max).toBe(1.9); // Should handle large arrays without failing
		});

		it('should always use 0-1 range for topP regardless of model defaults', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-test',
					displayName: 'Gemini Test',
					description: 'Test model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					topP: 0.95, // Default value, not max
				},
			];

			const ranges = ParameterValidationService.getParameterRanges(models);
			
			expect(ranges.topP.min).toBe(0);
			expect(ranges.topP.max).toBe(1); // Always 0-1 for topP
		});
	});

	describe('validateTemperature', () => {
		it('should accept valid temperature values', () => {
			const result = ParameterValidationService.validateTemperature(0.7);
			
			expect(result.isValid).toBe(true);
			expect(result.adjustedValue).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});

		it('should reject and adjust temperature values outside range', () => {
			const result = ParameterValidationService.validateTemperature(3.0);
			
			expect(result.isValid).toBe(false);
			expect(result.adjustedValue).toBe(2); // Should be adjusted to max
			expect(result.warning).toContain('Temperature 3');
		});

		it('should validate against specific model limits', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-limited',
					displayName: 'Gemini Limited',
					description: 'Test model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					maxTemperature: 1.0,
				},
			];

			const result = ParameterValidationService.validateTemperature(
				1.5, 
				'models/gemini-limited', 
				models
			);
			
			expect(result.isValid).toBe(false);
			expect(result.adjustedValue).toBe(1.0);
			expect(result.warning).toContain('exceeds models/gemini-limited limit of 1');
		});
	});

	describe('validateTopP', () => {
		it('should accept valid topP values', () => {
			const result = ParameterValidationService.validateTopP(0.9);
			
			expect(result.isValid).toBe(true);
			expect(result.adjustedValue).toBeUndefined();
			expect(result.warning).toBeUndefined();
		});

		it('should reject and adjust topP values outside range', () => {
			const result = ParameterValidationService.validateTopP(1.5);
			
			expect(result.isValid).toBe(false);
			expect(result.adjustedValue).toBe(1); // Should be adjusted to max
			expect(result.warning).toContain('Top P 1.5');
		});

		it('should accept zero values', () => {
			const tempResult = ParameterValidationService.validateTemperature(0);
			const topPResult = ParameterValidationService.validateTopP(0);
			
			expect(tempResult.isValid).toBe(true);
			expect(topPResult.isValid).toBe(true);
		});
	});

	describe('getParameterDisplayInfo', () => {
		it('should provide display info with model data', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-test',
					displayName: 'Gemini Test',
					description: 'Test model',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					maxTemperature: 1.5,
					topP: 0.95,
				},
			];

			const info = ParameterValidationService.getParameterDisplayInfo(models);
			
			expect(info.hasModelData).toBe(true);
			expect(info.temperature).toContain('Range: 0 to 1.5');
			expect(info.topP).toContain('Range: 0 to 1');
			expect(info.topP).toContain('model defaults: 0.95'); // Should show unique default values
		});

		it('should show unique default values only for topP', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-1',
					displayName: 'Gemini 1',
					description: 'Test model 1',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					topP: 0.95,
				},
				{
					name: 'models/gemini-2',
					displayName: 'Gemini 2',
					description: 'Test model 2',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					topP: 0.95, // Same as first model
				},
				{
					name: 'models/gemini-3',
					displayName: 'Gemini 3',
					description: 'Test model 3',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					topP: 1.0, // Different value
				},
			];

			const info = ParameterValidationService.getParameterDisplayInfo(models);
			
			expect(info.topP).toContain('model defaults: 0.95, 1'); // Should show unique values, sorted
		});

		it('should provide fallback info without model data', () => {
			const info = ParameterValidationService.getParameterDisplayInfo([]);
			
			expect(info.hasModelData).toBe(false);
			expect(info.temperature).toContain('Range: 0 to 2');
			expect(info.topP).toContain('Range: 0 to 1');
		});
	});

	describe('getModelParameterInfo', () => {
		it('should extract parameter info from models', () => {
			const models: GoogleModel[] = [
				{
					name: 'models/gemini-1',
					displayName: 'Gemini 1',
					description: 'Test model 1',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					maxTemperature: 1.5,
					topP: 0.95,
					topK: 40,
				},
				{
					name: 'models/gemini-2',
					displayName: 'Gemini 2',
					description: 'Test model 2',
					version: '001',
					inputTokenLimit: 1000000,
					outputTokenLimit: 8192,
					supportedGenerationMethods: ['generateContent'],
					maxTemperature: 2.0,
				},
			];

			const info = ParameterValidationService.getModelParameterInfo(models);
			
			expect(info).toHaveLength(2);
			expect(info[0]).toEqual({
				modelName: 'models/gemini-1',
				maxTemperature: 1.5,
				topP: 0.95,
				topK: 40,
			});
			expect(info[1]).toEqual({
				modelName: 'models/gemini-2',
				maxTemperature: 2.0,
				topP: undefined,
				topK: undefined,
			});
		});
	});
});