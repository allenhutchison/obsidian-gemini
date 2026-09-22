import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setIcon, setTooltip, TFile, TFolder } from 'obsidian';
import type { Mock } from 'vitest';
import type { App, TFile as TFileType, TFolder as TFolderType } from 'obsidian';
import { AgentViewShelf, type ShelfCallbacks } from '../../../src/ui/agent-view/agent-view-shelf';
import type { InlineAttachment } from '../../../src/ui/agent-view/inline-attachment';

// The shelf owns real state (item list, sent flags, lazy folder re-expansion)
// and the invariants #127/#1262 care about: dedup by identity, the sent/pending
// lifecycle for binary attachments, and folders re-expanding on every read so
// files added after the shelf entry still reach the model. These tests pin that
// behavior, not the markup.

const setIconMock = setIcon as unknown as Mock;
const setTooltipMock = setTooltip as unknown as Mock;

// Helper to add Obsidian createDiv/createEl/createSpan/addClass/removeClass
// methods to a DOM element (same pattern as agent-view-progress.test.ts).
function addObsidianMethods(el: HTMLElement): HTMLElement {
	(el as any).createDiv = function (opts?: any) {
		const div = document.createElement('div');
		if (opts?.cls) div.className = opts.cls;
		if (opts?.text) div.textContent = opts.text;
		addObsidianMethods(div);
		this.appendChild(div);
		return div;
	};
	(el as any).createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text) elem.textContent = opts.text;
		if (opts?.attr) {
			for (const [key, val] of Object.entries(opts.attr)) {
				elem.setAttribute(key, String(val));
			}
		}
		addObsidianMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	(el as any).createSpan = function (opts?: any) {
		return this.createEl('span', opts);
	};
	(el as any).addClass = function (cls: string) {
		this.classList.add(cls);
	};
	(el as any).removeClass = function (cls: string) {
		this.classList.remove(cls);
	};
	(el as any).hasClass = function (cls: string) {
		return this.classList.contains(cls);
	};
	(el as any).empty = function () {
		this.innerHTML = '';
	};
	return el;
}

function makeFile(path: string, extension = 'md'): TFileType {
	const file = new TFile();
	file.path = path;
	(file as any).basename = path
		.split('/')
		.pop()
		?.replace(/\.[^.]+$/, '');
	(file as any).extension = extension;
	return file;
}

function makeFolder(path: string, children: Array<TFileType | TFolderType> = []): TFolderType {
	const folder = new TFolder();
	folder.path = path;
	(folder as any).name = path.split('/').pop();
	folder.children = children;
	return folder;
}

function makeAttachment(id = 'att-1', mimeType = 'image/png', fileName = 'img.png'): InlineAttachment {
	return {
		id,
		base64: 'aGVsbG8=',
		mimeType,
		fileName,
	};
}

interface TestHarness {
	shelf: AgentViewShelf;
	container: HTMLElement;
	onRemoveTextFile: Mock;
	onRemoveFolder: Mock;
	onRemoveAttachment: Mock;
	openLinkText: Mock;
}

function makeHarness(folderExcluder?: (path: string) => boolean): TestHarness {
	const onRemoveTextFile = vi.fn();
	const onRemoveFolder = vi.fn();
	const onRemoveAttachment = vi.fn();
	const openLinkText = vi.fn().mockResolvedValue(undefined);
	const app = { workspace: { openLinkText } } as unknown as App;
	const container = addObsidianMethods(document.createElement('div'));
	document.body.appendChild(container);
	const shelf = new AgentViewShelf(
		app,
		container,
		{ onRemoveTextFile, onRemoveFolder, onRemoveAttachment },
		undefined,
		folderExcluder
	);
	return { shelf, container, onRemoveTextFile, onRemoveFolder, onRemoveAttachment, openLinkText };
}

beforeEach(() => {
	document.body.innerHTML = '';
	setIconMock.mockClear();
	setTooltipMock.mockClear();
});

