/**
 * Tests for the shared vault-binary → InlineAttachment pipeline (#1363).
 *
 * This leaf was extracted because the vault-drop path (agent-view-ui.ts) and
 * the @-mention path (agent-view-attachments.ts) each had a private copy that
 * had drifted in failure notices. These tests pin the helper's contract:
 * result arms, budget edge behavior, `.webm` sniffing, and SVG rasterization.
 */

import { attachVaultBinaryFile } from '../../../src/ui/agent-view/attach-vault-file';
import { estimateAttachmentBytes, type InlineAttachment } from '../../../src/ui/agent-view/inline-attachment';
import { GEMINI_INLINE_DATA_LIMIT } from '../../../src/utils/file-classification';
import type { App, TFile } from 'obsidian';

vi.mock('obsidian', async () => {
	const original = await vi.importActual<any>('../../../__mocks__/obsidian.js');
	return { ...original, requestUrl: vi.fn() };
});

// Rasterization is mocked: the helper only forwards the buffer and maps a
// rejection to `raster-failed`; the renderer itself has its own tests.
const rasterizeSvg = vi.fn();
vi.mock('../../../src/utils/svg-rasterizer', () => ({
	rasterizeSvg: (...args: unknown[]) => rasterizeSvg(...args),
}));

const logger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeFile(path: string, extension: string): TFile {
	return { path, name: path.split('/').pop(), extension } as unknown as TFile;
}

function mockVault(buffer: ArrayBuffer | Error): App {
	return {
		vault: {
			readBinary: vi
				.fn()
				.mockImplementation(() => (buffer instanceof Error ? Promise.reject(buffer) : Promise.resolve(buffer))),
		},
	} as unknown as App;
}

// A distinctive byte pattern so we can verify the base64 round-trip.
function bufferOf(content: number[]): ArrayBuffer {
	return new Uint8Array(content).buffer;
}

beforeEach(() => {
	vi.clearAllMocks();
	rasterizeSvg.mockReset();
});

describe('attachVaultBinaryFile', () => {
	it('wraps a plain binary in an ok attachment with the classified mime type', async () => {
		const app = mockVault(bufferOf([0x25, 0x50, 0x44, 0x46])); // "%PDF"
		const result = await attachVaultBinaryFile(app, makeFile('notes/doc.pdf', 'pdf'), 0, logger as never);

		expect(result.kind).toBe('ok');
		if (result.kind !== 'ok') return;
		expect(result.bytes).toBe(4);
		expect(result.attachment.mimeType).toBe('application/pdf');
		expect(result.attachment.vaultPath).toBe('notes/doc.pdf');
		expect(result.attachment.fileName).toBe('doc.pdf');
		expect(result.attachment.id).toMatch(/^att-/);
		// btoa("%PDF") — the raw buffer's base64 encoding
		expect(result.attachment.base64).toBe(btoa('%PDF'));
	});

	it('sniffs .webm as video when a video codec signature is present', async () => {
		// EBML header + V_VP8 signature, with trailing padding (the scanner skips
		// the last 5 bytes of the buffer).
		const bytes = [0x1a, 0x45, 0xdf, 0xa3, 0x56, 0x5f, 0x56, 0x50, 0x38, 0x00, 0x00, 0x00];
		const result = await attachVaultBinaryFile(
			mockVault(bufferOf(bytes)),
			makeFile('a.webm', 'webm'),
			0,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);

		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') expect(result.attachment.mimeType).toBe('video/webm');
	});

	it('defaults .webm without a video codec to audio/webm', async () => {
		const result = await attachVaultBinaryFile(
			mockVault(bufferOf([1, 2, 3])),
			makeFile('a.webm', 'webm'),
			0,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);

		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') expect(result.attachment.mimeType).toBe('audio/webm');
	});

	it('rasterizes SVG to PNG with the svgz flag passed through', async () => {
		rasterizeSvg.mockResolvedValue('rasterized-base64');
		const result = await attachVaultBinaryFile(
			mockVault(bufferOf([1])),
			makeFile('icon.svgz', 'svgz'),
			0,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);

		expect(rasterizeSvg).toHaveBeenCalledWith(expect.anything(), true);
		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') {
			expect(result.attachment.mimeType).toBe('image/png');
			expect(result.attachment.base64).toBe('rasterized-base64');
		}
	});

	it('returns raster-failed when rasterization rejects', async () => {
		rasterizeSvg.mockRejectedValue(new Error('bad svg'));
		const result = await attachVaultBinaryFile(
			mockVault(bufferOf([1])),
			makeFile('icon.svg', 'svg'),
			0,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);

		expect(result.kind).toBe('raster-failed');
		expect(logger.error).toHaveBeenCalledWith('Failed to rasterize SVG icon.svg:', expect.any(Error));
	});

	it('returns too-large at the budget edge and reports no consumed bytes', async () => {
		// Exactly at the limit is still allowed; one byte over is not.
		const buffer = bufferOf(new Array(10).fill(7));
		const app = mockVault(buffer);
		const exact = await attachVaultBinaryFile(
			app,
			makeFile('a.pdf', 'pdf'),
			GEMINI_INLINE_DATA_LIMIT - 10,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);
		expect(exact.kind).toBe('ok');

		const over = await attachVaultBinaryFile(
			app,
			makeFile('a.pdf', 'pdf'),
			GEMINI_INLINE_DATA_LIMIT - 9,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);
		expect(over).toEqual({ kind: 'too-large' });
	});

	it('returns read-failed with the error when readBinary rejects', async () => {
		const app = mockVault(new Error('disk gone'));
		const result = await attachVaultBinaryFile(
			app,
			makeFile('a.pdf', 'pdf'),
			0,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);

		expect(result.kind).toBe('read-failed');
		if (result.kind === 'read-failed') {
			expect((result.error as Error).message).toBe('disk gone');
		}
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('only counts the buffer toward the budget once (caller seeds the total)', async () => {
		const app = mockVault(bufferOf(new Array(5).fill(1)));
		// previous usage already consumed the whole budget: the 5-byte buffer tips it over
		const result = await attachVaultBinaryFile(
			app,
			makeFile('a.pdf', 'pdf'),
			GEMINI_INLINE_DATA_LIMIT,
			logger as unknown as Parameters<typeof attachVaultBinaryFile>[3]
		);
		expect(result.kind).toBe('too-large');
	});
});

describe('estimateAttachmentBytes', () => {
	it('sums ceil(base64 length * 3 / 4) across attachments', async () => {
		const attachments = [
			{ base64: 'A'.repeat(12), mimeType: 'image/png', id: '1' } as InlineAttachment,
			{ base64: 'B'.repeat(13), mimeType: 'image/png', id: '2' } as InlineAttachment,
		];
		expect(estimateAttachmentBytes(attachments)).toBe(9 + 10);
	});

	it('returns zero for an empty shelf', () => {
		expect(estimateAttachmentBytes([])).toBe(0);
	});
});
