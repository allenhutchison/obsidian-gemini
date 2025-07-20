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
				add: jest.fn()
			}
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
	setName(name) { return this; }
	setDesc(desc) { return this; }
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
			selectEl: { value: '' }
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
			onClick: jest.fn()
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
const normalizePath = jest.fn((path) => path);

class FuzzySuggestModal extends Modal {
	constructor(app) {
		super(app);
		this.inputEl = {
			value: '',
			addEventListener: jest.fn()
		};
	}
	getItems() { return []; }
	getItemText(item) { return ''; }
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
	showAtMouseEvent: jest.fn()
}));

module.exports = {
	ItemView,
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
};
