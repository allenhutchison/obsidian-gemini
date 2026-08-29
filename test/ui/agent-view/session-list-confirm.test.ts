/**
 * Tests for the session list's inline delete confirmation (#1275).
 *
 * The delete gate used to be the browser's native `confirm()`. These tests pin
 * the replacement's decision surface: nothing is trashed until the user confirms
 * in the row, cancelling is non-destructive, and a confirm click never leaks
 * through to the row handler that opens the session.
 */

import { SessionListModal } from '../../../src/ui/agent-view/session-list-modal';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { ChatSession } from '../../../src/types/agent';
import type { ObsidianGemini } from '../../../src/types/plugin';

/**
 * Give a real jsdom element the Obsidian DOM helpers the modal uses. Real DOM
 * (not vi.fn() stubs) because these tests assert on rendered structure and on
 * click/keydown propagation, which stubs can't model.
 */
function augment(element: HTMLElement): HTMLElement {
	const el = element as any;
	el.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
		return this;
	};
	el.addClass = function (...classes: string[]) {
		for (const cls of classes) this.classList.add(cls);
		return this;
	};
	el.removeClass = function (...classes: string[]) {
		for (const cls of classes) this.classList.remove(cls);
		return this;
	};
	el.createEl = function (tag: string, options?: any) {
		const child = augment(document.createElement(tag));
		if (options?.text) child.textContent = options.text;
		if (options?.cls) {
			for (const cls of String(options.cls).split(/\s+/).filter(Boolean)) child.classList.add(cls);
		}
		if (options?.title) child.setAttribute('title', options.title);
		if (options?.attr) {
			for (const [name, value] of Object.entries(options.attr)) child.setAttribute(name, String(value));
		}
		this.appendChild(child);
		return child;
	};
	el.createDiv = function (options?: any) {
		return this.createEl('div', options);
	};
	el.createSpan = function (options?: any) {
		return this.createEl('span', options);
	};
	return element;
}

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../../__mocks__/obsidian.js');
	class Modal {
		app: any;
		contentEl: HTMLElement;
		modalEl: HTMLElement;
		close = vi.fn();
		open() {}
		constructor(app: any) {
			this.app = app;
			this.contentEl = augment(document.createElement('div'));
			this.modalEl = augment(document.createElement('div'));
			this.modalEl.appendChild(this.contentEl);
			document.body.appendChild(this.modalEl);
		}
	}
	return { ...original, Modal, getLanguage: () => 'en' };
});

/** A session file, real `TFile` so the modal's `instanceof` checks hold. */
function sessionFile(path: string, mtime: number): TFile {
	const file = new TFile() as any;
	file.path = path;
	file.stat = { mtime, ctime: mtime, size: 0 };
	return file as TFile;
}

const FOLDER = 'gemini-scribe/Agent-Sessions';

function makeSession(id: string, title: string): ChatSession {
	return {
		id,
		title,
		historyPath: `${FOLDER}/${id}.md`,
		context: { contextFiles: [] },
	} as unknown as ChatSession;
}

interface Harness {
	modal: SessionListModal;
	trashFile: ReturnType<typeof vi.fn>;
	onSelect: ReturnType<typeof vi.fn>;
	onDelete: ReturnType<typeof vi.fn>;
	clearLoopDetectorSession: ReturnType<typeof vi.fn>;
	contentEl: HTMLElement;
}

