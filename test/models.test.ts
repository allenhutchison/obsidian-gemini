import {
	DEFAULT_GEMINI_MODELS,
	GEMINI_MODELS,
	getActiveChatModel,
	getDefaultModelForRole,
	GeminiModel,
	getUpdatedModelSettings,
	isInteractionsOnlyModel,
	migrateOllamaModelSetting,
	resolveGenerateContentModel,
	RETIRED_MODEL_SUCCESSORS,
	setGeminiModels,
} from '../src/models';

// Helper to temporarily modify GEMINI_MODELS for specific tests
const setTestModels = (models: GeminiModel[]) => {
	setGeminiModels(models);
};

describe('getDefaultModelForRole', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		// Save and restore original models for each test to ensure isolation
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('should return the model specified as default for a role', () => {
		setTestModels([
			{ value: 'model-a', label: 'Model A' },
			{ value: 'model-b-chat', label: 'Model B Chat', defaultForRoles: ['chat'] },
			{ value: 'model-c', label: 'Model C' },
		]);
		expect(getDefaultModelForRole('chat')).toBe('model-b-chat');
	});

	it('should fall back to the first model if no specific default is set for a role', () => {
		setTestModels([
			{ value: 'model-first', label: 'First Model' },
			{ value: 'model-second', label: 'Second Model' },
		]);
		// 'summary' role has no explicit default here
		expect(getDefaultModelForRole('summary')).toBe('model-first');
	});

	it('should not log a warning when falling back to the first model (warning removed)', () => {
		setTestModels([
			{ value: 'fallback-model', label: 'Fallback Model' },
			{ value: 'another-model', label: 'Another Model' },
		]);
		const consoleWarnSpy = vi.spyOn(console, 'warn');
		const result = getDefaultModelForRole('completions'); // No explicit default for completions

		// Should still fall back to first model, but no warning logged
		expect(result).toBe('fallback-model');
		expect(consoleWarnSpy).not.toHaveBeenCalled();
		consoleWarnSpy.mockRestore();
	});

	it('should throw an error if GEMINI_MODELS is empty', () => {
		setTestModels([]); // Make GEMINI_MODELS empty
		expect(() => getDefaultModelForRole('chat')).toThrow(
			'CRITICAL: GEMINI_MODELS array is empty. Please configure available models.'
		);
	});

	// This test checks the actual imported GEMINI_MODELS state
	it('should ensure the global GEMINI_MODELS array is never actually empty', async () => {
		// This test relies on the original state of GEMINI_MODELS before any test modifications
		// If originalModels was captured from an already empty state, this test would be misleading.
		// This is more of an assertion about your actual data.
		const actualImportedModels = (await vi.importActual<typeof import('../src/models')>('../src/models')).GEMINI_MODELS;
		expect(actualImportedModels.length).toBeGreaterThan(0);
	});

	it('should return the completions model when completions role is specified', () => {
		// Assuming originalModels has a default for 'completions'
		// Or add a specific setup if needed:
		setTestModels([
			{ value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
		]);
		expect(getDefaultModelForRole('completions')).toBe('gemini-2.0-flash-lite');
	});

	it('should return the summary model when summary role is specified', () => {
		setTestModels([
			{ value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', defaultForRoles: ['chat'] },
			{ value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash', defaultForRoles: ['summary'] },
			{ value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', defaultForRoles: ['completions'] },
		]);
		expect(getDefaultModelForRole('summary')).toBe('gemini-2.5-flash-preview-04-17');
	});
});

describe('getUpdatedModelSettings', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		// Setup default test models
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
			{ value: 'gemini-image-default', label: 'Image Default', defaultForRoles: ['image'] },
			{ value: 'gemini-another-model', label: 'Another Model' },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('should not change settings if all current models are valid and available', () => {
		const currentSettings = {
			chatModelName: 'gemini-chat-default',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(false);
		expect(result.updatedSettings).toEqual(currentSettings);
		expect(result.changedSettingsInfo).toEqual([]);
	});

	it('should update chatModelName to default if current is invalid/unavailable', () => {
		const currentSettings = {
			chatModelName: 'invalid-chat-model',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default');
		expect(result.updatedSettings.summaryModelName).toBe('gemini-summary-default'); // Should remain unchanged
		expect(result.updatedSettings.completionsModelName).toBe('gemini-completions-default'); // Should remain unchanged
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'invalid-chat-model' -> 'gemini-chat-default' (legacy model update)",
		]);
	});

	it('should update summaryModelName to default if current is invalid/unavailable', () => {
		const currentSettings = {
			chatModelName: 'gemini-chat-default',
			summaryModelName: 'invalid-summary-model',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.summaryModelName).toBe('gemini-summary-default');
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default'); // Should remain unchanged
		expect(result.updatedSettings.completionsModelName).toBe('gemini-completions-default'); // Should remain unchanged
		expect(result.changedSettingsInfo).toEqual([
			"Summary model: 'invalid-summary-model' -> 'gemini-summary-default' (legacy model update)",
		]);
	});

	it('should update completionsModelName to default if current is invalid/unavailable', () => {
		const currentSettings = {
			chatModelName: 'gemini-chat-default',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'invalid-completions-model',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.completionsModelName).toBe('gemini-completions-default');
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default'); // Should remain unchanged
		expect(result.updatedSettings.summaryModelName).toBe('gemini-summary-default'); // Should remain unchanged
		expect(result.changedSettingsInfo).toEqual([
			"Completions model: 'invalid-completions-model' -> 'gemini-completions-default' (legacy model update)",
		]);
	});

	it('should update multiple model names if they are invalid', () => {
		const currentSettings = {
			chatModelName: 'invalid-chat-model',
			summaryModelName: 'invalid-summary-model',
			completionsModelName: 'gemini-completions-default', // This one is valid
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default');
		expect(result.updatedSettings.summaryModelName).toBe('gemini-summary-default');
		expect(result.updatedSettings.completionsModelName).toBe('gemini-completions-default');
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'invalid-chat-model' -> 'gemini-chat-default' (legacy model update)",
			"Summary model: 'invalid-summary-model' -> 'gemini-summary-default' (legacy model update)",
		]);
	});

	it('should update all model names if all are invalid', () => {
		const currentSettings = {
			chatModelName: 'invalid-chat-model',
			summaryModelName: 'invalid-summary-model',
			completionsModelName: 'invalid-completions-model',
			imageModelName: 'invalid-image-model',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default');
		expect(result.updatedSettings.summaryModelName).toBe('gemini-summary-default');
		expect(result.updatedSettings.completionsModelName).toBe('gemini-completions-default');
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'invalid-chat-model' -> 'gemini-chat-default' (legacy model update)",
			"Summary model: 'invalid-summary-model' -> 'gemini-summary-default' (legacy model update)",
			"Completions model: 'invalid-completions-model' -> 'gemini-completions-default' (legacy model update)",
			"Image model: 'invalid-image-model' -> 'gemini-image-default' (legacy model update)",
		]);
	});

	it('should update to the first model in GEMINI_MODELS if no role-specific default exists for an invalid model', () => {
		// No model has defaultForRoles: ['chat'] in this setup
		setTestModels([
			{ value: 'first-model-in-list', label: 'First Model' },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
		]);
		const currentSettings = {
			chatModelName: 'invalid-chat-model', // This needs update
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default', // This one is valid (but not in list, so it will be updated too? No, wait, it's not in list so it will be updated to first model)
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('first-model-in-list'); // Falls back to first model
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'invalid-chat-model' -> 'first-model-in-list' (legacy model update)",
			"Image model: 'gemini-image-default' -> 'first-model-in-list' (legacy model update)",
		]);
	});

	it('migrates a retired model to its designated successor instead of the role default', () => {
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
			{ value: 'gemini-image-default', label: 'Image Default', defaultForRoles: ['image'] },
			{ value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
		]);
		const currentSettings = {
			chatModelName: 'gemini-3-pro-preview', // retired by Google (404 "no longer available")
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('gemini-3.1-pro-preview');
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'gemini-3-pro-preview' -> 'gemini-3.1-pro-preview' (retired model migrated to successor)",
		]);
	});

	it('migrates a retired model even when a stale model list still advertises it', () => {
		// GEMINI_MODELS can be populated from a persisted remoteModelCache that
		// predates the retirement, so the retired id may still pass the validity
		// check — it must migrate anyway, since Google 404s it server-side.
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
			{ value: 'gemini-image-default', label: 'Image Default', defaultForRoles: ['image'] },
			{ value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' }, // stale cache entry
			{ value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
		]);
		const currentSettings = {
			chatModelName: 'gemini-3-pro-preview',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('gemini-3.1-pro-preview');
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'gemini-3-pro-preview' -> 'gemini-3.1-pro-preview' (retired model migrated to successor)",
		]);
	});

	it('falls back to the role default when a retired model’s successor is not in the list', () => {
		// Default test models from beforeEach do NOT include gemini-3.1-pro-preview.
		const currentSettings = {
			chatModelName: 'gemini-3-pro-preview',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default');
		expect(result.changedSettingsInfo).toEqual([
			"Chat model: 'gemini-3-pro-preview' -> 'gemini-chat-default' (legacy model update)",
		]);
	});

	it('tolerates an empty Ollama model while the daemon list has not loaded yet', () => {
		// Only Gemini models are registered here — the Ollama list loads later via
		// /api/tags. The Gemini fields stay valid and the empty ollamaModelName is
		// left untouched (rather than throwing or blanking a Gemini field).
		const currentSettings = {
			provider: 'ollama',
			chatModelName: 'gemini-chat-default',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
			ollamaModelName: '',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(false);
		expect(result.updatedSettings.ollamaModelName).toBe('');
		expect(result.changedSettingsInfo).toEqual([]);
	});

	it('backfills an empty Ollama model once the daemon list has loaded', () => {
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
			{ value: 'gemini-image-default', label: 'Image Default', defaultForRoles: ['image'] },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
			{ value: 'mistral', label: 'Mistral', provider: 'ollama' as const },
		]);
		const currentSettings = {
			provider: 'ollama',
			chatModelName: 'gemini-chat-default',
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
			ollamaModelName: '',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(true);
		expect(result.updatedSettings.ollamaModelName).toBe('llama3.2');
		// Gemini fields are preserved across an Ollama-active reconcile.
		expect(result.updatedSettings.chatModelName).toBe('gemini-chat-default');
	});

	it('preserves the Gemini model fields when the active provider is Ollama (#1125 regression)', () => {
		// The core of the fix: reconciling while Ollama is active must never touch
		// the Gemini per-use-case fields, so a Gemini → Ollama → Gemini round trip
		// keeps the user's Gemini chat model instead of resetting it to the default.
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-flash-lite', label: 'Flash Lite' },
			{ value: 'gemini-summary-default', label: 'Summary Default', defaultForRoles: ['summary'] },
			{ value: 'gemini-completions-default', label: 'Completions Default', defaultForRoles: ['completions'] },
			{ value: 'gemini-image-default', label: 'Image Default', defaultForRoles: ['image'] },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
		]);
		const currentSettings = {
			provider: 'ollama',
			chatModelName: 'gemini-flash-lite', // a non-default Gemini choice
			summaryModelName: 'gemini-summary-default',
			completionsModelName: 'gemini-completions-default',
			imageModelName: 'gemini-image-default',
			ollamaModelName: 'llama3.2',
		};
		const result = getUpdatedModelSettings(currentSettings);
		expect(result.settingsChanged).toBe(false);
		expect(result.updatedSettings.chatModelName).toBe('gemini-flash-lite');
		expect(result.updatedSettings.ollamaModelName).toBe('llama3.2');
	});

	it('should propagate error if GEMINI_MODELS is empty and a model update is attempted', () => {
		setTestModels([]); // GEMINI_MODELS is empty
		const currentSettings = {
			chatModelName: 'any-model', // This will trigger a call to getDefaultModelForRole
			summaryModelName: 'any-other-model',
			completionsModelName: 'yet-another-model',
			imageModelName: 'and-another-one',
		};
		// Expect getUpdatedModelSettings to throw the error from getDefaultModelForRole
		expect(() => getUpdatedModelSettings(currentSettings)).toThrow(
			'CRITICAL: GEMINI_MODELS array is empty. Please configure available models.'
		);
	});
});

