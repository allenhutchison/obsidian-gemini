/**
 * Identify an encoded image's format from its magic bytes.
 *
 * Image models don't always return the format we ask for (Gemini image models
 * can return JPEG), and the response's declared MIME type can be missing or
 * wrong. The bytes are the only reliable source, so anything that names or
 * labels a generated image file should take its extension and MIME type from
 * here rather than assuming PNG.
 */

export interface ImageFormat {
	/** File extension without the dot, e.g. `jpg`. */
	extension: string;
	/** MIME type matching the bytes, e.g. `image/jpeg`. */
	mimeType: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
	if (bytes.length < offset + signature.length) return false;
	return signature.every((b, i) => bytes[offset + i] === b);
}

function asciiAt(bytes: Uint8Array, text: string, offset = 0): boolean {
	return startsWith(
		bytes,
		Array.from(text, (c) => c.charCodeAt(0)),
		offset
	);
}

/**
 * Return the format of `bytes`, or `null` when the signature is not one of
 * PNG, JPEG, WebP or GIF.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
	if (startsWith(bytes, PNG_SIGNATURE)) {
		return { extension: 'png', mimeType: 'image/png' };
	}
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
		return { extension: 'jpg', mimeType: 'image/jpeg' };
	}
	if (asciiAt(bytes, 'RIFF') && asciiAt(bytes, 'WEBP', 8)) {
		return { extension: 'webp', mimeType: 'image/webp' };
	}
	if (asciiAt(bytes, 'GIF8')) {
		return { extension: 'gif', mimeType: 'image/gif' };
	}
	return null;
}
