import { sniffImageFormat } from '../../src/utils/image-format';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

describe('sniffImageFormat', () => {
	it('detects PNG from its 8-byte signature', () => {
		expect(sniffImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toEqual({
			extension: 'png',
			mimeType: 'image/png',
		});
	});

	it('detects JPEG from FF D8 FF (JFIF and Exif variants)', () => {
		expect(sniffImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0, ...ascii('\0\x10JFIF')))).toEqual({
			extension: 'jpg',
			mimeType: 'image/jpeg',
		});
		expect(sniffImageFormat(bytes(0xff, 0xd8, 0xff, 0xe1))?.extension).toBe('jpg');
	});

	it('detects WebP from RIFF....WEBP', () => {
		expect(sniffImageFormat(bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBPVP8 ')))).toEqual({
			extension: 'webp',
			mimeType: 'image/webp',
		});
	});

	it('does not treat a non-WebP RIFF container (e.g. WAV) as WebP', () => {
		expect(sniffImageFormat(bytes(...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WAVE')))).toBeNull();
	});

	it('detects GIF87a and GIF89a', () => {
		expect(sniffImageFormat(bytes(...ascii('GIF89a')))).toEqual({ extension: 'gif', mimeType: 'image/gif' });
		expect(sniffImageFormat(bytes(...ascii('GIF87a')))?.extension).toBe('gif');
	});

	it('returns null for unknown or truncated data', () => {
		expect(sniffImageFormat(bytes())).toBeNull();
		expect(sniffImageFormat(bytes(0xff, 0xd8))).toBeNull();
		expect(sniffImageFormat(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
		expect(sniffImageFormat(bytes(...ascii('hello world')))).toBeNull();
	});
});
