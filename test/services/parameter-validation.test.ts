import { ParameterValidationService } from '../../src/services/parameter-validation';
import { GeminiModel } from '../../src/models';

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

		it('should use model maxTemperature values', () => {
			const models: GeminiModel[] = [
				{ value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', maxTemperature: 2.5 },
				{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', maxTemperature: 1.8 },
			];

			const ranges = ParameterValidationService.getParameterRanges(models);

			expect(ranges.temperature.max).toBe(2.5);
		});

		it('should handle missing maxTemperature gracefully', () => {
			const models: GeminiModel[] = [{ value: 'gemini-test', label: 'Gemini Test' }];

			const ranges = ParameterValidationService.getParameterRanges(models);

			expect(ranges.temperature.max).toBe(2);
			expect(ranges.topP.max).toBe(1);
		});

		it('should handle large arrays efficiently', () => {
			const models: GeminiModel[] = Array.from({ length: 1000 }, (_, i) => ({
				value: `gemini-test-${i}`,
				label: `Gemini Test ${i}`,
				maxTemperature: 1.0 + (i % 10) * 0.1,
			}));

			const ranges = ParameterValidationService.getParameterRanges(models);

			expect(ranges.temperature.max).toBe(1.9);
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
			expect(result.adjustedValue).toBe(2);
			expect(result.warning).toContain('Temperature 3');
		});

		it('should validate against specific model limits', () => {
			const models: GeminiModel[] = [{ value: 'gemini-limited', label: 'Gemini Limited', maxTemperature: 1.0 }];

			const result = ParameterValidationService.validateTemperature(1.5, 'gemini-limited', models);

			expect(result.isValid).toBe(false);
			expect(result.adjustedValue).toBe(1.0);
			expect(result.warning).toContain('exceeds gemini-limited limit of 1');
		});

		it('should reject NaN', () => {
			const result = ParameterValidationService.validateTemperature(NaN);

			expect(result.isValid).toBe(false);
			expect(result.adjustedValue).toBe(0);
			expect(result.warning).toContain('not a valid number');
		});

		it('should reject Infinity', () => {
			const result = ParameterValidationService.validateTemperature(Infinity);

			expect(result.isValid).toBe(false);
			expect(result.adjustedValue).toBe(0);
			expect(result.warning).toContain('not a valid number');
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
			expect(result.adjustedValue).toBe(1);
			expect(result.warning).toContain('Top P 1.5');
		});

		it('should accept zero values', () => {
			const tempResult = ParameterValidationService.validateTemperature(0);
			const topPResult = ParameterValidationService.validateTopP(0);

			expect(tempResult.isValid).toBe(true);
			expect(topPResult.isValid).toBe(true);
		});

		it('should reject non-finite topP values', () => {
			const nanResult = ParameterValidationService.validateTopP(NaN);
			const infResult = ParameterValidationService.validateTopP(Infinity);

			expect(nanResult.isValid).toBe(false);
			expect(nanResult.warning).toContain('not a valid number');
			expect(infResult.isValid).toBe(false);
			expect(infResult.warning).toContain('not a valid number');
		});
	});

	describe('getParameterDisplayInfo', () => {
		it('should provide display info with model data', () => {
			const models: GeminiModel[] = [{ value: 'gemini-test', label: 'Gemini Test', maxTemperature: 1.5 }];

			const info = ParameterValidationService.getParameterDisplayInfo(models);

			expect(info.hasModelData).toBe(true);
			expect(info.temperature).toContain('Range: 0 to 1.5');
			expect(info.topP).toContain('Range: 0 to 1');
		});

		it('should provide fallback info without model data', () => {
			const info = ParameterValidationService.getParameterDisplayInfo([]);

			expect(info.hasModelData).toBe(false);
			expect(info.temperature).toContain('Range: 0 to 2');
			expect(info.topP).toContain('Range: 0 to 1');
		});
	});
});