describe('bundled model catalog', () => {
	it('no longer ships retired models, and every retired model’s successor is bundled', () => {
		const bundledIds = new Set(DEFAULT_GEMINI_MODELS.map((m) => m.value));
		for (const [retired, successor] of Object.entries(RETIRED_MODEL_SUCCESSORS)) {
			// Retired models must be out of the catalog (the API 404s on them)...
			expect(bundledIds.has(retired)).toBe(false);
			// ...and their successor must still be live, or the migration is a no-op.
			expect(bundledIds.has(successor)).toBe(true);
		}
	});
});

describe('getActiveChatModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([
			{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] },
			{ value: 'gemini-flash-lite', label: 'Flash Lite' },
			{ value: 'llama3.2', label: 'Llama 3.2', provider: 'ollama' as const, defaultForRoles: ['chat'] },
		]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('returns chatModelName under the Gemini provider', () => {
		expect(
			getActiveChatModel({ provider: 'gemini', chatModelName: 'gemini-flash-lite', ollamaModelName: 'llama3.2' })
		).toBe('gemini-flash-lite');
	});

	it('defaults to the provider when no explicit provider is set', () => {
		expect(getActiveChatModel({ chatModelName: 'gemini-flash-lite' })).toBe('gemini-flash-lite');
	});

	it('returns ollamaModelName under the Ollama provider', () => {
		expect(
			getActiveChatModel({ provider: 'ollama', chatModelName: 'gemini-flash-lite', ollamaModelName: 'llama3.2' })
		).toBe('llama3.2');
	});

	it('falls back to the Gemini chat default when chatModelName is empty', () => {
		expect(getActiveChatModel({ provider: 'gemini', chatModelName: '' })).toBe('gemini-chat-default');
	});

	it('falls back to the Ollama chat default when ollamaModelName is empty', () => {
		expect(getActiveChatModel({ provider: 'ollama', chatModelName: 'gemini-flash-lite', ollamaModelName: '' })).toBe(
			'llama3.2'
		);
	});
});

