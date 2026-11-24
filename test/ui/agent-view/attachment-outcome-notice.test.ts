import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { AgentViewUI } from '../../../src/ui/agent-view/agent-view-ui';

vi.mock('../../../src/utils/dom-context', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../src/utils/dom-context')>()),
	insertTextAtCursor: vi.fn(),
}));

// #1799: the drop and paste surfaces share one notice policy for the result of
// `processAttachmentFiles`, so the same outcome shows the same message on both.

const NoticeMock = Notice as unknown as ReturnType<typeof vi.fn>;

function noticeTexts(): string[] {
	return NoticeMock.mock.calls.map((call) => String(call[0]));
}

function makeUI(result: { imagesProcessed: number; unsupportedCount: number }) {
	const ui = new AgentViewUI({} as any, { logger: { debug: vi.fn(), log: vi.fn() } } as any);
	const internals = ui as any;
	vi.spyOn(internals, 'processAttachmentFiles').mockResolvedValue(result);
	return internals;
}

async function drop(result: { imagesProcessed: number; unsupportedCount: number }): Promise<string[]> {
	NoticeMock.mockClear();
	const internals = makeUI(result);
	const png = new File(['x'], 'a.png', { type: 'image/png' });
	const event = { dataTransfer: { files: [png] }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
	await internals.handleExternalImageDrop(event, {});
	return noticeTexts();
}

async function paste(result: { imagesProcessed: number; unsupportedCount: number }): Promise<string[]> {
	NoticeMock.mockClear();
	const internals = makeUI(result);
	const input = document.createElement('div');
	internals.wireInputPaste(input, {});
	const png = new File(['x'], 'a.png', { type: 'image/png' });
	const event = new Event('paste', { cancelable: true }) as any;
	event.clipboardData = { files: [png], getData: () => '' };
	input.dispatchEvent(event);
	// The handler runs in a detached async IIFE; let it settle.
	await vi.waitFor(() => expect(internals.processAttachmentFiles).toHaveBeenCalled());
	await new Promise((r) => setTimeout(r, 0));
	return noticeTexts();
}

describe('attachment outcome notices (#1799)', () => {
	beforeEach(() => {
		NoticeMock.mockClear();
	});

	const cases = [
		{ name: 'one attached', result: { imagesProcessed: 1, unsupportedCount: 0 } },
		{ name: 'several attached', result: { imagesProcessed: 3, unsupportedCount: 0 } },
		{ name: 'some skipped alongside attached', result: { imagesProcessed: 2, unsupportedCount: 1 } },
		{ name: 'all skipped', result: { imagesProcessed: 0, unsupportedCount: 2 } },
	];

	for (const { name, result } of cases) {
		it(`drop and paste show the same notices: ${name}`, async () => {
			const dropped = await drop(result);
			const pasted = await paste(result);
			expect(dropped.length).toBeGreaterThan(0);
			expect(pasted).toEqual(dropped);
		});
	}

	it('skipped images always carry the format guidance', async () => {
		for (const result of [
			{ imagesProcessed: 2, unsupportedCount: 1 },
			{ imagesProcessed: 0, unsupportedCount: 2 },
		]) {
			const dropped = await drop(result);
			expect(dropped.some((m) => m.includes('PNG, JPEG, GIF, or WebP'))).toBe(true);
		}
	});
});
