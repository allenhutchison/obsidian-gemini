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

class WorkspaceLeaf {}

class TFile {
	constructor(path = 'test.md') {
		this.path = path;
	}
}

const MarkdownRenderer = {
	render: jest.fn(),
};

const setIcon = jest.fn();
const Notice = jest.fn();

module.exports = {
	ItemView,
	WorkspaceLeaf,
	TFile,
	MarkdownRenderer,
	setIcon,
	Notice,
};
