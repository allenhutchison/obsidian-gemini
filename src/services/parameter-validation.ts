import { GeminiModel } from '../models';

export interface ParameterRanges {
	temperature: {
		min: number;
		max: number;
		step: number;
	};
	topP: {
		min: number;
		max: number;
		step: number;
	};
}

export interface ModelParameterInfo {
	modelName: string;
	maxTemperature?: number;
}

export class ParameterValidationService {
	/**
	 * Default fallback ranges when no model information is available
	 */
	private static readonly DEFAULT_RANGES: ParameterRanges = {
		temperature: { min: 0, max: 2, step: 0.1 },
		topP: { min: 0, max: 1, step: 0.01 },
	};

	/**
	 * Get parameter ranges based on model information
	 */
	static getParameterRanges(models: GeminiModel[]): ParameterRanges {
		if (!models || models.length === 0) {
			return this.DEFAULT_RANGES;
		}

		const maxTemperatures = models
			.map((model) => model.maxTemperature)
			.filter((temp) => temp !== undefined && temp !== null) as number[];

		const maxTemp =
			maxTemperatures.length > 0
				? maxTemperatures.reduce((max, temp) => Math.max(max, temp), 0)
				: this.DEFAULT_RANGES.temperature.max;

		return {
			temperature: {
				min: 0,
				max: Math.max(maxTemp, 1),
				step: 0.1,
			},
			topP: {
				min: 0,
				max: 1,
				step: 0.01,
			},
		};
	}

	/**
	 * Validate temperature value against model capabilities
	 */
	static validateTemperature(
		value: number,
		modelName?: string,
		models: GeminiModel[] = []
	): {
		isValid: boolean;
		adjustedValue?: number;
		warning?: string;
	} {
		if (modelName) {
			const modelInfo = models.find((m) => m.value === modelName);
			if (modelInfo?.maxTemperature !== undefined && value > modelInfo.maxTemperature) {
				return {
					isValid: false,
					adjustedValue: modelInfo.maxTemperature,
					warning: `Temperature ${value} exceeds ${modelName} limit of ${modelInfo.maxTemperature}. Adjusted to ${modelInfo.maxTemperature}.`,
				};
			}
		}

		const ranges = this.getParameterRanges(models);

		if (value < ranges.temperature.min || value > ranges.temperature.max) {
			const adjustedValue = Math.max(ranges.temperature.min, Math.min(ranges.temperature.max, value));
			return {
				isValid: false,
				adjustedValue,
				warning: `Temperature ${value} is outside valid range [${ranges.temperature.min}, ${ranges.temperature.max}]. Adjusted to ${adjustedValue}.`,
			};
		}

		return { isValid: true };
	}

	/**
	 * Validate topP value
	 */
	static validateTopP(
		value: number,
		_modelName?: string,
		models: GeminiModel[] = []
	): {
		isValid: boolean;
		adjustedValue?: number;
		warning?: string;
	} {
		const ranges = this.getParameterRanges(models);

		if (value < ranges.topP.min || value > ranges.topP.max) {
			const adjustedValue = Math.max(ranges.topP.min, Math.min(ranges.topP.max, value));
			return {
				isValid: false,
				adjustedValue,
				warning: `Top P ${value} is outside valid range [${ranges.topP.min}, ${ranges.topP.max}]. Adjusted to ${adjustedValue}.`,
			};
		}

		return { isValid: true };
	}

	/**
	 * Get user-friendly parameter information for display in settings
	 */
	static getParameterDisplayInfo(models: GeminiModel[]): {
		temperature: string;
		topP: string;
		hasModelData: boolean;
	} {
		const ranges = this.getParameterRanges(models);
		const hasModelData = models && models.length > 0;

		return {
			temperature: `Range: ${ranges.temperature.min} to ${ranges.temperature.max}`,
			topP: `Range: ${ranges.topP.min} to ${ranges.topP.max}`,
			hasModelData,
		};
	}
}
