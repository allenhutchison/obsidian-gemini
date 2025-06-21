import { GeminiModel, ModelRole } from '../models';
import { GoogleModel } from './model-discovery';

export class ModelMapper {
	/**
	 * Convert Google API models to our internal GeminiModel format
	 */
	static mapToGeminiModels(googleModels: GoogleModel[]): GeminiModel[] {
		const mappedModels = googleModels.map((model) => ({
			value: this.extractModelId(model.name),
			label: this.generateLabel(model),
			defaultForRoles: this.inferDefaultRoles(model),
		}));

		// Remove duplicates based on model value (ID)
		return this.deduplicateModels(mappedModels);
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

		// Get models that are currently set as defaults for each role
		const currentDefaults = this.getCurrentDefaultModels(existingModels);

		const mergedModels = discoveredModels.map((discovered) => {
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

		// Ensure we still have defaults for each role
		return this.ensureRoleDefaults(mergedModels, currentDefaults);
	}

	/**
	 * Get current default models for each role
	 */
	private static getCurrentDefaultModels(existingModels: GeminiModel[]): { [role in ModelRole]?: string } {
		const defaults: { [role in ModelRole]?: string } = {};

		for (const role of ['chat', 'summary', 'completions'] as ModelRole[]) {
			const defaultModel = existingModels.find((m) => m.defaultForRoles?.includes(role));
			if (defaultModel) {
				defaults[role] = defaultModel.value;
			}
		}

		return defaults;
	}

	/**
	 * Ensure each role has a default model assigned
	 */
	private static ensureRoleDefaults(
		models: GeminiModel[],
		currentDefaults: { [role in ModelRole]?: string }
	): GeminiModel[] {
		const modelsMap = new Map(models.map((m) => [m.value, m]));

		// Check each role and ensure it has a default
		for (const role of ['chat', 'summary', 'completions'] as ModelRole[]) {
			const currentDefault = currentDefaults[role];
			const hasDefault = models.some((m) => m.defaultForRoles?.includes(role));

			if (!hasDefault) {
				// Try to preserve the current default if it still exists
				if (currentDefault && modelsMap.has(currentDefault)) {
					const model = modelsMap.get(currentDefault)!;
					model.defaultForRoles = [...(model.defaultForRoles || []), role];
				} else {
					// Assign default to best matching model
					const bestMatch = this.findBestModelForRole(models, role);
					if (bestMatch && !bestMatch.defaultForRoles?.includes(role)) {
						bestMatch.defaultForRoles = [...(bestMatch.defaultForRoles || []), role];
					}
				}
			}
		}

		return models;
	}

	/**
	 * Find the best model for a given role based on naming patterns
	 */
	private static findBestModelForRole(models: GeminiModel[], role: ModelRole): GeminiModel | undefined {
		// Sort models by preference and find the best match for the role
		const sortedModels = this.sortModelsByPreference(models);

		for (const model of sortedModels) {
			const modelId = model.value.toLowerCase();

			switch (role) {
				case 'chat':
					if (modelId.includes('pro')) return model;
					break;
				case 'summary':
					if (modelId.includes('flash')) return model;
					break;
				case 'completions':
					if (modelId.includes('lite') || modelId.includes('flash')) return model;
					break;
			}
		}

		// Fallback to first model if no specific match found
		return sortedModels[0];
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
	static filterModels(
		models: GeminiModel[],
		criteria: { excludeExperimental?: boolean; minNameLength?: number } = {}
	): GeminiModel[] {
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
	 * Remove duplicate models based on model ID (value)
	 */
	static deduplicateModels(models: GeminiModel[]): GeminiModel[] {
		const seen = new Map<string, GeminiModel>();

		for (const model of models) {
			const existing = seen.get(model.value);

			if (!existing) {
				// First occurrence of this model ID
				seen.set(model.value, model);
			} else {
				// Duplicate found - prefer the one with better label or more complete info
				const preferNew = this.shouldPreferModel(model, existing);
				if (preferNew) {
					seen.set(model.value, model);
				}
			}
		}

		return Array.from(seen.values());
	}

	/**
	 * Determine which model to prefer when deduplicating
	 */
	private static shouldPreferModel(newModel: GeminiModel, existingModel: GeminiModel): boolean {
		// Prefer model with displayName over generated label
		const newHasDisplayName = !newModel.label.includes('-');
		const existingHasDisplayName = !existingModel.label.includes('-');

		if (newHasDisplayName !== existingHasDisplayName) {
			return newHasDisplayName;
		}

		// Prefer shorter, cleaner labels
		if (newModel.label.length !== existingModel.label.length) {
			return newModel.label.length < existingModel.label.length;
		}

		// Prefer more recent versions (if version info in the value)
		const newVersionMatch = newModel.value.match(/\d{2}-\d{2}$/);
		const existingVersionMatch = existingModel.value.match(/\d{2}-\d{2}$/);

		if (newVersionMatch && existingVersionMatch) {
			return newVersionMatch[0] > existingVersionMatch[0];
		}

		// Default to keeping existing
		return false;
	}

	/**
	 * Sort models by preference (version first, then family, then stability)
	 */
	static sortModelsByPreference(models: GeminiModel[]): GeminiModel[] {
		return [...models].sort((a, b) => {
			// Extract version numbers (2.5, 2.0, 1.5, 1.0)
			const getVersion = (value: string) => {
				const versionMatch = value.match(/gemini-(\d+(?:\.\d+)?)/i);
				return versionMatch ? parseFloat(versionMatch[1]) : 0;
			};

			const aVersion = getVersion(a.value);
			const bVersion = getVersion(b.value);

			// Sort by version (highest first: 2.5 > 2.0 > 1.5 > 1.0)
			if (aVersion !== bVersion) {
				return bVersion - aVersion;
			}

			// Within same version, sort by family (pro > flash > lite)
			const getFamilyPriority = (value: string) => {
				if (value.includes('pro')) return 3;
				if (value.includes('flash')) return 2;
				if (value.includes('lite')) return 1;
				return 0;
			};

			const aFamily = getFamilyPriority(a.value);
			const bFamily = getFamilyPriority(b.value);

			if (aFamily !== bFamily) {
				return bFamily - aFamily;
			}

			// Within same version and family, sort by date (newer dates first)
			const getDateVersion = (value: string) => {
				// Look for date patterns like "05-20", "04-17", etc.
				const dateMatch = value.match(/(\d{2})-(\d{2})$/);
				if (dateMatch) {
					const month = parseInt(dateMatch[1]);
					const day = parseInt(dateMatch[2]);
					// Convert to a sortable number (MMDD format)
					return month * 100 + day;
				}
				return 0;
			};

			const aDate = getDateVersion(a.value);
			const bDate = getDateVersion(b.value);

			// If both have dates, sort by date (newer first)
			if (aDate > 0 && bDate > 0) {
				return bDate - aDate;
			}

			// If only one has a date, prioritize the one with the date
			if (aDate > 0 && bDate === 0) {
				return -1;
			}
			if (bDate > 0 && aDate === 0) {
				return 1;
			}

			// Within same version, family, and date handling, stable models first
			const aStable = !a.value.includes('experimental') && !a.value.includes('preview');
			const bStable = !b.value.includes('experimental') && !b.value.includes('preview');

			if (aStable !== bStable) {
				return aStable ? -1 : 1;
			}

			// Finally by name alphabetically
			return a.value.localeCompare(b.value);
		});
	}
}