async function openModal(sessions: ChatSession[]): Promise<Harness> {
	const files = sessions.map((s, i) => sessionFile(s.historyPath, 2000 - i));
	const byPath = new Map(files.map((f) => [f.path, f]));

	// Trashing really removes the file, so the list's post-delete re-render sees
	// what it would see in the vault.
	const trashFile = vi.fn((file: TFile) => {
		byPath.delete(file.path);
		const idx = files.indexOf(file);
		if (idx !== -1) files.splice(idx, 1);
		return Promise.resolve();
	});
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
		},
		fileManager: { trashFile },
	} as unknown as App;

	const clearLoopDetectorSession = vi.fn();
	const plugin = {
		settings: { historyFolder: 'gemini-scribe' },
		toolExecutionEngine: { clearLoopDetectorSession },
		sessionManager: {
			loadSession: vi.fn((path: string) => Promise.resolve(sessions.find((s) => s.historyPath === path) ?? null)),
			createAgentSession: vi.fn(),
		},
		projectManager: { discoverProjects: () => [] },
		logger: { error: vi.fn(), warn: vi.fn(), log: vi.fn(), debug: vi.fn() },
	} as unknown as ObsidianGemini;

	const onSelect = vi.fn();
	const onDelete = vi.fn();
	const modal = new SessionListModal(app, plugin, { onSelect, onDelete }, null);
	await modal.onOpen();

	return { modal, trashFile, onSelect, onDelete, clearLoopDetectorSession, contentEl: (modal as any).contentEl };
}

/** The rendered rows, in display order. */
function rows(contentEl: HTMLElement): HTMLElement[] {
	return Array.from(contentEl.querySelectorAll('.gemini-session-item'));
}

function deleteButton(row: HTMLElement): HTMLElement {
	const btn = row.querySelector('.gemini-session-action-btn.delete');
	if (!btn) throw new Error('row has no delete button');
	return btn as HTMLElement;
}

function confirmButton(row: HTMLElement): HTMLElement | null {
	return row.querySelector('.gemini-session-confirm-delete');
}

function cancelButton(row: HTMLElement): HTMLElement | null {
	return row.querySelector('.gemini-session-confirm-cancel');
}

