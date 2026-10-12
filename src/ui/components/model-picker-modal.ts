import { App, FuzzySuggestModal } from 'obsidian';
import { t } from '../../i18n';

/** One pickable entry: the stored model value and the label shown for it. */
export interface ModelPickerOption {
	value: string;
	label: string;
}

/**
 * Orders a picker's entries: `pinned` (the "Default (…)" entry) first, then
 * the models alphabetically by label.
 *
 * Sorting is a display concern and deliberately lives here rather than in the
 * provider model services: `getDefaultModelForRole` falls back to the first
 * listed model, so reordering the catalog itself would silently change which
 * model an empty ("Default") route resolves to.
 */
export function orderModelPickerOptions(pinned: ModelPickerOption, models: ModelPickerOption[]): ModelPickerOption[] {
	return [
		pinned,
		...[...models].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })),
	];
}

/**
 * Fuzzy-search model picker shared by the Features settings page and the
 * session settings modal. A native `<select>` is unusable against an
 * aggregator's catalog (OpenRouter lists hundreds of models through the
 * OpenAI-compatible provider), so every model choice goes through this.
 */
export class ModelPickerModal extends FuzzySuggestModal<ModelPickerOption> {
	private options: ModelPickerOption[];
	private onSelect: (value: string) => void;

	constructor(app: App, options: ModelPickerOption[], onSelect: (value: string) => void) {
		super(app);
		this.options = options;
		this.onSelect = onSelect;
		// SuggestModal renders at most `limit` rows; without this an empty query
		// would show only the head of a long catalog and hide the rest.
		this.limit = Math.max(this.limit ?? 0, options.length);
		this.setPlaceholder(t('settings.features.modelSearchPlaceholder'));
	}

	getItems(): ModelPickerOption[] {
		return this.options;
	}

	/** Label, plus the raw id when the label doesn't already show it, so either can be searched. */
	getItemText(option: ModelPickerOption): string {
		if (!option.value || option.label.includes(option.value)) return option.label;
		return `${option.label} — ${option.value}`;
	}

	onChooseItem(option: ModelPickerOption, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(option.value);
	}
}
