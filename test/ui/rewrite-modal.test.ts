import { describe, it, expect, vi } from 'vitest';
import { t } from '../../src/i18n';

// Decision-surface coverage for the rewrite instructions modal (#1596): when
// it submits, what it submits, and how it closes.

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	const { installObsidianDom } = await import('./obsidian-dom');
	installObsidianDom();
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = document.createElement('div');
			this.modalEl = document.createElement('div');
			this.closeCount = 0;
		}
		close() {
			this.closeCount++;
		}
	}
	return { ...original, Modal };
});

// vi.mock is hoisted, so this import already sees the shimmed Modal.
import { RewriteInstructionsModal } from '../../src/ui/rewrite-modal';

function open(isFullFile = false) {
	const onSubmit = vi.fn();
	const modal = new RewriteInstructionsModal({} as any, 'The quick brown fox.', onSubmit, isFullFile) as any;
	modal.onOpen();
	const el = modal.contentEl as HTMLElement;
	const textarea = el.querySelector('textarea')!;
	const submit = el.querySelector<HTMLButtonElement>('.gemini-scribe-submit-button')!;
	return { modal, onSubmit, el, textarea, submit };
}

describe('RewriteInstructionsModal', () => {
	it('shows the selected text and the selection title', () => {
		const { el, modal } = open();
		expect(el.querySelector('h2')?.textContent).toBe(t('rewrite.titleSelection'));
		expect(el.querySelector('.gemini-scribe-preview-content')?.textContent).toBe('The quick brown fox.');
		expect(modal.modalEl.classList.contains('gemini-scribe-rewrite-modal')).toBe(true);
	});

	it('uses the file title and placeholder for a full-file rewrite', () => {
		const { el, textarea } = open(true);
		expect(el.querySelector('h2')?.textContent).toBe(t('rewrite.titleFile'));
		expect(textarea.getAttribute('placeholder')).toBe(t('rewrite.placeholderFile'));
	});

	it('submits the instructions as typed, after closing', () => {
		const { modal, onSubmit, textarea, submit } = open();
		onSubmit.mockImplementation(() => expect(modal.closeCount).toBe(1));
		textarea.value = '  Make it formal.  ';

		submit.click();

		expect(onSubmit).toHaveBeenCalledWith('  Make it formal.  ');
	});

	it('ignores a blank submit and stays open', () => {
		const { modal, onSubmit, textarea, submit } = open();
		textarea.value = '   \n ';

		submit.click();

		expect(onSubmit).not.toHaveBeenCalled();
		expect(modal.closeCount).toBe(0);
	});

	it.each([{ ctrlKey: true }, { metaKey: true }])('submits on Ctrl/Cmd+Enter (%o)', (mods) => {
		const { onSubmit, textarea } = open();
		textarea.value = 'Shorter.';
		const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...mods });

		textarea.dispatchEvent(event);

		expect(onSubmit).toHaveBeenCalledWith('Shorter.');
		expect(event.defaultPrevented).toBe(true);
	});

	it('does not submit on a plain Enter, which adds a new line', () => {
		const { onSubmit, textarea } = open();
		textarea.value = 'Shorter.';
		textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('closes on Escape without submitting', () => {
		const { modal, onSubmit, textarea } = open();
		textarea.value = 'Shorter.';
		modal.modalEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		expect(modal.closeCount).toBe(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
