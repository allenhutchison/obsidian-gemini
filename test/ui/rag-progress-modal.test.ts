/**
 * Tests for RagProgressModal's completion handling (#1825).
 *
 * The modal treats a terminal status (anything but 'indexing' or
 * 'rate_limited') as the end of the run. Without a once-only guard, every later event re-ran the
 * completion path and fired onComplete again, one "Rescan complete" notice per
 * event.
 */

import type { RagProgressInfo, ProgressListener, RagProgressProvider } from '../../src/services/rag-types';

vi.mock('obsidian', () => ({
	getLanguage: () => 'en',
	setIcon: () => {},
	Setting: class {},
	Modal: class Modal {
		app: any;
		contentEl: HTMLElement;
		modalEl: HTMLElement;
		constructor(app: any) {
			this.app = app;
			this.contentEl = document.createElement('div');
			this.modalEl = document.createElement('div');
		}
		open() {}
		close() {}
	},
}));

import { RagProgressModal } from '../../src/ui/rag-progress-modal';

function info(overrides: Partial<RagProgressInfo>): RagProgressInfo {
	return {
		status: 'indexing',
		indexedCount: 0,
		skippedCount: 0,
		failedCount: 0,
		totalCount: 10,
		startTime: Date.now(),
		...overrides,
	} as RagProgressInfo;
}

function makeProvider(): RagProgressProvider {
	return {
		addProgressListener: vi.fn(),
		removeProgressListener: vi.fn(),
		getProgressInfo: () => info({}),
		cancelIndexing: vi.fn(),
	};
}

describe('RagProgressModal completion', () => {
	test('fires onComplete once even when more progress events follow the end of the run', () => {
		const onComplete = vi.fn();
		const modal = new RagProgressModal({} as any, makeProvider(), onComplete);
		const listener = (modal as any).progressListener as ProgressListener;

		listener(info({ status: 'idle', skippedCount: 3 }));
		listener(info({ status: 'idle', skippedCount: 4 }));
		listener(info({ status: 'idle', indexedCount: 1, skippedCount: 5 }));

		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(onComplete).toHaveBeenCalledWith({ indexed: 0, skipped: 3, failed: 0 });
	});

	test('later events do not repaint the completed display with partial counts', () => {
		const modal = new RagProgressModal({} as any, makeProvider(), vi.fn());
		const progressText = document.createElement('div');
		(progressText as any).setText = (text: string) => (progressText.textContent = text);
		(modal as any).progressText = progressText;
		const listener = (modal as any).progressListener as ProgressListener;

		listener(info({ status: 'idle', skippedCount: 10 }));
		expect(progressText.textContent).toBe('100% (10 / 10)');

		listener(info({ status: 'idle', skippedCount: 4 }));
		expect(progressText.textContent).toBe('100% (10 / 10)');
	});

	test('does not complete while the run is still indexing', () => {
		const onComplete = vi.fn();
		const modal = new RagProgressModal({} as any, makeProvider(), onComplete);
		const listener = (modal as any).progressListener as ProgressListener;

		listener(info({ status: 'indexing', skippedCount: 2 }));
		listener(info({ status: 'indexing', skippedCount: 5 }));

		expect(onComplete).not.toHaveBeenCalled();
	});

	test('a rate-limit cooldown does not end the run; the final result still shows', () => {
		const onComplete = vi.fn();
		const modal = new RagProgressModal({} as any, makeProvider(), onComplete);
		const progressText = document.createElement('div');
		(progressText as any).setText = (text: string) => (progressText.textContent = text);
		(modal as any).progressText = progressText;
		const listener = (modal as any).progressListener as ProgressListener;

		listener(info({ status: 'rate_limited', skippedCount: 3 }));
		listener(info({ status: 'indexing', skippedCount: 6 }));
		expect(onComplete).not.toHaveBeenCalled();

		listener(info({ status: 'idle', indexedCount: 2, skippedCount: 8 }));
		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(onComplete).toHaveBeenCalledWith({ indexed: 2, skipped: 8, failed: 0 });
		expect(progressText.textContent).toBe('100% (10 / 10)');
	});
});
