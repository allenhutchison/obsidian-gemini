/**
 * File classification utility for routing dropped files to the correct handler.
 *
 * Classifies files as TEXT (context chips), GEMINI_BINARY (inline attachments),
 * or UNSUPPORTED based on their extension.
 */

import { EXTENSION_TO_MIME, TEXT_FALLBACK_EXTENSIONS } from '@allenhutchison/gemini-utils';

/** Maximum size for inline data sent to Gemini (20 MB) */
export const GEMINI_INLINE_DATA_LIMIT = 20 * 1024 * 1024;

/**
 * MIME types for binary files that Gemini can consume as inline data.
 * Maps file extension (without dot) to MIME type.
 */
export const GEMINI_INLINE_BINARY_MIMES: Record<string, string> = {
	// Images
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	heic: 'image/heic',
	heif: 'image/heif',

	// Audio
	wav: 'audio/wav',
	mp3: 'audio/mp3',
	aac: 'audio/aac',
	flac: 'audio/flac',

	// Video
	mp4: 'video/mp4',
	mpeg: 'video/mpeg',
	mov: 'video/quicktime',
	flv: 'video/x-flv',
	mpg: 'video/mpeg',
	webm: 'video/webm',
	wmv: 'video/x-ms-wmv',
	'3gp': 'video/3gpp',

	// Documents
	pdf: 'application/pdf',
};

export enum FileCategory {
	TEXT = 'text',
	GEMINI_BINARY = 'gemini_binary',
	UNSUPPORTED = 'unsupported',
}

export interface FileClassification {
	category: FileCategory;
	mimeType: string;
	reason?: string;
}

/**
 * Classify a file extension into TEXT, GEMINI_BINARY, or UNSUPPORTED.
 *
 * @param extension - File extension without leading dot (e.g. "md", "png", "zip")
 */
export function classifyFile(extension: string): FileClassification {
	// Normalize: strip leading dot, lowercase
	const ext = extension.replace(/^\./, '').toLowerCase();

	// Check binary types first (more specific match)
	if (Object.prototype.hasOwnProperty.call(GEMINI_INLINE_BINARY_MIMES, ext)) {
		return {
			category: FileCategory.GEMINI_BINARY,
			mimeType: GEMINI_INLINE_BINARY_MIMES[ext],
		};
	}

	// Check text types via gemini-utils EXTENSION_TO_MIME (uses dot-prefixed keys)
	const dotExt = `.${ext}`;
	if (Object.prototype.hasOwnProperty.call(EXTENSION_TO_MIME, dotExt)) {
		return {
			category: FileCategory.TEXT,
			mimeType: EXTENSION_TO_MIME[dotExt],
		};
	}

	// Check text fallback extensions
	if (TEXT_FALLBACK_EXTENSIONS.has(dotExt)) {
		return {
			category: FileCategory.TEXT,
			mimeType: 'text/plain',
		};
	}

	return {
		category: FileCategory.UNSUPPORTED,
		mimeType: '',
		reason: `Unsupported file type: .${ext}`,
	};
}

/**
 * Detect whether a WebM buffer contains a video track by searching for
 * video codec IDs (V_VP8, V_VP9, V_AV1) in the Matroska container header.
 * Returns 'audio/webm' if no video track is found, 'video/webm' otherwise.
 */
export function detectWebmMimeType(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	// Only scan the first 4KB — track metadata is near the start
	const scanLimit = Math.min(bytes.length, 4096);

	// Look for video codec ID strings: "V_VP8", "V_VP9", "V_AV1"
	const videoSignatures = [
		[0x56, 0x5f, 0x56, 0x50, 0x38], // V_VP8
		[0x56, 0x5f, 0x56, 0x50, 0x39], // V_VP9
		[0x56, 0x5f, 0x41, 0x56, 0x31], // V_AV1
	];

	for (let i = 0; i < scanLimit - 5; i++) {
		for (const sig of videoSignatures) {
			if (
				bytes[i] === sig[0] &&
				bytes[i + 1] === sig[1] &&
				bytes[i + 2] === sig[2] &&
				bytes[i + 3] === sig[3] &&
				bytes[i + 4] === sig[4]
			) {
				return 'video/webm';
			}
		}
	}

	return 'audio/webm';
}

/**
 * Convert an ArrayBuffer to a base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const CHUNK_SIZE = 0x8000; // 32KB chunks
	const chunks: string[] = [];
	for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
		const chunk = bytes.subarray(i, i + CHUNK_SIZE);
		chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
	}
	return btoa(chunks.join(''));
}