describe('migrateOllamaModelSetting', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
		setTestModels([{ value: 'gemini-chat-default', label: 'Chat Default', defaultForRoles: ['chat'] }]);
	});

	afterEach(() => {
		setTestModels(originalModels);
	});

	it('moves the legacy Ollama chatModelName into ollamaModelName and resets chatModelName', () => {
		// The pre-migration shape: an Ollama user whose data.json predates
		// ollamaModelName (so rawData.ollamaModelName is undefined) and whose
		// chatModelName holds the Ollama model.
		const rawData = { provider: 'ollama', chatModelName: 'gemma4:31b-mlx' };
		const settings = { provider: 'ollama' as const, chatModelName: 'gemma4:31b-mlx', ollamaModelName: '' };

		const migrated = migrateOllamaModelSetting(settings, rawData);

		expect(migrated).toBe(true);
		expect(settings.ollamaModelName).toBe('gemma4:31b-mlx');
		expect(settings.chatModelName).toBe('gemini-chat-default');
	});

	it('does not migrate a Gemini user (leaves chatModelName intact)', () => {
		const rawData = { provider: 'gemini', chatModelName: 'gemini-chat-default' };
		const settings = { provider: 'gemini' as const, chatModelName: 'gemini-chat-default', ollamaModelName: '' };

		const migrated = migrateOllamaModelSetting(settings, rawData);

		expect(migrated).toBe(false);
		expect(settings.chatModelName).toBe('gemini-chat-default');
		expect(settings.ollamaModelName).toBe('');
	});

	it('does not migrate when the data already has ollamaModelName (already migrated)', () => {
		const rawData = { provider: 'ollama', chatModelName: 'gemini-chat-default', ollamaModelName: 'llama3.2' };
		const settings = { provider: 'ollama' as const, chatModelName: 'gemini-chat-default', ollamaModelName: 'llama3.2' };

		const migrated = migrateOllamaModelSetting(settings, rawData);

		expect(migrated).toBe(false);
		expect(settings.chatModelName).toBe('gemini-chat-default');
		expect(settings.ollamaModelName).toBe('llama3.2');
	});

	it('does not migrate a first-run install (no persisted data)', () => {
		const settings = { provider: 'ollama' as const, chatModelName: 'gemini-chat-default', ollamaModelName: '' };

		expect(migrateOllamaModelSetting(settings, null)).toBe(false);
		expect(migrateOllamaModelSetting(settings, undefined)).toBe(false);
	});

	it('tolerates an empty legacy chatModelName', () => {
		const rawData = { provider: 'ollama', chatModelName: '' };
		const settings = { provider: 'ollama' as const, chatModelName: '', ollamaModelName: '' };

		const migrated = migrateOllamaModelSetting(settings, rawData);

		expect(migrated).toBe(true);
		expect(settings.ollamaModelName).toBe('');
		expect(settings.chatModelName).toBe('gemini-chat-default');
	});
});