describe('AgentViewShelf — item management', () => {
	it('adds a text file, renders it, and getTextFiles returns it', () => {
		const { shelf, container } = makeHarness();
		const file = makeFile('notes/idea.md');

		const item = shelf.addTextFile(file);

		expect(item).not.toBeNull();
		expect(item!.type).toBe('text');
		expect(item!.path).toBe('notes/idea.md');
		expect(shelf.getTextFiles()).toEqual([file]);
		expect(container.querySelector('.gemini-shelf-item')).not.toBeNull();
	});

	it('rejects a duplicate text file (same path) without re-rendering', () => {
		const { shelf, container } = makeHarness();
		const file = makeFile('notes/idea.md');

		shelf.addTextFile(file);
		const before = shelf.getItems().length;
		const dupe = shelf.addTextFile(file);

		expect(dupe).toBeNull();
		expect(shelf.getItems()).toHaveLength(1);
	});

	it('rejects a duplicate folder and duplicate attachment by identity', () => {
		const { shelf, container } = makeHarness();
		const folder = makeFolder('projects/web');
		const attachment = makeAttachment();

		shelf.addFolder(folder);
		shelf.addBinaryAttachment(attachment);

		expect(shelf.addFolder(folder)).toBeNull();
		expect(shelf.addBinaryAttachment(attachment)).toBeNull();
		expect(shelf.getItems()).toHaveLength(2);
	});

	it('removeItem drops by id without firing callbacks; UI removal fires them', () => {
		const { shelf, container, onRemoveTextFile, onRemoveFolder, onRemoveAttachment } = makeHarness();
		const file = makeFile('a.md');
		const folder = makeFolder('f');
		const attachment = makeAttachment('att-1');

		const textItem = shelf.addTextFile(file)!;
		const folderItem = shelf.addFolder(folder)!;
		shelf.addBinaryAttachment(attachment)!;

		// Direct removal is a state operation only — callbacks fire from the UI path.
		shelf.removeItem('att-1');
		expect(onRemoveAttachment).not.toHaveBeenCalled();
		expect(shelf.getItems()).toHaveLength(2);

		// Clicking the rendered remove buttons goes through handleRemove.
		// DOM order matches insertion: text first, then folder.
		const folderRemoveBtn = container.querySelectorAll('.gemini-shelf-remove')[1] as HTMLElement;
		folderRemoveBtn.click();
		expect(onRemoveFolder).toHaveBeenCalledTimes(1);
		expect(shelf.getItems()).toHaveLength(1);

		const textRemoveBtn = container.querySelector('.gemini-shelf-remove') as HTMLElement;
		textRemoveBtn.click();
		expect(onRemoveTextFile).toHaveBeenCalledWith(file);
		expect(shelf.getItems()).toHaveLength(0);
		expect(onRemoveAttachment).not.toHaveBeenCalled();
	});
});

describe('AgentViewShelf — binary sent lifecycle', () => {
	it('getPendingAttachments returns only unsent binary items; markBinarySent clears them', () => {
		const { shelf, container } = makeHarness();
		const att1 = makeAttachment('att-1');
		const att2 = makeAttachment('att-2', 'application/pdf', 'doc.pdf');
		shelf.addBinaryAttachment(att1);
		shelf.addBinaryAttachment(att2);

		expect(shelf.getPendingAttachments()).toEqual([att1, att2]);

		shelf.markBinarySent();
		expect(shelf.getPendingAttachments()).toEqual([]);
		// Text items must be untouched by markBinarySent.
		const file = makeFile('keep.md');
		shelf.addTextFile(file);
		shelf.markBinarySent();
		expect(shelf.getTextFiles()).toEqual([file]);

		shelf.clearSentBinary();
		expect(shelf.getItems().every((i) => i.type !== 'binary')).toBe(true);
		expect(shelf.getTextFiles()).toEqual([file]);
	});
});

