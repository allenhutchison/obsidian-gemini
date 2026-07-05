/**
 * Tests for the shared RAG-status panel presenter used by both RagStatusModal
 * and the "RAG" tab of BackgroundTasksModal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captures the button specs created via `new Setting(container).addButton(...)`
// so the overview gating can be asserted without a real Obsidian Setting.
const buttonSpecs: Array<{
	text: string;
	disabled: boolean;
	tooltip: string;
	cta: boolean;
	click?: () => unknown;
}> = [];

vi.mock('obsidian', () => {
	const setIcon = vi.fn();
	const Notice = vi.fn();
	class Setting {
		constructor(public containerEl: unknown) {}
		addButton(cb: (b: unknown) => void) {
			const spec = {
				text: '',
				disabled: false,
				tooltip: '',
				cta: false,
				click: undefined as undefined | (() => unknown),
			};
			const btn = {
				setButtonText(t: string) {
					spec.text = t;
					return btn;
				},
				setDisabled(d: boolean) {
					spec.disabled = d;
					return btn;
				},
				setTooltip(tt: string) {
					spec.tooltip = tt;
					return btn;
				},
				setCta() {
					spec.cta = true;
					return btn;
				},
				onClick(fn: () => unknown) {
					spec.click = fn;
					return btn;
				},
			};
			cb(btn);
			buttonSpecs.push(spec);
			return this;
		}
	}
	return { setIcon, Notice, Setting, getLanguage: () => 'en' };
});

import { Notice } from 'obsidian';
import {
	ragStatusText,
	ragStatusClass,
	renderRagOverview,
	renderRagFileList,
	renderRagFailures,
	type RagFileListOptions,
	type RagOverviewCallbacks,
} from '../../../src/ui/components/rag-status-panel';
import type { RagDetailedStatus } from '../../../src/services/rag-types';
import { t } from '../../../src/i18n';

/** Build a jsdom element carrying the Obsidian DOM-helper methods the panel uses. */
function makeEl(tag: string): HTMLElement {
	const el = document.createElement(tag);
	const anyEl = el as unknown as Record<string, unknown>;
	anyEl.empty = function (this: HTMLElement) {
		this.innerHTML = '';
		return this;
	};
	anyEl.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
		return this;
	};
	anyEl.addClass = function (this: HTMLElement, ...cls: string[]) {
		cls.forEach((c) => c && this.classList.add(c));
		return this;
	};
	anyEl.createEl = function (
		this: HTMLElement,
		childTag: string,
		opts?: { cls?: string; text?: string; attr?: Record<string, string> }
	) {
		const child = makeEl(childTag);
		if (opts?.cls) child.className = opts.cls;
		if (opts?.text) child.textContent = opts.text;
		if (opts?.attr) Object.entries(opts.attr).forEach(([k, v]) => child.setAttribute(k, String(v)));
		this.appendChild(child);
		return child;
	};
	anyEl.createDiv = function (this: HTMLElement, opts?: unknown) {
		return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('div', opts);
	};
	anyEl.createSpan = function (this: HTMLElement, opts?: unknown) {
		return (this as unknown as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('span', opts);
	};
	return el;
}

function statusFixture(overrides: Partial<RagDetailedStatus> = {}): RagDetailedStatus {
	return {
		status: 'idle',
		indexedCount: 0,
		failedCount: 0,
		pendingCount: 0,
		storeName: null,
		lastSync: null,
		indexedFiles: [],
		failedFiles: [],
		...overrides,
	};
}

function baseFileListOptions(overrides: Partial<RagFileListOptions> = {}): RagFileListOptions {
	return {
		searchQuery: '',
		showAll: false,
		maxInitial: 200,
		onShowAll: () => {},
		...overrides,
	};
}

describe('rag-status-panel maps', () => {
	it('maps every known status to its localized label and falls back to unknown', () => {
		expect(ragStatusText('idle')).toBe(t('ragStatus.statusReady'));
		expect(ragStatusText('indexing')).toBe(t('ragStatus.statusIndexing'));
		expect(ragStatusText('error')).toBe(t('ragStatus.statusError'));
		expect(ragStatusText('paused')).toBe(t('ragStatus.statusPaused'));
		expect(ragStatusText('disabled')).toBe(t('ragStatus.statusDisabled'));
		expect(ragStatusText('rate_limited')).toBe(t('ragStatus.statusRateLimited'));
		expect(ragStatusText('nonsense')).toBe(t('ragStatus.statusUnknown'));
	});

	it('maps status to its CSS class, with no class for disabled/unknown', () => {
		expect(ragStatusClass('idle')).toBe('rag-status-ready');
		expect(ragStatusClass('indexing')).toBe('rag-status-indexing');
		expect(ragStatusClass('error')).toBe('rag-status-error');
		expect(ragStatusClass('paused')).toBe('rag-status-paused');
		expect(ragStatusClass('rate_limited')).toBe('rag-status-rate-limited');
		// 'disabled' has a label but intentionally no color class
		expect(ragStatusClass('disabled')).toBe('');
		expect(ragStatusClass('nonsense')).toBe('');
	});
});

