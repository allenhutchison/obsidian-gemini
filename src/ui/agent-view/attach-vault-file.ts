/**
 * Shared vault-binary → InlineAttachment pipeline (#1363).
 *
 * The vault-drop path (agent-view-ui.ts) and the @-mention path
 * (agent-view-attachments.ts) each had a private copy of read → budget check →
 * rasterize-or-base64 → .webm sniff → build record, and the copies had drifted
 * in which notices they show on failure. This leaf owns only the part both
 * paths share; each caller keeps its own notice behavior by switching on the
 * discriminated result.
 *
 * Leaf module: imports only siblings it must know (`inline-attachment`) and
 * utils leaves (`file-classification`, `svg-rasterizer`) — no cycle risk.
 */

import type { App, TFile } from 'obsidian';
import {
	FileCategory,
	GEMINI_INLINE_DATA_LIMIT,
	arrayBufferToBase64,
	classifyFile,
	detectWebmMimeType,
} from '../../utils/file-classification';
import { rasterizeSvg } from '../../utils/svg-rasterizer';
import { base64DecodedBytes, generateAttachmentId, type InlineAttachment } from './inline-attachment';
import type { Logger } from '../../utils/logger';

export type VaultAttachmentResult =
	| { kind: 'ok'; attachment: InlineAttachment; bytes: number }
	| { kind: 'too-large' }
	| { kind: 'raster-failed' }
	| { kind: 'read-failed'; error: unknown };

/**
 * Read a vault file as an inline attachment, honoring the shared 20 MB budget.
 *
 * `alreadyUsedBytes` is the caller's current attachment total (each path seeds
 * it its own way). The helper reads the file, checks the budget, rasterizes
 * SVG/SVGZ to PNG or base64-encodes the raw buffer (sniffing audio vs video
 * for `.webm`), and returns the built record plus the file's raw byte length
 * on success. Failure kinds never log by themselves except the rasterize
 * failure, whose message is byte-identical in both call sites today — the
 * `read-failed` error is returned instead so each caller logs its own wording
 * (drop says "Failed to read…", @-mention says "Failed to attach…").
 *
 * @param app - Obsidian App (vault.readBinary)
 * @param file - the vault file (must classify as GEMINI_BINARY or SVG)
 * @param alreadyUsedBytes - attachment bytes already consumed by the caller
 * @param logger - plugin logger for the rasterize failure
 * @returns discriminated result; `bytes` is present only on `ok`
 */
export async function attachVaultBinaryFile(
	app: App,
	file: TFile,
	alreadyUsedBytes: number,
	logger: Logger
): Promise<VaultAttachmentResult> {
	let buffer: ArrayBuffer;
	try {
		buffer = await app.vault.readBinary(file);
	} catch (err) {
		return { kind: 'read-failed', error: err };
	}

	if (alreadyUsedBytes + buffer.byteLength > GEMINI_INLINE_DATA_LIMIT) {
		return { kind: 'too-large' };
	}

	const classification = classifyFile(file.extension);
	let base64: string;
	let mimeType: string;
	let bytes = buffer.byteLength;
	if (classification.category === FileCategory.SVG) {
		// SVG can't be inlined directly — rasterize to PNG. On failure
		// (malformed SVG, unresolvable refs), fall back to the caller's
		// unsupported-file notice rather than sending raw XML.
		try {
			base64 = await rasterizeSvg(buffer, file.extension.toLowerCase() === 'svgz');
			mimeType = 'image/png';
		} catch (rasterErr) {
			logger.error(`Failed to rasterize SVG ${file.path}:`, rasterErr);
			return { kind: 'raster-failed' };
		}
		// The rasterized PNG can be larger than the source SVG (it's a decoded
		// bitmap), so the budget — checked above against the small source file —
		// has to hold for the converted payload too (#1412 review).
		const convertedBytes = base64DecodedBytes(base64);
		if (alreadyUsedBytes + convertedBytes > GEMINI_INLINE_DATA_LIMIT) {
			return { kind: 'too-large' };
		}
		bytes = convertedBytes;
	} else {
		base64 = arrayBufferToBase64(buffer);
		// For .webm files, detect audio vs video from container header
		mimeType = file.extension.toLowerCase() === 'webm' ? detectWebmMimeType(buffer) : classification.mimeType;
	}

	return {
		kind: 'ok',
		attachment: {
			base64,
			mimeType,
			id: generateAttachmentId(),
			vaultPath: file.path,
			fileName: file.name,
		},
		bytes,
	};
}
