import type { App } from 'obsidian';
import {
	ModelPickerModal,
	orderModelPickerOptions,
	type ModelPickerOption,
} from '../../../src/ui/components/model-picker-modal';

const DEFAULT: ModelPickerOption = { value: '', label: 'Default (GPT-5.6 Sol)' };

describe('orderModelPickerOptions', () => {
	it('keeps the default entry first and sorts the rest by label', () => {
		const ordered = orderModelPickerOptions(DEFAULT, [
			{ value: 'qwen/qwen3', label: 'qwen/qwen3' },
			{ value: 'anthropic/claude-opus-5', label: 'anthropic/claude-opus-5' },
			{ value: 'Mistral/large', label: 'Mistral/large' },
		]);

		expect(ordered.map((o) => o.value)).toEqual(['', 'anthropic/claude-opus-5', 'Mistral/large', 'qwen/qwen3']);
	});

	it('orders numeric suffixes naturally and leaves the input untouched', () => {
		const models = [
			{ value: 'm-10', label: 'm-10' },
			{ value: 'm-2', label: 'm-2' },
		];

		expect(orderModelPickerOptions(DEFAULT, models).map((o) => o.value)).toEqual(['', 'm-2', 'm-10']);
		expect(models.map((o) => o.value)).toEqual(['m-10', 'm-2']);
	});
});

describe('ModelPickerModal', () => {
	const options = orderModelPickerOptions(
		DEFAULT,
		Array.from({ length: 458 }, (_, i) => ({ value: `vendor/model-${i}`, label: `vendor/model-${i}` }))
	);

	it('offers every option, lifting the suggest limit past a long catalog', () => {
		const modal = new ModelPickerModal({} as App, options, vi.fn());

		expect(modal.getItems()).toHaveLength(459);
		expect(modal.limit).toBeGreaterThanOrEqual(459);
	});

	it('makes both the label and the raw id searchable without repeating the id', () => {
		const modal = new ModelPickerModal({} as App, options, vi.fn());

		expect(modal.getItemText({ value: 'claude-opus-5', label: 'Claude Opus 5' })).toBe('Claude Opus 5 — claude-opus-5');
		expect(modal.getItemText({ value: 'llama3', label: 'llama3' })).toBe('llama3');
		expect(modal.getItemText({ value: 'gone', label: 'gone (No longer available)' })).toBe(
			'gone (No longer available)'
		);
		expect(modal.getItemText(DEFAULT)).toBe('Default (GPT-5.6 Sol)');
	});

	it('reports the chosen model value', () => {
		const onSelect = vi.fn();
		const modal = new ModelPickerModal({} as App, options, onSelect);

		modal.onChooseItem({ value: 'vendor/model-7', label: 'vendor/model-7' }, new MouseEvent('click'));
		modal.onChooseItem(DEFAULT, new MouseEvent('click'));

		expect(onSelect.mock.calls).toEqual([['vendor/model-7'], ['']]);
	});
});
