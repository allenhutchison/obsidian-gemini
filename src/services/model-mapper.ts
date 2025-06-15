import { GeminiModel, ModelRole } from '../models';
import { GoogleModel } from './model-discovery';

export class ModelMapper {
	/**
	 * Convert Google API models to our internal GeminiModel format
	 */
	static mapToGeminiModels(googleModels: GoogleModel[]): GeminiModel[] {
		return googleModels.map((model) => ({
			value: this.extractModelId(model.name),
			label: this.generateLabel(model),
			defaultForRoles: this.inferDefaultRoles(model),
		}));
	}

	/**
	 * Extract model ID from full name (e.g., "models/gemini-1.5-flash" -> "gemini-1.5-flash")
	 */
	private static extractModelId(fullName: string): string {
		return fullName.replace(/^models\//, '');
	}

	/**
	 * Generate human-readable label from model data
	 */
	private static generateLabel(model: GoogleModel): string {
		if (model.displayName) {
			return model.displayName;
		}

		// Generate label from model name
		const modelId = this.extractModelId(model.name);
		return modelId
			.split('-')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	/**
	 * Infer appropriate roles based on model characteristics
	 */
	private static inferDefaultRoles(model: GoogleModel): ModelRole[] {
		const modelId = this.extractModelId(model.name).toLowerCase();
		const roles: ModelRole[] = [];

		// Role inference logic based on model name patterns
		if (modelId.includes('pro')) {
			roles.push('chat'); // Pro models for complex chat
		} else if (modelId.includes('flash')) {
			roles.push('summary'); // Flash models for quick tasks
		} else if (modelId.includes('lite')) {
			roles.push('completions'); // Lite models for simple completions
		}

		// Additional logic for specific model patterns
		if (modelId.includes('experimental') || modelId.includes('thinking')) {
			// Experimental or thinking models might be good for complex reasoning
			if (!roles.includes('chat')) {
				roles.push('chat');
			}
		}

		// Fallback: if no specific role, add chat as default
		if (roles.length === 0) {
			roles.push('chat');
		}

		return roles;
	}

	/**
	 * Preserve user customizations from existing models when merging with discovered models
	 */
	static mergeWithExistingModels(discoveredModels: GeminiModel[], existingModels: GeminiModel[]): GeminiModel[] {
		const existingMap = new Map(existingModels.map((model) => [model.value, model]));

		return discoveredModels.map((discovered) => {
			const existing = existingMap.get(discovered.value);
			if (existing) {
				// Preserve user customizations but update label if it has changed significantly
				return {
					...discovered,
					defaultForRoles: existing.defaultForRoles, // Keep user's role assignments
					label: this.shouldUpdateLabel(existing.label, discovered.label) ? discovered.label : existing.label,
				};
			}
			return discovered;
		});
	}

	/**
	 * Determine if we should update the label based on changes
	 */
	private static shouldUpdateLabel(existingLabel: string, discoveredLabel: string): boolean {
		// Only update if the discovered label is significantly different
		// (e.g., not just case changes or minor formatting differences)
		const normalizeLabel = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '');
		const existingNormalized = normalizeLabel(existingLabel);
		const discoveredNormalized = normalizeLabel(discoveredLabel);

		return existingNormalized !== discoveredNormalized;
	}

	/**
	 * Filter models based on criteria (for future use)
	 */
	static filterModels(models: GeminiModel[], criteria: { excludeExperimental?: boolean; minNameLength?: number } = {}): GeminiModel[] {
		return models.filter((model) => {
			if (criteria.excludeExperimental && model.value.includes('experimental')) {
				return false;
			}
			if (criteria.minNameLength && model.value.length < criteria.minNameLength) {
				return false;
			}
			return true;
		});
	}

	/**
	 * Sort models by preference (stable models first, then by version)
	 */
	static sortModelsByPreference(models: GeminiModel[]): GeminiModel[] {
		return [...models].sort((a, b) => {
			// Stable models first
			const aStable = !a.value.includes('experimental') && !a.value.includes('preview');
			const bStable = !b.value.includes('experimental') && !b.value.includes('preview');

			if (aStable !== bStable) {
				return bStable ? 1 : -1;
			}

			// Then by model family (pro > flash > lite)
			const getModelPriority = (value: string) => {
				if (value.includes('pro')) return 3;
				if (value.includes('flash')) return 2;
				if (value.includes('lite')) return 1;
				return 0;
			};

			const aPriority = getModelPriority(a.value);
			const bPriority = getModelPriority(b.value);

			if (aPriority !== bPriority) {
				return bPriority - aPriority;
			}

			// Finally by name alphabetically
			return a.value.localeCompare(b.value);
		});
	}
}