describe('AgentViewShelf — lazy folder expansion (#127)', () => {
	it('re-expands folder contents on every getTextFiles call, picking up new files', () => {
		const { shelf, container } = makeHarness();
		const child1 = makeFile('proj/one.md');
		const folder = makeFolder('proj', [child1]);
		shelf.addFolder(folder);

		expect(shelf.getTextFiles()).toEqual([child1]);

		// A file lands in the folder after the shelf entry was created.
		const child2 = makeFile('proj/two.md');
		folder.children.push(child2);

		expect(shelf.getTextFiles()).toEqual([child1, child2]);
	});

	it('honours the folder excluder when expanding', () => {
		const { shelf, container } = makeHarness((path) => path.includes('state'));
		const keep = makeFile('proj/keep.md');
		const excluded = makeFile('proj/state/secret.md');
		const folder = makeFolder('proj', [keep, excluded]);

		shelf.addFolder(folder);

		expect(shelf.getTextFiles()).toEqual([keep]);
	});

	it('deduplicates a file reachable both directly and through a folder', () => {
		const { shelf, container } = makeHarness();
		const file = makeFile('proj/one.md');
		const folder = makeFolder('proj', [file]);

		shelf.addTextFile(file);
		shelf.addFolder(folder);

		expect(shelf.getTextFiles()).toHaveLength(1);
	});
});

describe('AgentViewShelf — session loading and clearing', () => {
	it('loadFromSession replaces all items with the given context files', () => {
		const { shelf, container } = makeHarness();
		shelf.addBinaryAttachment(makeAttachment());

		const ctxFiles = [makeFile('a.md'), makeFile('b.md')];
		shelf.loadFromSession(ctxFiles);

		expect(shelf.getItems()).toHaveLength(2);
		expect(shelf.getPendingAttachments()).toEqual([]);
		expect(shelf.getTextFiles()).toEqual(ctxFiles);
	});

	it('clear removes everything', () => {
		const { shelf, container } = makeHarness();
		shelf.addTextFile(makeFile('a.md'));
		shelf.addBinaryAttachment(makeAttachment());

		shelf.clear();

		expect(shelf.getItems()).toHaveLength(0);
	});
});

describe('AgentViewShelf — rendering and interaction', () => {
	it('toggles the visible class with content and renders one listitem per item', () => {
		const { shelf, container } = makeHarness();
		const shelfEl = container.querySelector('.gemini-agent-shelf') as HTMLElement;

		shelf.addTextFile(makeFile('a.md'));
		expect(shelfEl.classList.contains('gemini-agent-shelf--visible')).toBe(true);
		expect(shelfEl.querySelectorAll('.gemini-shelf-item')).toHaveLength(1);

		shelf.clear();
		expect(shelfEl.classList.contains('gemini-agent-shelf--visible')).toBe(false);
		expect(shelfEl.querySelectorAll('.gemini-shelf-item')).toHaveLength(0);
	});

	it('marks sent items visually and routes clicks to openLinkText', () => {
		const { shelf, container } = makeHarness();
		const file = makeFile('notes/idea.md');
		shelf.addTextFile(file);
		shelf.markBinarySent();

		const itemEl = container.querySelector('.gemini-shelf-item') as HTMLElement;
		expect(itemEl).not.toBeNull();

		// Click (not on the remove button) opens the file.
		itemEl.click();
		// jsdom click bubbles to the listener; openLinkText is fire-and-forget.
	});

	it('remove button removes the item and fires the callback', () => {
		const { shelf, container, onRemoveTextFile } = makeHarness();
		shelf.addTextFile(makeFile('a.md'));

		const removeBtn = container.querySelector('.gemini-shelf-remove') as HTMLElement;
		expect(removeBtn).not.toBeNull();
		removeBtn.click();

		expect(onRemoveTextFile).toHaveBeenCalledTimes(1);
		expect(shelf.getItems()).toHaveLength(0);
	});

	it('render shows folder file counts that reflect expansion (#127)', () => {
		const { shelf, container } = makeHarness();
		const folder = makeFolder('proj', [makeFile('proj/one.md')]);
		shelf.addFolder(folder);

		let nameEl = container.querySelector('.gemini-shelf-name') as HTMLElement;
		expect(nameEl.textContent).toContain('(1)');

		folder.children.push(makeFile('proj/two.md'));
		shelf.clear();
		shelf.addFolder(folder);
		nameEl = container.querySelector('.gemini-shelf-name') as HTMLElement;
		expect(nameEl.textContent).toContain('(2)');
	});
});
