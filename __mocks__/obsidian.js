// Mock for Obsidian module used in tests
import { vi } from 'vitest';

export class ItemView {
	constructor() {
		this.registerEvent = vi.fn();
		this.containerEl = {
			addEventListener: vi.fn(),
			querySelector: vi.fn(),
		};
		this.contentEl = {
			empty: vi.fn(),
			createEl: vi.fn(),
			createDiv: vi.fn(),
		};
		this.chatbox = null;
	}
}

export class Modal {
	constructor(app) {
		this.app = app;
		this.modalEl = {
			classList: {
				add: vi.fn(),
			},
		};
		this.contentEl = {
			empty: vi.fn(),
			createEl: vi.fn(),
			createDiv: vi.fn(),
		};
	}
	open() {}
	close() {}
}

export class WorkspaceLeaf {}

export class MarkdownView {
	constructor() {
		this.file = null;
		this.editor = {
			getSelection: vi.fn().mockReturnValue(''),
		};
	}
}

export class TFile {
	constructor(path = 'test.md') {
		this.path = path;
	}
}

export class TFolder {
	constructor(path = 'test-folder') {
		this.path = path;
		this.children = [];
	}
}

export class Setting {
	constructor(containerEl) {
		this.settingEl = containerEl;
		this.components = [];
	}
	setName(name) {
		return this;
	}
	setDesc(desc) {
		return this;
	}
	addText(cb) {
		const component = { setValue: vi.fn(), setPlaceholder: vi.fn() };
		cb(component);
		this.components.push(component);
		return this;
	}
	addTextArea(cb) {
		const component = { setValue: vi.fn(), setPlaceholder: vi.fn() };
		cb(component);
		this.components.push(component);
		return this;
	}
	addDropdown(cb) {
		const component = {
			setValue: vi.fn(),
			addOption: vi.fn(),
			selectEl: { value: '' },
		};
		cb(component);
		this.components.push(component);
		return this;
	}
	addToggle(cb) {
		const component = { setValue: vi.fn() };
		cb(component);
		this.components.push(component);
		return this;
	}
	addButton(cb) {
		const component = {
			setButtonText: vi.fn(),
			setCta: vi.fn(),
			onClick: vi.fn(),
		};
		cb(component);
		this.components.push(component);
		return this;
	}
}

export const MarkdownRenderer = {
	render: vi.fn(),
};

export const setIcon = vi.fn();
export const Notice = vi.fn();
export const requestUrl = vi.fn();
// Mirrors Obsidian's normalizePath: collapses duplicate slashes, converts
// backslashes, strips leading/trailing slashes, and returns '/' for empty input.
export const normalizePath = vi.fn((path) => {
	if (path == null || /^\s*$/.test(path)) return '/';
	const collapsed = path.replace(/[\\/]+/g, '/').replace(/(^\/+|\/+$)/g, '');
	return collapsed || '/';
});
// Minimal Obsidian `debounce` mock. Queues the latest args on each call without
// firing; `run()` drains the queue and invokes the callback; `cancel()` clears
// it. This matches Obsidian's real debounce semantics (deferred firing) so
// tests can assert coalescing behavior by driving `.run()` explicitly.
export const debounce = (cb, _timeout, _resetTimer) => {
	let pendingArgs = null;
	const debounced = (...args) => {
		pendingArgs = args;
		return debounced;
	};
	debounced.cancel = () => {
		pendingArgs = null;
		return debounced;
	};
	debounced.run = () => {
		if (pendingArgs) {
			const args = pendingArgs;
			pendingArgs = null;
			cb(...args);
		}
		return debounced;
	};
	return debounced;
};
export const prepareFuzzySearch = vi.fn((query) => {
	return (text) => {
		if (!query || text.toLowerCase().includes(query.toLowerCase())) {
			return { score: 1, matches: [] };
		}
		return null;
	};
});

export class FuzzySuggestModal extends Modal {
	constructor(app) {
		super(app);
		this.inputEl = {
			value: '',
			addEventListener: vi.fn(),
		};
	}
	getItems() {
		return [];
	}
	getItemText(item) {
		return '';
	}
	onChooseItem(item, evt) {}
}

export class TAbstractFile {
	constructor() {
		this.path = '';
		this.name = '';
	}
}

export const Menu = vi.fn().mockImplementation(function () {
	return {
		addItem: vi.fn().mockReturnThis(),
		showAtMouseEvent: vi.fn(),
	};
});

export class AbstractInputSuggest {
	constructor() {
		this.inputEl = null;
	}

	getValue() {
		return '';
	}
	setValue() {}
	onInputChanged() {}
	getSuggestions() {
		return [];
	}
	renderSuggestion() {}
	selectSuggestion() {}
}

export class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = {
			empty: vi.fn(),
			createEl: vi.fn(),
			createDiv: vi.fn(),
		};
	}

	display() {}
	hide() {}
}

export class SuggestModal extends Modal {
	constructor(app) {
		super(app);
		this.inputEl = {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			value: '',
			dispatchEvent: vi.fn(),
		};
		this.resultContainerEl = { scrollTop: 0 };
		this.chooser = {
			selectedItem: 0,
			setSelectedItem: vi.fn(),
			suggestions: [],
		};
	}

	getSuggestions() {
		return [];
	}
	renderSuggestion() {}
	onChooseSuggestion() {}
}

export class SecretComponent {
	constructor(app, containerEl) {
		this.app = app;
		this.containerEl = containerEl;
		this._value = '';
		this._onChange = null;
	}
	setValue(value) {
		this._value = value;
		return this;
	}
	onChange(cb) {
		this._onChange = cb;
		return this;
	}
}

export class SecretStorage {
	constructor() {
		this._secrets = {};
	}
	setSecret(id, secret) {
		this._secrets[id] = secret;
	}
	getSecret(id) {
		return this._secrets[id] ?? null;
	}
	listSecrets() {
		return Object.keys(this._secrets);
	}
}

export class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
	}

	onload() {}
	onunload() {}
	addCommand() {
		return vi.fn();
	}
	addRibbonIcon() {
		return { remove: vi.fn() };
	}
	addSettingTab() {}
	registerView() {}
	loadData() {
		return Promise.resolve({});
	}
	saveData() {
		return Promise.resolve();
	}
}
