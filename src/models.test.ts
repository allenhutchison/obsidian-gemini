import { GEMINI_MODELS, getDefaultModelForRole, ModelRole, GeminiModel } from './models';

// Helper to temporarily modify GEMINI_MODELS for specific tests
const setTestModels = (models: GeminiModel[]) => {
	// In a real test environment, you might need to mock the import or use a DI pattern.
	// For this example, we'll assume we can temporarily overwrite it.
	// This is a simplified approach; consider module mocking for robust testing.
	(GEMINI_MODELS as any).length = 0; // Clear the array
	models.forEach(model => (GEMINI_MODELS as any).push(model));
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

	it('should log a warning when falling back to the first model', () => {
		setTestModels([
			{ value: 'fallback-model', label: 'Fallback Model' },
			{ value: 'another-model', label: 'Another Model' },
		]);
		const consoleWarnSpy = jest.spyOn(console, 'warn');
		getDefaultModelForRole('completions'); // No explicit default for completions
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"No default model specified for role 'completions'. Falling back to the first model in GEMINI_MODELS: Fallback Model"
		);
		consoleWarnSpy.mockRestore();
	});

	it('should throw an error if GEMINI_MODELS is empty', () => {
		setTestModels([]); // Make GEMINI_MODELS empty
		expect(() => getDefaultModelForRole('chat')).toThrow(
			'CRITICAL: GEMINI_MODELS array is empty. Please configure available models.'
		);
	});

	// This test checks the actual imported GEMINI_MODELS state
	it('should ensure the global GEMINI_MODELS array is never actually empty', () => {
		// This test relies on the original state of GEMINI_MODELS before any test modifications
		// If originalModels was captured from an already empty state, this test would be misleading.
		// This is more of an assertion about your actual data.
		const actualImportedModels = jest.requireActual<typeof import('./models')>('./models').GEMINI_MODELS;
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