import {
	mapGeminiModelList,
	shouldIncludeModel,
	type GeminiListModelsEntry,
} from '../../../../src/api/providers/gemini/model-catalog';

const gen = (id: string, extra: Partial<GeminiListModelsEntry> = {}): GeminiListModelsEntry => ({
	name: `models/${id}`,
	supportedGenerationMethods: ['generateContent', 'countTokens'],
	...extra,
});

describe('shouldIncludeModel', () => {
	it('includes ordinary Gemini chat and image models', () => {
		expect(shouldIncludeModel(gen('gemini-3.8-flash'))).toBe(true);
		expect(shouldIncludeModel(gen('gemini-flash-latest'))).toBe(true);
		expect(shouldIncludeModel(gen('gemini-3.1-flash-image'))).toBe(true);
	});

	it('requires generateContent support', () => {
		expect(shouldIncludeModel(gen('gemini-3.8-flash', { supportedGenerationMethods: ['countTokens'] }))).toBe(false);
		expect(shouldIncludeModel({ name: 'models/gemini-3.8-flash' })).toBe(false);
	});

	it('opts in the served gemma-4 models only', () => {
		expect(shouldIncludeModel(gen('gemma-4-31b-it'))).toBe(true);
		expect(shouldIncludeModel(gen('gemma-4-12b-it'))).toBe(true);
		expect(shouldIncludeModel(gen('gemma-3-27b-it'))).toBe(false);
	});

	it('excludes non-chat and retired models', () => {
		for (const id of [
			'text-embedding-004',
			'gemini-embedding-001',
			'gemini-2.5-flash-preview-tts',
			'veo-3.0-generate-001',
			'imagen-4.0-generate-001',
			'gemini-2.0-flash',
			'gemini-robotics-er-1.5-preview',
			'gemini-2.5-computer-use-preview-10-2025',
			'gemini-3-pro-preview',
			'gemini-3-flash-transcribe',
			'gemini-omni-1.2-flash',
			'gemini-omni-flash-preview',
		]) {
			expect(shouldIncludeModel(gen(id))).toBe(false);
		}
	});
});

describe('mapGeminiModelList', () => {
	it('maps names, display names, temperature and context window', () => {
		const [model] = mapGeminiModelList([
			gen('gemini-3.8-flash', { displayName: 'Gemini 3.8 Flash', maxTemperature: 1.5, inputTokenLimit: 1_048_576 }),
		]);
		expect(model).toMatchObject({
			value: 'gemini-3.8-flash',
			label: 'Gemini 3.8 Flash',
			provider: 'gemini',
			maxTemperature: 1.5,
			contextWindow: 1_048_576,
		});
		expect(model.supportsImageGeneration).toBeUndefined();
	});

	it('falls back to the id for the label and 2 for the max temperature', () => {
		const [model] = mapGeminiModelList([gen('gemini-3.8-flash')]);
		expect(model.label).toBe('gemini-3.8-flash');
		expect(model.maxTemperature).toBe(2);
		expect(model.contextWindow).toBeUndefined();
	});

	it('flags image models by id', () => {
		const models = mapGeminiModelList([gen('gemini-3.1-flash-image'), gen('gemini-nano-banana-2.1')]);
		expect(models.every((m) => m.supportsImageGeneration)).toBe(true);
	});

	it('hides a preview once its GA version is listed', () => {
		const ids = mapGeminiModelList([
			gen('gemini-3.5-flash-preview-09-2026'),
			gen('gemini-3.5-flash'),
			gen('gemini-3.6-flash-preview'),
		]).map((m) => m.value);
		expect(ids).toEqual(['gemini-3.5-flash', 'gemini-3.6-flash-preview']);
	});

	it('drops duplicate entries', () => {
		expect(mapGeminiModelList([gen('gemini-3.8-flash'), gen('gemini-3.8-flash')])).toHaveLength(1);
	});

	it('puts the -latest aliases first and stamps them as role defaults', () => {
		const models = mapGeminiModelList([
			gen('gemini-3.8-flash'),
			gen('gemini-flash-latest'),
			gen('gemini-flash-lite-latest'),
			gen('gemini-2.5-flash-image'),
		]);
		expect(models.map((m) => m.value)).toEqual([
			'gemini-flash-latest',
			'gemini-flash-lite-latest',
			'gemini-3.8-flash',
			'gemini-2.5-flash-image',
		]);
		const defaults = Object.fromEntries(models.map((m) => [m.value, m.defaultForRoles]));
		expect(defaults['gemini-flash-latest']).toEqual(['chat', 'summary', 'rewrite']);
		expect(defaults['gemini-flash-lite-latest']).toEqual(['completions']);
		expect(defaults['gemini-2.5-flash-image']).toEqual(['image']);
		expect(defaults['gemini-3.8-flash']).toBeUndefined();
	});

	it('falls back to the newest versioned model when the aliases are missing', () => {
		const models = mapGeminiModelList([
			gen('gemini-3.5-flash'),
			gen('gemini-3.8-flash'),
			gen('gemini-3.5-flash-lite'),
			gen('gemini-3.1-flash-image'),
		]);
		const byRole = (role: string) => models.find((m) => m.defaultForRoles?.includes(role as never))?.value;
		expect(byRole('chat')).toBe('gemini-3.8-flash');
		expect(byRole('completions')).toBe('gemini-3.5-flash-lite');
		expect(byRole('image')).toBe('gemini-3.1-flash-image');
	});
});
