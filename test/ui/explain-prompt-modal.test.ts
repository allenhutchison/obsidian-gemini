import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExplainPromptSelectionModal } from '../../src/ui/explain-prompt-modal';
import type { PromptInfo, CustomPrompt } from '../../src/prompts/types';

// Flush enough microtask turns for the fire-and-forget `chooseSuggestion`
// (loadPrompt await + onSelect await) to settle.
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

function makePromptInfo(overrides: Partial<PromptInfo> = {}): PromptInfo {
	return {
		name: 'Explain',
		description: '',
		tags: [],
		path: 'Prompts/explain.md',
		...overrides,
	};
}

describe('ExplainPromptSelectionModal error handling', () => {
	let logger: { error: ReturnType<typeof vi.fn> };
	let loadPrompt: ReturnType<typeof vi.fn>;
	let plugin: any;

	beforeEach(() => {
		logger = { error: vi.fn() };
		loadPrompt = vi.fn();
		plugin = { promptManager: { loadPrompt }, logger };
	});

	it('logs and does not throw when loadPrompt rejects (was an unhandled rejection)', async () => {
		loadPrompt.mockRejectedValue(new Error('boom'));
		const onSelect = vi.fn();
		const modal = new ExplainPromptSelectionModal({} as any, plugin, [], onSelect);

		// SuggestModal dispatches selection via a void fire-and-forget call.
		expect(() => modal.onChooseSuggestion(makePromptInfo())).not.toThrow();
		await flushMicrotasks();

		expect(logger.error).toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('logs when onSelect rejects instead of leaking an unhandled rejection', async () => {
		loadPrompt.mockResolvedValue({ name: 'Explain' });
		const onSelect = vi.fn().mockRejectedValue(new Error('apply failed'));
		const modal = new ExplainPromptSelectionModal({} as any, plugin, [], onSelect);

		modal.onChooseSuggestion(makePromptInfo());
		await flushMicrotasks();

		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(logger.error).toHaveBeenCalled();
	});

	it('applies the prompt normally on the success path', async () => {
		const prompt = { name: 'Explain' } as CustomPrompt;
		loadPrompt.mockResolvedValue(prompt);
		const onSelect = vi.fn().mockResolvedValue(undefined);
		const modal = new ExplainPromptSelectionModal({} as any, plugin, [], onSelect);

		modal.onChooseSuggestion(makePromptInfo());
		await flushMicrotasks();

		expect(onSelect).toHaveBeenCalledWith(prompt);
		expect(logger.error).not.toHaveBeenCalled();
	});
});
