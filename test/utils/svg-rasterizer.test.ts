import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gzipSync } from 'zlib';
import {
	rasterizeSvg,
	computeScaledDimensions,
	isSvgExtension,
	SVG_RASTER_MAX_EDGE,
} from '../../src/utils/svg-rasterizer';

const SIMPLE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="black"/></svg>';
const LARGE_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="8192" height="4096"><rect width="8192" height="4096" fill="black"/></svg>';
// viewBox but no explicit width/height — Chromium reports a reduced default
// intrinsic size (here mocked as 200×150), so the rasterizer must fall back to
// the viewBox extent (400×300) rather than the img's default.
const VIEWBOX_ONLY_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="black"/></svg>';

// --- Mock harness for the DOM rasterization path -------------------------------

let capturedBlobs: Blob[] = [];
let lastCanvasDims: { width: number; height: number } | null = null;
let lastContext: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> } | null =
	null;
let imageBehavior: 'load' | 'error' = 'load';
let imageNatural = { width: 100, height: 50 };

class MockImage {
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	naturalWidth = 0;
	naturalHeight = 0;
	width = 0;
	height = 0;
	private _src = '';
	set src(value: string) {
		this._src = value;
		// Fire asynchronously to mirror real image decoding.
		queueMicrotask(() => {
			if (imageBehavior === 'load') {
				this.naturalWidth = imageNatural.width;
				this.naturalHeight = imageNatural.height;
				this.onload?.();
			} else {
				this.onerror?.();
			}
		});
	}
	get src(): string {
		return this._src;
	}
}

let origCreate: typeof URL.createObjectURL;
let origRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
	capturedBlobs = [];
	lastCanvasDims = null;
	lastContext = null;
	imageBehavior = 'load';
	imageNatural = { width: 100, height: 50 };

	vi.stubGlobal('Image', MockImage);

	origCreate = URL.createObjectURL;
	origRevoke = URL.revokeObjectURL;
	URL.createObjectURL = ((blob: Blob) => {
		capturedBlobs.push(blob);
		return 'blob:mock-url';
	}) as typeof URL.createObjectURL;
	URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
		lastContext = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
		return lastContext as unknown as CanvasRenderingContext2D;
	});
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
		lastCanvasDims = { width: this.width, height: this.height };
		return 'data:image/png;base64,UE5HREFUQQ==';
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	URL.createObjectURL = origCreate;
	URL.revokeObjectURL = origRevoke;
});

// --- isSvgExtension ------------------------------------------------------------

describe('isSvgExtension', () => {
	it('recognizes svg and svgz with and without a dot, case-insensitively', () => {
		expect(isSvgExtension('svg')).toBe(true);
		expect(isSvgExtension('.svg')).toBe(true);
		expect(isSvgExtension('SVG')).toBe(true);
		expect(isSvgExtension('svgz')).toBe(true);
		expect(isSvgExtension('.SVGZ')).toBe(true);
	});

	it('rejects non-svg extensions', () => {
		expect(isSvgExtension('png')).toBe(false);
		expect(isSvgExtension('svgx')).toBe(false);
		expect(isSvgExtension('')).toBe(false);
	});
});

// --- computeScaledDimensions ---------------------------------------------------

describe('computeScaledDimensions', () => {
	it('leaves dimensions within the cap unchanged', () => {
		expect(computeScaledDimensions(100, 50)).toEqual({ width: 100, height: 50 });
		expect(computeScaledDimensions(2048, 1024)).toEqual({ width: 2048, height: 1024 });
	});

	it('scales oversized dimensions so the longest edge equals the cap, preserving aspect ratio', () => {
		expect(computeScaledDimensions(4096, 2048)).toEqual({ width: 2048, height: 1024 });
		expect(computeScaledDimensions(1000, 5000)).toEqual({ width: 410, height: 2048 });
	});

	it('never upscales and always caps the longest edge', () => {
		const { width, height } = computeScaledDimensions(8000, 100);
		expect(Math.max(width, height)).toBeLessThanOrEqual(SVG_RASTER_MAX_EDGE);
		expect(width).toBe(2048);
		expect(height).toBe(26); // round(100 * 2048/8000) = round(25.6) = 26
	});

	it('falls back to a default size when a dimension is zero or negative', () => {
		expect(computeScaledDimensions(0, 0)).toEqual({ width: 512, height: 512 });
		expect(computeScaledDimensions(-10, 200)).toEqual({ width: 512, height: 200 });
	});
});

// --- rasterizeSvg --------------------------------------------------------------

describe('rasterizeSvg', () => {
	it('returns a non-empty base64 PNG string for a valid SVG', async () => {
		const buffer = new TextEncoder().encode(SIMPLE_SVG).buffer;
		const base64 = await rasterizeSvg(buffer, false);
		expect(base64).toBe('UE5HREFUQQ==');
		expect(base64.length).toBeGreaterThan(0);
	});

	it('paints a white background before drawing the SVG', async () => {
		const buffer = new TextEncoder().encode(SIMPLE_SVG).buffer;
		await rasterizeSvg(buffer, false);
		expect(lastContext).not.toBeNull();
		expect(lastContext!.fillStyle).toBe('#ffffff');
		expect(lastContext!.fillRect).toHaveBeenCalled();
		expect(lastContext!.drawImage).toHaveBeenCalled();
	});

	it('decompresses .svgz before rasterizing', async () => {
		const gz = gzipSync(Buffer.from(SIMPLE_SVG, 'utf-8'));
		const buffer = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
		const base64 = await rasterizeSvg(buffer, true);
		expect(base64).toBe('UE5HREFUQQ==');
		// The blob handed to the image loader must be the decompressed SVG markup.
		expect(capturedBlobs.length).toBeGreaterThan(0);
		const decoded = await capturedBlobs[0].text();
		expect(decoded).toBe(SIMPLE_SVG);
	});

	it('scales an oversized SVG so neither canvas dimension exceeds the cap', async () => {
		const buffer = new TextEncoder().encode(LARGE_SVG).buffer;
		await rasterizeSvg(buffer, false);
		expect(lastCanvasDims).not.toBeNull();
		expect(lastCanvasDims!.width).toBeLessThanOrEqual(SVG_RASTER_MAX_EDGE);
		expect(lastCanvasDims!.height).toBeLessThanOrEqual(SVG_RASTER_MAX_EDGE);
		expect(lastCanvasDims!.width).toBe(2048);
		expect(lastCanvasDims!.height).toBe(1024);
	});

	it('rasterizes a viewBox-only SVG at the viewBox size, not the reduced img intrinsic size', async () => {
		// Mock the browser's reduced default intrinsic size for a viewBox-only SVG.
		imageNatural = { width: 200, height: 150 };
		const buffer = new TextEncoder().encode(VIEWBOX_ONLY_SVG).buffer;
		await rasterizeSvg(buffer, false);
		expect(lastCanvasDims).toEqual({ width: 400, height: 300 });
	});

	it('rejects when the SVG fails to load (malformed / unresolvable refs)', async () => {
		imageBehavior = 'error';
		const buffer = new TextEncoder().encode('<not-svg>').buffer;
		await expect(rasterizeSvg(buffer, false)).rejects.toThrow(/Failed to load SVG/);
	});
});
