import { describe, it, expect, vi } from 'vitest';
import {
	buildPromptTemplateOptions,
	buildProviderOptions,
	SessionSettingsModal,
} from '../../../src/ui/agent-view/session-settings-modal';

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

describe('buildProviderOptions (#1679)', () => {
	it('lists connected chat providers in registry order', () => {
		const connected = new Set(['anthropic', 'gemini']);
		const options = buildProviderOptions((p) => connected.has(p), undefined);

		expect(options).toEqual([
			{ provider: 'gemini', connected: true },
			{ provider: 'anthropic', connected: true },
		]);
	});

	it('keeps the session’s current provider listed, marked not connected, when it no longer qualifies', () => {
		const options = buildProviderOptions((p) => p === 'gemini', 'openrouter');

		expect(options).toEqual([
			{ provider: 'gemini', connected: true },
			{ provider: 'openrouter', connected: false },
		]);
	});

	it('does not duplicate a current provider that is already listed', () => {
		const options = buildProviderOptions((p) => p === 'gemini', 'gemini');
		expect(options).toEqual([{ provider: 'gemini', connected: true }]);
	});
});

describe('SessionSettingsModal model row (#1679)', () => {
	it('drops a model list that finishes after a newer render started', async () => {
		let resolveList!: (models: { value: string; label: string }[]) => void;
		const plugin = {
			settings: { features: {} },
			getModelManager: () => ({
				getAvailableModels: vi.fn(() => new Promise((resolve) => (resolveList = resolve))),
			}),
		};
		const modal = new SessionSettingsModal(
			{} as any,
			plugin as any,
			{ modelConfig: { provider: 'openai' } } as any,
			vi.fn()
		);
		const internals = modal as any;
		const container = document.createElement('div');

		internals.modelRenderId = 1;
		const stale = internals.renderModelSetting(container, 1);
		// The provider changes, so a newer render takes over before the list arrives.
		internals.modelRenderId = 2;
		resolveList([{ value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }]);
		await stale;

		expect(container.childElementCount).toBe(0);
	});
});
