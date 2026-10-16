import { describe, it, expect } from 'vitest';
import { buildPromptTemplateOptions } from '../../../src/ui/agent-view/session-settings-modal';

describe('buildPromptTemplateOptions', () => {
	const folder = 'gemini-scribe/Prompts';

	it('labels prompts by their path relative to the prompts folder, sorted', () => {
		const options = buildPromptTemplateOptions(
			[`${folder}/Writing/academic.md`, `${folder}/expert.md`, `${folder}/Coding/review.md`],
			folder,
			undefined
		);

		expect(options).toEqual([
			{ path: `${folder}/Coding/review.md`, label: 'Coding/review' },
			{ path: `${folder}/expert.md`, label: 'expert' },
			{ path: `${folder}/Writing/academic.md`, label: 'Writing/academic' },
		]);
	});

	it('keeps the session’s current template selectable when it is no longer listed', () => {
		const options = buildPromptTemplateOptions([`${folder}/expert.md`], folder, `${folder}/translate.md`);

		expect(options).toContainEqual({ path: `${folder}/translate.md`, label: 'translate' });
		expect(options).toHaveLength(2);
	});

	it('does not duplicate a current template that is already listed', () => {
		const options = buildPromptTemplateOptions([`${folder}/expert.md`], folder, `${folder}/expert.md`);

		expect(options).toHaveLength(1);
	});
});
