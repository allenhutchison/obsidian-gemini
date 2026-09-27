/**
 * Tests for ProjectNameModal — the name prompt shown by the "Create project"
 * command. What matters: only a valid, trimmed name reaches `onSubmit`, and
 * cancelling never creates anything.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { App } from 'obsidian';

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../__mocks__/obsidian.js');
	class Modal extends original.Modal {
		constructor(app: any) {
			super(app);
			this.contentEl = addObsidianMethods(document.createElement('div'));
		}
		open() {
			this.onOpen?.();
		}
		close() {
			this.onClose?.();
		}
	}
	return { ...original, Modal };
});

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

import { ProjectNameModal, projectNameError } from '../../src/ui/project-name-modal';

describe('projectNameError', () => {
	it('accepts an ordinary name', () => {
		expect(projectNameError('Research Notes')).toBeNull();
	});

	it.each(['', '   '])('rejects an empty name (%j)', (name) => {
		expect(projectNameError(name)).toBe('projectName.errorEmpty');
	});

	it.each(['a/b', 'a\\b', 'a:b', 'say "hi"', 'x#y', 'x[y]', 'a|b', '.hidden'])('rejects %j', (name) => {
		expect(projectNameError(name)).toBe('projectName.errorInvalidChars');
	});
});

describe('ProjectNameModal', () => {
	let onSubmit: Mock<(name: string) => void>;
	let modal: ProjectNameModal;

	function input(): HTMLInputElement {
		return (modal as any).contentEl.querySelector('input');
	}
	function button(label: string): HTMLButtonElement {
		const contentEl = (modal as any).contentEl as HTMLElement;
		const buttons = Array.from(contentEl.querySelectorAll('button'));
		return buttons.find((b) => b.textContent === label)!;
	}

	beforeEach(() => {
		onSubmit = vi.fn();
		modal = new ProjectNameModal({} as App, onSubmit);
		modal.open();
	});

	it('pre-fills a default name', () => {
		expect(input().value).toBe('New Project');
	});

	it('submits the trimmed name on Enter', () => {
		input().value = '  Garden Plans  ';
		input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

		expect(onSubmit).toHaveBeenCalledWith('Garden Plans');
	});

	it('shows an error and does not submit an invalid name', () => {
		input().value = 'a/b';
		button('Create').click();

		expect(onSubmit).not.toHaveBeenCalled();
		expect((modal as any).contentEl.textContent).toContain("can't start with a dot");
	});

	it('does not submit when cancelled', () => {
		button('Cancel').click();

		expect(onSubmit).not.toHaveBeenCalled();
	});
});