function click(el: HTMLElement) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('SessionListModal inline delete confirmation', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		vi.clearAllMocks();
	});

	it('does not delete on the first delete click — it asks first', async () => {
		const { contentEl, trashFile, onDelete } = await openModal([makeSession('a', 'Alpha')]);
		const row = rows(contentEl)[0];

		click(deleteButton(row));

		expect(trashFile).not.toHaveBeenCalled();
		expect(onDelete).not.toHaveBeenCalled();
		// The row now asks, in place.
		expect(confirmButton(row)).not.toBeNull();
		expect(cancelButton(row)).not.toBeNull();
		expect(row.querySelector('.gemini-session-confirm-prompt')?.textContent).toBe('Delete session "Alpha"?');
		expect(row.querySelector('.gemini-session-action-btn.delete')).toBeNull();
	});

	it('never calls the native confirm() dialog', async () => {
		const nativeConfirm = vi.fn(() => true);
		vi.stubGlobal('confirm', nativeConfirm);
		try {
			const { contentEl } = await openModal([makeSession('a', 'Alpha')]);
			click(deleteButton(rows(contentEl)[0]));
			expect(nativeConfirm).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('releases the tool-loop detector records when the session is deleted (#1387)', async () => {
		const { contentEl, clearLoopDetectorSession } = await openModal([makeSession('a', 'Alpha')]);
		const row = rows(contentEl)[0];
		click(deleteButton(row));
		click(confirmButton(row)!);
		await vi.waitFor(() => expect(clearLoopDetectorSession).toHaveBeenCalledWith('a'));
	});

	it('does not release loop-detector state when trashing fails (#1387 review regression)', async () => {
		const { contentEl, trashFile, clearLoopDetectorSession } = await openModal([makeSession('a', 'Alpha')]);
		trashFile.mockRejectedValueOnce(new Error('trash failed'));
		const row = rows(contentEl)[0];
		click(deleteButton(row));
		click(confirmButton(row)!);
		await vi.waitFor(() => expect(trashFile).toHaveBeenCalled());
		// Give the rejected promise a tick to surface in deleteSession's catch.
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(clearLoopDetectorSession).not.toHaveBeenCalled();
	});

	it('does not release loop-detector state when cancelled (#1387)', async () => {
		const { contentEl, clearLoopDetectorSession } = await openModal([makeSession('a', 'Alpha')]);
		const row = rows(contentEl)[0];
		click(deleteButton(row));
		click(cancelButton(row)!);
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(clearLoopDetectorSession).not.toHaveBeenCalled();
	});

	it('deletes only after the confirm button is clicked', async () => {
		const session = makeSession('a', 'Alpha');
		const { contentEl, trashFile, onDelete } = await openModal([session]);
		const row = rows(contentEl)[0];

		click(deleteButton(row));
		click(confirmButton(row)!);
		await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(session));

		expect(trashFile).toHaveBeenCalledTimes(1);
		expect((trashFile.mock.calls[0][0] as TFile).path).toBe(session.historyPath);
		// The deleted session is gone from the re-rendered list.
		expect(rows(contentEl)).toHaveLength(0);
	});

	it('restores the row and keeps the session when cancelled', async () => {
		const { contentEl, trashFile } = await openModal([makeSession('a', 'Alpha')]);
		const row = rows(contentEl)[0];

		click(deleteButton(row));
		click(cancelButton(row)!);

		expect(trashFile).not.toHaveBeenCalled();
		expect(confirmButton(row)).toBeNull();
		expect(row.querySelector('.gemini-session-action-btn.delete')).not.toBeNull();
		expect(row.querySelector('.gemini-session-actions')?.classList.contains('gemini-session-actions--confirming')).toBe(
			false
		);
	});

	it('is still armed after a cancel — the restored delete button re-asks', async () => {
		const { contentEl, trashFile } = await openModal([makeSession('a', 'Alpha')]);
		const row = rows(contentEl)[0];

		click(deleteButton(row));
		click(cancelButton(row)!);
		// The restored button must carry a live handler, not a dead clone.
		click(deleteButton(row));

		expect(confirmButton(row)).not.toBeNull();
		expect(trashFile).not.toHaveBeenCalled();
	});

	it('confirming a second row dismisses the first row’s confirmation', async () => {
		const { contentEl } = await openModal([makeSession('a', 'Alpha'), makeSession('b', 'Beta')]);
		const [first, second] = rows(contentEl);

		click(deleteButton(first));
		click(deleteButton(second));

		expect(confirmButton(second)).not.toBeNull();
		expect(confirmButton(first)).toBeNull();
		expect(first.querySelector('.gemini-session-action-btn.delete')).not.toBeNull();
	});

	it('does not open the session when the confirm or cancel button is clicked', async () => {
		const session = makeSession('a', 'Alpha');
		const { contentEl, onSelect, onDelete, modal } = await openModal([session]);
		const row = rows(contentEl)[0];

		// Cancelling must not select the row either.
		click(deleteButton(row));
		click(cancelButton(row)!);
		expect(onSelect).not.toHaveBeenCalled();

		click(deleteButton(row));
		click(confirmButton(row)!);
		await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(session));

		// The row handler opens the session and closes the modal; neither may fire
		// from a click on the confirmation controls.
		expect(onSelect).not.toHaveBeenCalled();
		expect((modal as any).close).not.toHaveBeenCalled();
	});

	it('cancels the confirmation on Escape instead of closing the modal', async () => {
		const { contentEl, modal, trashFile } = await openModal([makeSession('a', 'Alpha')]);
		const row = rows(contentEl)[0];
		click(deleteButton(row));

		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		row.dispatchEvent(escape);

		expect(confirmButton(row)).toBeNull();
		expect(row.querySelector('.gemini-session-action-btn.delete')).not.toBeNull();
		expect(trashFile).not.toHaveBeenCalled();
		// Escape was consumed by the confirm, so the modal's own close never runs.
		expect(escape.defaultPrevented).toBe(true);
	});

	it('lets Escape through when no row is confirming', async () => {
		const { contentEl } = await openModal([makeSession('a', 'Alpha')]);
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		rows(contentEl)[0].dispatchEvent(escape);

		expect(escape.defaultPrevented).toBe(false);
	});
});
