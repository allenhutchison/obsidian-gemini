// Mock for Obsidian module used in tests

class ItemView {
	constructor() {
		this.registerEvent = jest.fn();
		this.containerEl = {
			addEventListener: jest.fn(),
			querySelector: jest.fn(),
		};
		this.contentEl = {
			empty: jest.fn(),
			createEl: jest.fn(),
			createDiv: jest.fn(),
		};
		this.chatbox = null;
	}
}

class Modal {
	constructor(app) {
		this.app = app;
		this.modalEl = {
			classList: {
				add: jest.fn(),
			},
		};
		this.contentEl = {
			empty: jest.fn(),
			createEl: jest.fn(),
			createDiv: jest.fn(),
		};
	}
	open() {}
	close() {}
}

class WorkspaceLeaf {}

class MarkdownView {
	constructor() {
		this.file = null;
		this.editor = {
			getSelection: jest.fn().mockReturnValue(''),
		};
	}
}

class TFile {
	constructor(path = 'test.md') {
		this.path = path;
	}
}

class TFolder {
	constructor(path = 'test-folder') {
		this.path = path;
		this.children = [];
	}
}

class Setting {
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
		const component = { setValue: jest.fn(), setPlaceholder: jest.fn() };
		cb(component);
		this.components.push(component);
		return this;
	}
	addTextArea(cb) {
		const component = { setValue: jest.fn(), setPlaceholder: jest.fn() };
		cb(component);
		this.components.push(component);
		return this;
	}
	addDropdown(cb) {
		const component = {
			setValue: jest.fn(),
			addOption: jest.fn(),
			selectEl: { value: '' },
		};
		cb(component);
		this.components.push(component);
		return this;
	}
	addToggle(cb) {
		const component = { setValue: jest.fn() };
		cb(component);
		this.components.push(component);
		return this;
	}
	addButton(cb) {
		const component = {
			setButtonText: jest.fn(),
			setCta: jest.fn(),
			onClick: jest.fn(),
		};
		cb(component);
		this.components.push(component);
		return this;
	}
}

const MarkdownRenderer = {
	render: jest.fn(),
};

const setIcon = jest.fn();
const Notice = jest.fn();
// Mirrors Obsidian's normalizePath: collapses duplicate slashes, converts
// backslashes, strips leading/trailing slashes, and returns '/' for empty input.
const normalizePath = jest.fn((path) => {
	if (path == null || /^\s*$/.test(path)) return '/';
	const collapsed = path.replace(/[\\/]+/g, '/').replace(/(^\/+|\/+$)/g, '');
	return collapsed || '/';
});
// Minimal Obsidian `debounce` mock. Queues the latest args on each call without
// firing; `run()` drains the queue and invokes the callback; `cancel()` clears
// it. This matches Obsidian's real debounce semantics (deferred firing) so
// tests can assert coalescing behavior by driving `.run()` explicitly.
const debounce = (cb, _timeout, _resetTimer) => {
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
const prepareFuzzySearch = jest.fn((query) => {
	return (text) => {
		if (!query || text.toLowerCase().includes(query.toLowerCase())) {
			return { score: 1, matches: [] };
		}
		return null;
	};
});

class FuzzySuggestModal extends Modal {
	constructor(app) {
		super(app);
		this.inputEl = {
			value: '',
			addEventListener: jest.fn(),
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

class TAbstractFile {
	constructor() {
		this.path = '';
		this.name = '';
	}
}

const Menu = jest.fn().mockImplementation(() => ({
	addItem: jest.fn().mockReturnThis(),
	showAtMouseEvent: jest.fn(),
}));

class AbstractInputSuggest {
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

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = {
			empty: jest.fn(),
			createEl: jest.fn(),
			createDiv: jest.fn(),
		};
	}

	display() {}
	hide() {}
}

class SuggestModal extends Modal {
	constructor(app) {
		super(app);
		this.inputEl = {
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			value: '',
			dispatchEvent: jest.fn(),
		};
		this.resultContainerEl = { scrollTop: 0 };
		this.chooser = {
			selectedItem: 0,
			setSelectedItem: jest.fn(),
			suggestions: [],
		};
	}

	getSuggestions() {
		return [];
	}
	renderSuggestion() {}
	onChooseSuggestion() {}
}

class SecretComponent {
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

class SecretStorage {
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

class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
	}

	onload() {}
	onunload() {}
	addCommand() {
		return jest.fn();
	}
	addRibbonIcon() {
		return { remove: jest.fn() };
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

module.exports = {
	ItemView,
	MarkdownView,
	Modal,
	WorkspaceLeaf,
	TFile,
	TFolder,
	TAbstractFile,
	Setting,
	MarkdownRenderer,
	setIcon,
	Notice,
	normalizePath,
	FuzzySuggestModal,
	Menu,
	AbstractInputSuggest,
	PluginSettingTab,
	SuggestModal,
	Plugin,
	prepareFuzzySearch,
	SecretComponent,
	SecretStorage,
	debounce,
};
