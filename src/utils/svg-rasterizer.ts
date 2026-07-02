/**
 * Client-side SVG rasterization.
 *
 * Gemini's inline-data endpoint rejects `image/svg+xml` outright, so an SVG can
 * never be inlined directly. Instead we rasterize it to a PNG in the renderer
 * (Obsidian runs in Chromium/Electron, so a `<canvas>` is available) and inline
 * that PNG. Rasterizing — rather than sending the raw XML as text — is also the
 * only path that lets the model OCR ink/handwriting stored as `<path>` strokes.
 *
 * The rasterizer runs at the shared classify/inline boundary, so every entry
 * point (drag, paste, @-mention, ReadFileTool) shares this one implementation.
 */

/** Longest-edge cap for the rasterized PNG (px). Bounds the base64 payload and keeps OCR legible. */
export const SVG_RASTER_MAX_EDGE = 2048;

/** Fallback dimension (px) used when an SVG declares no intrinsic size and no viewBox. */
const SVG_FALLBACK_SIZE = 512;

/**
 * Whether an extension is an SVG variant that must be rasterized before inlining.
 *
 * @param extension - File extension, with or without a leading dot.
 */
export function isSvgExtension(extension: string): boolean {
	const ext = extension.replace(/^\./, '').toLowerCase();
	return ext === 'svg' || ext === 'svgz';
}

/**
 * Scale a (width, height) pair so its longest edge is at most `maxEdge`,
 * preserving aspect ratio. Dimensions already within the cap are returned
 * unchanged (never upscaled). Result dimensions are rounded to whole pixels
 * and clamped to a minimum of 1.
 */
export function computeScaledDimensions(
	width: number,
	height: number,
	maxEdge: number = SVG_RASTER_MAX_EDGE
): { width: number; height: number } {
	const w = width > 0 ? width : SVG_FALLBACK_SIZE;
	const h = height > 0 ? height : SVG_FALLBACK_SIZE;
	const longest = Math.max(w, h);
	if (longest <= maxEdge) {
		return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
	}
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale)),
	};
}

/**
 * Gzip-decompress an `.svgz` buffer using the Web Streams `DecompressionStream`
 * (available in Chromium/Electron and Node 18+).
 */
async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
	const ds = new DecompressionStream('gzip');
	const writer = ds.writable.getWriter();
	// Fire-and-forget the write; the reader below drains the inflated output.
	void writer.write(new Uint8Array(buffer));
	void writer.close();
	return await new Response(ds.readable).arrayBuffer();
}

/**
 * Parse intrinsic dimensions from an SVG document's markup as a fallback when
 * the loaded `<img>` reports no natural size (SVGs with only a `viewBox` and no
 * width/height often report 0 in some engines).
 */
function parseSvgDimensions(svgText: string): { width: number; height: number } {
	const rootMatch = svgText.match(/<svg\b[^>]*>/i);
	const root = rootMatch ? rootMatch[0] : '';

	const readLength = (attr: string): number => {
		const m = root.match(new RegExp(`\\b${attr}\\s*=\\s*["']?\\s*([0-9]*\\.?[0-9]+)`, 'i'));
		return m ? parseFloat(m[1]) : 0;
	};

	let width = readLength('width');
	let height = readLength('height');

	if (width <= 0 || height <= 0) {
		const vb = root.match(/\bviewBox\s*=\s*["']?\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/i);
		if (vb) {
			const vbW = parseFloat(vb[3]);
			const vbH = parseFloat(vb[4]);
			if (width <= 0) width = vbW;
			if (height <= 0) height = vbH;
		}
	}

	return { width, height };
}

/**
 * Load an SVG blob URL into an `<img>` element, resolving once decoded.
 * Rejects on load failure (malformed SVG, unresolvable external references).
 */
function loadSvgImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load SVG image'));
		img.src = url;
	});
}

/**
 * Rasterize an SVG (or gzip-compressed `.svgz`) to a base64-encoded PNG.
 *
 * The SVG is drawn onto an off-screen `<canvas>` scaled so its longest edge is
 * at most {@link SVG_RASTER_MAX_EDGE}px (aspect ratio preserved) over a white
 * background — ink strokes are frequently on a transparent canvas, and a
 * transparent→black flatten would ruin OCR.
 *
 * @param buffer - Raw file bytes (`.svg` XML or gzip-compressed `.svgz`).
 * @param isSvgz - Whether `buffer` is gzip-compressed and must be inflated first.
 * @returns Base64 PNG payload (no `data:` URI prefix).
 * @throws If the SVG cannot be decompressed, parsed, loaded, or rasterized —
 *   callers fall back to the existing "unsupported file type" notice.
 */
export async function rasterizeSvg(buffer: ArrayBuffer, isSvgz: boolean): Promise<string> {
	const svgBuffer = isSvgz ? await gunzip(buffer) : buffer;
	const svgText = new TextDecoder('utf-8').decode(new Uint8Array(svgBuffer));

	const blob = new Blob([svgBuffer], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);

	try {
		const img = await loadSvgImage(url);

		// Prefer the browser's intrinsic size; fall back to parsing the markup.
		let width = img.naturalWidth || img.width;
		let height = img.naturalHeight || img.height;
		if (width <= 0 || height <= 0) {
			const parsed = parseSvgDimensions(svgText);
			width = width > 0 ? width : parsed.width;
			height = height > 0 ? height : parsed.height;
		}

		const dims = computeScaledDimensions(width, height);

		const canvas = document.createElement('canvas');
		canvas.width = dims.width;
		canvas.height = dims.height;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Failed to acquire 2D canvas context for SVG rasterization');
		}

		// White background so transparent SVGs (ink strokes) do not flatten to black.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, dims.width, dims.height);
		ctx.drawImage(img, 0, 0, dims.width, dims.height);

		const dataUrl = canvas.toDataURL('image/png');
		const base64 = dataUrl.split(',')[1];
		if (!base64) {
			throw new Error('SVG rasterization produced no PNG data');
		}
		return base64;
	} finally {
		URL.revokeObjectURL(url);
	}
}
