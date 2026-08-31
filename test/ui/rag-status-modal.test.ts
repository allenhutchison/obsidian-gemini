/**
 * Tests for RagStatusModal's tab strip.
 *
 * The modal builds its tabs from two different places — the initial render appends the strip to the
 * content element, the refresh path re-creates it after the header — and #1293 flagged the two as
 * near-verbatim twins that would drift. These tests pin the invariant that both paths produce the
 * same tabs, so an extraction (or a future fourth tab added to only one site) is caught.
 */

import type { App } from 'obsidian';
import type { RagDetailedStatus } from '../../src/services/rag-types';

vi.mock('obsidian', () => {
	const applyOptions = (element: HTMLElement, options?: any) => {
		if (options?.text) element.textContent = options.text;
		if (options?.cls) {
			for (const cls of String(options.cls).split(/\s+/).filter(Boolean)) {
				element.classList.add(cls);
			}
		}
		if (options?.attr) {
			for (const [name, value] of Object.entries(options.attr)) {
				element.setAttribute(name, String(value));
			}
		}
		return element;
	};

	const decorate = (element: HTMLElement): HTMLElement => {
		(element as any).empty = function () {
			this.replaceChildren();
			return this;
		};
		(element as any).addClass = function (cls: string) {
			this.classList.add(cls);
			return this;
		};
		(element as any).createEl = function (tag: string, options?: any) {
			const el = decorate(document.createElement(tag));
			applyOptions(el, options);
			this.appendChild(el);
			return el;
		};
		(element as any).createDiv = function (options?: any) {
			return this.createEl('div', options);
		};
		(element as any).createSpan = function (options?: any) {
			return this.createEl('span', options);
		};
		return element;
	};

	return {
		getLanguage: () => 'en',
		setIcon: () => {},
		Modal: class Modal {
			app: any;
			contentEl: HTMLElement;
			modalEl: HTMLElement;

			constructor(app: any) {
				this.app = app;
				this.contentEl = decorate(document.createElement('div'));
				this.modalEl = decorate(document.createElement('div'));
			}

			open() {}
			close() {}
		},
	};
});

// The tab strip is what's under test; the panel bodies are covered by rag-status-panel.test.ts.
vi.mock('../../src/ui/components/rag-status-panel', () => ({
	renderRagOverview: vi.fn(),
	renderRagFileList: vi.fn(),
	renderRagFailures: vi.fn(),
}));

import { RagStatusModal } from '../../src/ui/rag-status-modal';

function makeStatus(overrides: Partial<RagDetailedStatus> = {}): RagDetailedStatus {
	return {
		status: 'idle',
		indexedCount: 12,
		failedCount: 0,
		...overrides,
	} as RagDetailedStatus;
}

function openModal(status: RagDetailedStatus): RagStatusModal {
	const modal = new RagStatusModal(
		{} as App,
		status,
		() => {},
		() => {},
		async () => true
	);
	modal.onOpen();
	return modal;
}

function tabLabels(modal: RagStatusModal): string[] {
	return Array.from((modal as any).contentEl.querySelectorAll('.rag-status-tab')).map(
		(el) => (el as HTMLElement).textContent ?? ''
	);
}

/** Clicking a tab is the only public way to reach the refresh re-render path. */
function clickTab(modal: RagStatusModal, label: string): void {
	const tab = Array.from((modal as any).contentEl.querySelectorAll('.rag-status-tab')).find(
		(el) => (el as HTMLElement).textContent === label
	) as HTMLElement | undefined;
	if (!tab) throw new Error(`No tab labelled "${label}"`);
	tab.click();
}

describe('RagStatusModal tabs', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('renders the same tabs on the initial render and after a refresh', () => {
		const modal = openModal(makeStatus({ failedCount: 3 }));
		const initial = tabLabels(modal);
		expect(initial).toHaveLength(3);

		clickTab(modal, initial[1]);

		expect(tabLabels(modal)).toEqual(initial);
	});

	it('omits the failures tab on both paths when there are no failures', () => {
		const modal = openModal(makeStatus({ failedCount: 0 }));
		const initial = tabLabels(modal);
		expect(initial).toHaveLength(2);

		clickTab(modal, initial[1]);

		const afterRefresh = tabLabels(modal);
		expect(afterRefresh).toEqual(initial);
		expect(afterRefresh).toHaveLength(2);
	});

	it('keeps exactly one tab strip after refreshing', () => {
		const modal = openModal(makeStatus({ failedCount: 1 }));

		clickTab(modal, tabLabels(modal)[1]);

		expect((modal as any).contentEl.querySelectorAll('.rag-status-tabs')).toHaveLength(1);
	});

	it('marks the clicked tab active after the refresh re-render', () => {
		const modal = openModal(makeStatus({ failedCount: 0 }));
		const filesLabel = tabLabels(modal)[1];

		clickTab(modal, filesLabel);

		const active = (modal as any).contentEl.querySelectorAll('.rag-status-tab-active');
		expect(active).toHaveLength(1);
		expect((active[0] as HTMLElement).textContent).toBe(filesLabel);
	});
});
