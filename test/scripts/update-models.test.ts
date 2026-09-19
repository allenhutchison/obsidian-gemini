import { describe, expect, it } from 'vitest';
import { shouldIncludeModel } from '../../scripts/update-models.mjs';

/**
 * shouldIncludeModel decides what the weekly model-update PR picks up from
 * ListModels. These cases pin the Gemma-4 opt-in (#1484): served Gemini-API
 * Gemma variants are included by prefix despite the blanket `gemma` exclusion,
 * while everything else — older Gemma generations, non-generative methods,
 * and the existing exclusions — keeps its current verdict.
 */
describe('update-models shouldIncludeModel', () => {
	it('includes the served gemma-4 models', () => {
		expect(
			shouldIncludeModel({
				name: 'models/gemma-4-31b-it',
				supportedGenerationMethods: ['generateContent', 'countTokens'],
			})
		).toBe(true);
		expect(
			shouldIncludeModel({
				name: 'models/gemma-4-26b-a4b-it',
				supportedGenerationMethods: ['generateContent', 'countTokens'],
			})
		).toBe(true);
	});

	it('includes future gemma-4 variants that arrive in ListModels', () => {
		expect(shouldIncludeModel({ name: 'models/gemma-4-12b-it', supportedGenerationMethods: ['generateContent'] })).toBe(
			true
		);
	});

	it('excludes older Gemma generations — the opt-in is gemma-4-* only', () => {
		expect(shouldIncludeModel({ name: 'models/gemma-3-27b-it', supportedGenerationMethods: ['generateContent'] })).toBe(
			false
		);
		expect(
			shouldIncludeModel({ name: 'models/gemma-3n-e4b-it', supportedGenerationMethods: ['generateContent'] })
		).toBe(false);
	});

	it('still requires generateContent support for gemma-4 models', () => {
		expect(shouldIncludeModel({ name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['countTokens'] })).toBe(
			false
		);
	});

	it('keeps the gemini name requirement for everything else', () => {
		expect(
			shouldIncludeModel({ name: 'models/text-embedding-004', supportedGenerationMethods: ['generateContent'] })
		).toBe(false);
	});

	it('keeps the existing exclusion patterns intact', () => {
		// gemini-2.0 is excluded by EXCLUDE_PATTERNS
		expect(
			shouldIncludeModel({ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] })
		).toBe(false);
		// a plain gemini model still passes
		expect(shouldIncludeModel({ name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] })).toBe(
			true
		);
	});
});