describe('renderRagFileList', () => {
	it('shows the empty state when no files are indexed', () => {
		const container = makeEl('div');
		renderRagFileList(container, statusFixture(), baseFileListOptions());
		expect(container.querySelector('.rag-status-empty')?.textContent).toBe(t('ragStatus.noFilesIndexed'));
	});

	it('shows a no-matches state when the search filters everything out', () => {
		const container = makeEl('div');
		const status = statusFixture({ indexedFiles: [{ path: 'notes/a.md', lastIndexed: 1 }] });
		renderRagFileList(container, status, baseFileListOptions({ searchQuery: 'zzz' }));
		expect(container.querySelector('.rag-status-empty')?.textContent).toBe(t('ragStatus.noSearchMatches'));
	});

	it('caps the list at maxInitial and offers a show-all affordance', () => {
		const container = makeEl('div');
		const status = statusFixture({
			indexedFiles: [
				{ path: 'a.md', lastIndexed: 1 },
				{ path: 'b.md', lastIndexed: 2 },
				{ path: 'c.md', lastIndexed: 3 },
			],
		});
		renderRagFileList(container, status, baseFileListOptions({ maxInitial: 2 }));
		expect(container.querySelectorAll('.rag-status-file-item')).toHaveLength(2);
		expect(container.querySelector('.rag-status-show-more')).toBeTruthy();
	});

	it('shows every file and no affordance when showAll is set', () => {
		const container = makeEl('div');
		const status = statusFixture({
			indexedFiles: [
				{ path: 'a.md', lastIndexed: 1 },
				{ path: 'b.md', lastIndexed: 2 },
				{ path: 'c.md', lastIndexed: 3 },
			],
		});
		renderRagFileList(container, status, baseFileListOptions({ maxInitial: 2, showAll: true }));
		expect(container.querySelectorAll('.rag-status-file-item')).toHaveLength(3);
		expect(container.querySelector('.rag-status-show-more')).toBeNull();
	});

	it('invokes onShowAll when the affordance is clicked', () => {
		const container = makeEl('div');
		const status = statusFixture({
			indexedFiles: [
				{ path: 'a.md', lastIndexed: 1 },
				{ path: 'b.md', lastIndexed: 2 },
			],
		});
		const onShowAll = vi.fn();
		renderRagFileList(container, status, baseFileListOptions({ maxInitial: 1, onShowAll }));
		(container.querySelector('.rag-status-show-more') as HTMLElement).click();
		expect(onShowAll).toHaveBeenCalledTimes(1);
	});

	it('renders plain, non-interactive rows when onOpenFile is omitted', () => {
		const container = makeEl('div');
		const status = statusFixture({ indexedFiles: [{ path: 'note.md', lastIndexed: 1 }] });
		renderRagFileList(container, status, baseFileListOptions());
		const item = container.querySelector('.rag-status-file-item') as HTMLElement;
		expect(item.tagName).toBe('DIV');
		expect(item.classList.contains('rag-status-file-item--clickable')).toBe(false);
		expect(item.querySelector('.rag-status-file-path')?.textContent).toBe('note.md');
	});

	it('renders clickable button rows that open the file when onOpenFile is provided', () => {
		const container = makeEl('div');
		const status = statusFixture({ indexedFiles: [{ path: 'note.md', lastIndexed: 1 }] });
		const opened: string[] = [];
		renderRagFileList(container, status, baseFileListOptions({ onOpenFile: (p) => opened.push(p) }));
		const item = container.querySelector('.rag-status-file-item') as HTMLElement;
		expect(item.tagName).toBe('BUTTON');
		expect(item.classList.contains('rag-status-file-item--clickable')).toBe(true);
		item.click();
		expect(opened).toEqual(['note.md']);
	});
});