describe('isInteractionsOnlyModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('flags the bundled gemini-omni-flash-preview as interactions-only', () => {
		expect(isInteractionsOnlyModel('gemini-omni-flash-preview')).toBe(true);
	});

	it('returns false for regular bundled models', () => {
		expect(isInteractionsOnlyModel('gemini-flash-latest')).toBe(false);
		expect(isInteractionsOnlyModel('gemini-2.5-flash')).toBe(false);
	});

	it('returns false for unknown models and empty values', () => {
		expect(isInteractionsOnlyModel('some-unknown-model')).toBe(false);
		expect(isInteractionsOnlyModel('')).toBe(false);
		expect(isInteractionsOnlyModel(undefined)).toBe(false);
		expect(isInteractionsOnlyModel(null)).toBe(false);
	});

	it('reads the flag from the live model list (remote updates)', () => {
		setGeminiModels([{ value: 'future-interactions-model', label: 'Future', interactionsOnly: true }]);
		expect(isInteractionsOnlyModel('future-interactions-model')).toBe(true);
	});

	it('falls back to the bundled defaults when the live list lacks the entry (stale remote cache)', () => {
		// Simulate a remote cache fetched before the flag existed: the live list
		// carries the model without the flag... actually without the entry at all.
		setGeminiModels([{ value: 'gemini-flash-latest', label: 'Gemini Flash Latest' }]);
		expect(isInteractionsOnlyModel('gemini-omni-flash-preview')).toBe(true);
	});

	it('honors an explicit false in the live list over the bundled flag', () => {
		setGeminiModels([{ value: 'gemini-omni-flash-preview', label: 'Omni', interactionsOnly: false }]);
		expect(isInteractionsOnlyModel('gemini-omni-flash-preview')).toBe(false);
	});
});

describe('resolveGenerateContentModel', () => {
	let originalModels: GeminiModel[];

	beforeEach(() => {
		originalModels = [...GEMINI_MODELS];
	});

	afterEach(() => {
		setGeminiModels(originalModels);
	});

	it('returns the preferred model when it can use generateContent', () => {
		expect(resolveGenerateContentModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
	});

	it('substitutes the bundled chat default for an interactions-only model', () => {
		expect(resolveGenerateContentModel('gemini-omni-flash-preview')).toBe('gemini-flash-latest');
	});

	it('substitutes the bundled default for empty values', () => {
		expect(resolveGenerateContentModel('')).toBe('gemini-flash-latest');
		expect(resolveGenerateContentModel(undefined)).toBe('gemini-flash-latest');
	});

	it('resolves against the requested role', () => {
		expect(resolveGenerateContentModel('gemini-omni-flash-preview', 'completions')).toBe('gemini-flash-lite-latest');
	});
});
