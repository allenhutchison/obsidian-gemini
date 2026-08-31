/**
 * Tests for YoloConfirmationModal — the bypass-confirmations gate.
 *
 * YOLO mode auto-approves every tool call, including destructive and external
 * ones, so what matters here is the *gate's semantics*, not its copy: which
 * boolean reaches `onConfirm`, and that it reaches it exactly once no matter how
 * the modal is dismissed. Per #1262 this follows the
 * `test/ui/management-modal-base.test.ts` pattern — construct against the
 * `__mocks__/obsidian` `Modal`, call `onOpen()`, drive the captured buttons.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { App } from 'obsidian';

/** Button specs captured from `new Setting(contentEl).addButton(...)`, in order. */
const buttonSpecs: Array<{ text: string; warning: boolean; click?: () => void }> = [];

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');

	/**
	 * Give the modal a real jsdom `contentEl` (with the Obsidian element-factory
	 * sugar) and make `close()` invoke `onClose()`, as Obsidian does — that is what
	 * makes the "fires exactly once" guarantee meaningful rather than vacuous.
	 */
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = addObsidianMethods(document.createElement('div'));
			this.closeCalls = 0;
		}
		open() {
			this.onOpen?.();
		}
		close() {
			this.closeCalls++;
			this.onClose?.();
		}
	}

	class Setting extends original.Setting {
		addButton(cb: (b: any) => void) {
			const spec = { text: '', warning: false, click: undefined as undefined | (() => void) };
			const btn = {
				setButtonText(text: string) {
					spec.text = text;
					return btn;
				},
				setWarning() {
					spec.warning = true;
					return btn;
				},
				setCta() {
					return btn;
				},
				onClick(fn: () => void) {
					spec.click = fn;
					return btn;
				},
			};
			cb(btn);
			buttonSpecs.push(spec);
			return this;
		}
	}

	return { ...original, Modal, Setting };
});

/** Obsidian's element-factory sugar over a real jsdom node. */
function addObsidianMethods(el: HTMLElement): HTMLElement {
	const anyEl = el as any;
	anyEl.createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text !== undefined) elem.textContent = opts.text;
		addObsidianMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	anyEl.createDiv = function (opts?: any) {
		return this.createEl('div', opts);
	};
	anyEl.empty = function () {
		this.innerHTML = '';
	};
	return el;
}

// vi.mock is hoisted, so this static import already sees the shimmed Modal/Setting.
import { YoloConfirmationModal } from '../../src/ui/yolo-confirmation-modal';

describe('YoloConfirmationModal', () => {
	let onConfirm: Mock<(confirmed: boolean) => void>;
	let modal: any;

	/** The Cancel button — registered first. */
	function cancelButton() {
		return buttonSpecs[0];
	}
	/** The Enable (destructive) button — registered second. */
	function enableButton() {
		return buttonSpecs[1];
	}

	beforeEach(() => {
		buttonSpecs.length = 0;
		onConfirm = vi.fn<(confirmed: boolean) => void>();
		modal = new YoloConfirmationModal({} as App, onConfirm);
		modal.onOpen();
	});

	// ── The gate's two explicit answers ───────────────────────────────────────

	it('confirms with true when the user enables YOLO mode', () => {
		enableButton().click!();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledWith(true);
	});

	it('confirms with false when the user cancels', () => {
		cancelButton().click!();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledWith(false);
	});

	it('closes the modal on either answer', () => {
		enableButton().click!();
		expect(modal.closeCalls).toBe(1);

		buttonSpecs.length = 0;
		onConfirm.mockClear();
		const second = new YoloConfirmationModal({} as App, onConfirm);
		second.onOpen();
		cancelButton().click!();
		expect((second as unknown as { closeCalls: number }).closeCalls).toBe(1);
	});

	// ── Dismissal without choosing ────────────────────────────────────────────

	it('treats dismissal without a choice as a decline rather than hanging', () => {
		// Escape / click-outside routes through close() → onClose().
		modal.close();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledWith(false);
	});

	it('resolves false when onClose fires directly, never leaving the caller pending', () => {
		modal.onClose();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledWith(false);
	});

	// ── The `resolved` guard: exactly once, whatever the sequence ─────────────

	it('fires exactly once when enabling — the close it triggers must not double-resolve', () => {
		enableButton().click!();
		// A stray onClose (Obsidian fires it as the modal tears down) must be a no-op.
		modal.onClose();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledWith(true);
	});

	it('fires exactly once when cancelling, even followed by a close', () => {
		cancelButton().click!();
		modal.close();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm).toHaveBeenCalledWith(false);
	});

	it('never upgrades a decline to an approval when close follows cancel', () => {
		cancelButton().click!();
		modal.onClose();

		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm.mock.calls[0][0]).toBe(false);
	});

	it('resets the guard on reopen, so a dismissal after an earlier answer still declines', () => {
		// Answering leaves the guard set; without a reset on reopen, the next
		// dismissal would be silently swallowed and the caller left pending.
		enableButton().click!();
		expect(onConfirm).toHaveBeenCalledTimes(1);

		buttonSpecs.length = 0;
		modal.onOpen();
		modal.close();

		expect(onConfirm).toHaveBeenCalledTimes(2);
		expect(onConfirm.mock.calls[1][0]).toBe(false);
	});

	// ── Structure the gate depends on ─────────────────────────────────────────

	it('offers exactly two choices, with the enabling one marked destructive', () => {
		expect(buttonSpecs).toHaveLength(2);
		expect(cancelButton().warning).toBe(false);
		expect(enableButton().warning).toBe(true);
		expect(cancelButton().text).toBeTruthy();
		expect(enableButton().text).toBeTruthy();
	});

	it('renders the risk warning copy so the user is told what they are approving', () => {
		expect(modal.contentEl.querySelector('h2')).toBeTruthy();
		expect(modal.contentEl.querySelector('.gemini-warning-text')).toBeTruthy();
		expect(modal.contentEl.querySelectorAll('p').length).toBeGreaterThanOrEqual(3);
	});

	it('clears its content on close rather than leaving the warning copy mounted', () => {
		expect(modal.contentEl.childElementCount).toBeGreaterThan(0);

		modal.onClose();

		expect(modal.contentEl.childElementCount).toBe(0);
	});

	it('does not stack duplicate copy across a close/reopen cycle', () => {
		const paragraphs = modal.contentEl.querySelectorAll('p').length;

		modal.onClose();
		modal.onOpen();

		expect(modal.contentEl.querySelectorAll('p').length).toBe(paragraphs);
	});
});