describe('renderRagFailures', () => {
	it('shows the empty state when there are no failures', () => {
		const container = makeEl('div');
		renderRagFailures(container, statusFixture());
		expect(container.querySelector('.rag-status-empty')?.textContent).toBe(t('ragStatus.noFailures'));
	});

	it('renders one row per failed file with its path and error', () => {
		const container = makeEl('div');
		const status = statusFixture({
			failedCount: 1,
			failedFiles: [{ path: 'bad.md', error: 'boom', timestamp: 1 }],
		});
		renderRagFailures(container, status);
		expect(container.querySelectorAll('.rag-status-failure-item')).toHaveLength(1);
		expect(container.querySelector('.rag-status-failure-path')?.textContent).toBe('bad.md');
		expect(container.querySelector('.rag-status-failure-error')?.textContent).toBe('boom');
	});
});

describe('renderRagOverview', () => {
	beforeEach(() => {
		buttonSpecs.length = 0;
		vi.mocked(Notice).mockClear();
	});

	function callbacks(overrides: Partial<RagOverviewCallbacks> = {}): RagOverviewCallbacks {
		return {
			onSyncNow: vi.fn().mockResolvedValue(undefined),
			onSyncSuccess: vi.fn(),
			formatSyncError: (e) => String(e),
			onReindex: vi.fn(),
			onOpenSettings: vi.fn(),
			...overrides,
		};
	}

	it('renders the status row with its label and CSS class', () => {
		const container = makeEl('div');
		renderRagOverview(container, statusFixture({ status: 'idle' }), callbacks());
		const statusValue = container.querySelector('.rag-status-value');
		expect(statusValue?.textContent).toBe(t('ragStatus.statusReady'));
		expect(statusValue?.classList.contains('rag-status-ready')).toBe(true);
	});

	it('disables Sync when there are no pending changes but keeps Reindex enabled', () => {
		const container = makeEl('div');
		renderRagOverview(container, statusFixture({ status: 'idle', pendingCount: 0 }), callbacks());
		const [sync, reindex] = buttonSpecs;
		expect(sync.disabled).toBe(true);
		expect(reindex.disabled).toBe(false);
	});

	it('enables Sync when there are pending changes', () => {
		const container = makeEl('div');
		renderRagOverview(container, statusFixture({ status: 'idle', pendingCount: 3 }), callbacks());
		const [sync, reindex] = buttonSpecs;
		expect(sync.disabled).toBe(false);
		expect(reindex.disabled).toBe(false);
	});

	it('disables both Sync and Reindex while indexing', () => {
		const container = makeEl('div');
		renderRagOverview(container, statusFixture({ status: 'indexing', pendingCount: 5 }), callbacks());
		const [sync, reindex] = buttonSpecs;
		expect(sync.disabled).toBe(true);
		expect(reindex.disabled).toBe(true);
	});

	it('runs onSyncSuccess after a successful sync', async () => {
		const container = makeEl('div');
		const cb = callbacks();
		renderRagOverview(container, statusFixture({ status: 'idle', pendingCount: 2 }), cb);
		await buttonSpecs[0].click?.();
		expect(cb.onSyncNow).toHaveBeenCalledTimes(1);
		expect(cb.onSyncSuccess).toHaveBeenCalledTimes(1);
		expect(Notice).not.toHaveBeenCalled();
	});

	it('shows a notice and skips onSyncSuccess when the sync fails', async () => {
		const container = makeEl('div');
		const formatSyncError = vi.fn().mockReturnValue('formatted');
		const cb = callbacks({
			onSyncNow: vi.fn().mockRejectedValue(new Error('nope')),
			formatSyncError,
		});
		renderRagOverview(container, statusFixture({ status: 'idle', pendingCount: 2 }), cb);
		await buttonSpecs[0].click?.();
		expect(cb.onSyncSuccess).not.toHaveBeenCalled();
		expect(formatSyncError).toHaveBeenCalledTimes(1);
		expect(Notice).toHaveBeenCalledTimes(1);
	});

	it('wires Reindex and Settings buttons to their callbacks', () => {
		const container = makeEl('div');
		const cb = callbacks();
		renderRagOverview(container, statusFixture({ status: 'idle', pendingCount: 1 }), cb);
		const [, reindex, settings] = buttonSpecs;
		reindex.click?.();
		settings.click?.();
		expect(cb.onReindex).toHaveBeenCalledTimes(1);
		expect(cb.onOpenSettings).toHaveBeenCalledTimes(1);
		expect(settings.cta).toBe(true);
	});
});
