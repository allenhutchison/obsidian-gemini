import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';

// Capture the arguments the lazy-imported modals are constructed with so the
// tests can invoke the callbacks `openRagStatusModal` wires up. Declared with
// `var` so vi.mock's hoisted factories can capture them (TDZ safe).
// eslint-disable-next-line no-var -- vi.mock hoisted factory must capture it (TDZ safe)
var statusModalArgs: any[] = [];
// eslint-disable-next-line no-var -- vi.mock hoisted factory must capture it (TDZ safe)
var progressModalArgs: any[] = [];
// eslint-disable-next-line no-var -- vi.mock hoisted factory must capture it (TDZ safe)
var statusModalOpen = vi.fn();
// eslint-disable-next-line no-var -- vi.mock hoisted factory must capture it (TDZ safe)
var progressModalOpen = vi.fn();

vi.mock('../../src/ui/rag-status-modal', () => ({
	RagStatusModal: vi.fn(function (...args: any[]) {
		statusModalArgs = args;
		return { open: statusModalOpen };
	}),
}));

vi.mock('../../src/ui/rag-progress-modal', () => ({
	RagProgressModal: vi.fn(function (...args: any[]) {
		progressModalArgs = args;
		return { open: progressModalOpen };
	}),
}));

import { openRagStatusModal, type RagStatusProvider } from '../../src/services/rag-status-bar';

function makeApp() {
	return { setting: { open: vi.fn(), openTabById: vi.fn() } } as any;
}

function makeProvider(overrides: Partial<RagStatusProvider> = {}): RagStatusProvider {
	return {
		getDetailedStatus: vi.fn(() => ({ status: 'idle' })),
		indexVault: vi.fn().mockResolvedValue({ indexed: 1, skipped: 0, failed: 0 }),
		syncPendingChanges: vi.fn().mockResolvedValue(true),
		...overrides,
	} as unknown as RagStatusProvider;
}

// The four callback args RagStatusModal is constructed with, after app + statusInfo.
const ON_OPEN_SETTINGS = 2;
const ON_REINDEX = 3;
const ON_SYNC_NOW = 4;

describe('openRagStatusModal', () => {
	beforeEach(() => {
		statusModalArgs = [];
		progressModalArgs = [];
		statusModalOpen.mockClear();
		progressModalOpen.mockClear();
		(Notice as unknown as ReturnType<typeof vi.fn>).mockClear();
	});

	it('constructs the status modal with the provider detailed status and opens it', async () => {
		const app = makeApp();
		const provider = makeProvider();

		await openRagStatusModal(app, provider, 'my-plugin-id');

		expect(provider.getDetailedStatus).toHaveBeenCalledTimes(1);
		expect(statusModalArgs[0]).toBe(app);
		expect(statusModalArgs[1]).toEqual({ status: 'idle' });
		expect(statusModalOpen).toHaveBeenCalledTimes(1);
	});

	it('open-settings callback opens the plugin settings tab', async () => {
		const app = makeApp();

		await openRagStatusModal(app, makeProvider(), 'my-plugin-id');
		statusModalArgs[ON_OPEN_SETTINGS]();

		expect(app.setting.open).toHaveBeenCalledTimes(1);
		expect(app.setting.openTabById).toHaveBeenCalledWith('my-plugin-id');
	});

	it('reindex callback opens the progress modal and triggers indexVault', async () => {
		const app = makeApp();
		const provider = makeProvider();

		await openRagStatusModal(app, provider, 'id');
		await statusModalArgs[ON_REINDEX]();

		expect(progressModalArgs[0]).toBe(app);
		expect(progressModalArgs[1]).toBe(provider);
		expect(progressModalOpen).toHaveBeenCalledTimes(1);
		expect(provider.indexVault).toHaveBeenCalledTimes(1);
	});

	it('reindex progress-complete callback shows the indexing-complete notice', async () => {
		await openRagStatusModal(makeApp(), makeProvider(), 'id');
		await statusModalArgs[ON_REINDEX]();

		// The helper passes an onComplete callback (3rd arg) to RagProgressModal.
		const onComplete = progressModalArgs[2];
		onComplete({ indexed: 3, skipped: 1, failed: 0 });

		expect(Notice).toHaveBeenCalledTimes(1);
	});

	it('reindex shows an error notice when indexVault rejects', async () => {
		const provider = makeProvider({ indexVault: vi.fn().mockRejectedValue(new Error('boom')) });

		await openRagStatusModal(makeApp(), provider, 'id');
		await statusModalArgs[ON_REINDEX]();
		// Flush the indexVault().catch() microtask so the failure notice fires.
		await Promise.resolve();
		await Promise.resolve();

		expect(Notice).toHaveBeenCalledTimes(1);
	});

	it('sync callback syncs pending changes and notifies when work was queued', async () => {
		const provider = makeProvider({ syncPendingChanges: vi.fn().mockResolvedValue(true) });

		await openRagStatusModal(makeApp(), provider, 'id');
		const result = await statusModalArgs[ON_SYNC_NOW]();

		expect(provider.syncPendingChanges).toHaveBeenCalledTimes(1);
		expect(result).toBe(true);
		expect(Notice).toHaveBeenCalledTimes(1);
	});

	it('sync callback does not notify when there was nothing pending', async () => {
		const provider = makeProvider({ syncPendingChanges: vi.fn().mockResolvedValue(false) });

		await openRagStatusModal(makeApp(), provider, 'id');
		const result = await statusModalArgs[ON_SYNC_NOW]();

		expect(result).toBe(false);
		expect(Notice).not.toHaveBeenCalled();
	});
});
