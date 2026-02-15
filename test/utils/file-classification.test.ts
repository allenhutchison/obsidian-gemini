import {
	classifyFile,
	FileCategory,
	arrayBufferToBase64,
	GEMINI_INLINE_DATA_LIMIT,
	GEMINI_INLINE_BINARY_MIMES,
} from '../../src/utils/file-classification';

// Mock the gemini-utils module
jest.mock('@allenhutchison/gemini-utils', () => ({
	EXTENSION_TO_MIME: {
		'.md': 'text/markdown',
		'.txt': 'text/plain',
		'.html': 'text/html',
		'.pdf': 'application/pdf',
		'.py': 'text/x-python',
		'.c': 'text/x-c',
	},
	TEXT_FALLBACK_EXTENSIONS: new Set(['.ts', '.js', '.json', '.css', '.yaml', '.tsx', '.jsx', '.csv']),
}));

describe('file-classification', () => {
	describe('classifyFile', () => {
		it('should classify markdown files as TEXT', () => {
			const result = classifyFile('md');
			expect(result.category).toBe(FileCategory.TEXT);
			expect(result.mimeType).toBe('text/markdown');
		});

		it('should classify .txt files as TEXT', () => {
			const result = classifyFile('txt');
			expect(result.category).toBe(FileCategory.TEXT);
			expect(result.mimeType).toBe('text/plain');
		});

		it('should classify TypeScript files as TEXT via fallback', () => {
			const result = classifyFile('ts');
			expect(result.category).toBe(FileCategory.TEXT);
			expect(result.mimeType).toBe('text/plain');
		});

		it('should classify JSON files as TEXT via fallback', () => {
			const result = classifyFile('json');
			expect(result.category).toBe(FileCategory.TEXT);
			expect(result.mimeType).toBe('text/plain');
		});

		it('should classify .png as GEMINI_BINARY', () => {
			const result = classifyFile('png');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('image/png');
		});

		it('should classify .jpg as GEMINI_BINARY', () => {
			const result = classifyFile('jpg');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('image/jpeg');
		});

		it('should classify .pdf as GEMINI_BINARY', () => {
			const result = classifyFile('pdf');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('application/pdf');
		});

		it('should classify .mp3 as GEMINI_BINARY', () => {
			const result = classifyFile('mp3');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('audio/mp3');
		});

		it('should classify .mp4 as GEMINI_BINARY', () => {
			const result = classifyFile('mp4');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('video/mp4');
		});

		it('should classify .wav as GEMINI_BINARY', () => {
			const result = classifyFile('wav');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('audio/wav');
		});

		it('should classify .webm as GEMINI_BINARY', () => {
			const result = classifyFile('webm');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
			expect(result.mimeType).toBe('video/webm');
		});

		it('should classify .zip as UNSUPPORTED', () => {
			const result = classifyFile('zip');
			expect(result.category).toBe(FileCategory.UNSUPPORTED);
			expect(result.mimeType).toBe('');
			expect(result.reason).toContain('zip');
		});

		it('should classify .exe as UNSUPPORTED', () => {
			const result = classifyFile('exe');
			expect(result.category).toBe(FileCategory.UNSUPPORTED);
		});

		it('should classify .dmg as UNSUPPORTED', () => {
			const result = classifyFile('dmg');
			expect(result.category).toBe(FileCategory.UNSUPPORTED);
		});

		it('should be case insensitive', () => {
			expect(classifyFile('PNG').category).toBe(FileCategory.GEMINI_BINARY);
			expect(classifyFile('MD').category).toBe(FileCategory.TEXT);
			expect(classifyFile('Pdf').category).toBe(FileCategory.GEMINI_BINARY);
		});

		it('should handle extension without dot', () => {
			// Extension passed without dot (as TFile.extension provides)
			const result = classifyFile('md');
			expect(result.category).toBe(FileCategory.TEXT);
		});

		it('should prioritize binary classification over text for PDF', () => {
			// PDF is in both GEMINI_INLINE_BINARY_MIMES and EXTENSION_TO_MIME
			// Binary should win since we check it first
			const result = classifyFile('pdf');
			expect(result.category).toBe(FileCategory.GEMINI_BINARY);
		});
	});

	describe('arrayBufferToBase64', () => {
		it('should convert empty buffer', () => {
			const buffer = new ArrayBuffer(0);
			expect(arrayBufferToBase64(buffer)).toBe('');
		});

		it('should convert simple byte array', () => {
			const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
			const base64 = arrayBufferToBase64(buffer);
			expect(base64).toBe(btoa('Hello'));
		});

		it('should handle binary data with high bytes', () => {
			const buffer = new Uint8Array([0, 128, 255]).buffer;
			const result = arrayBufferToBase64(buffer);
			// Verify it's valid base64
			expect(() => atob(result)).not.toThrow();
		});
	});

	describe('constants', () => {
		it('should define 20MB inline data limit', () => {
			expect(GEMINI_INLINE_DATA_LIMIT).toBe(20 * 1024 * 1024);
		});

		it('should include all expected image types', () => {
			expect(GEMINI_INLINE_BINARY_MIMES['png']).toBe('image/png');
			expect(GEMINI_INLINE_BINARY_MIMES['jpg']).toBe('image/jpeg');
			expect(GEMINI_INLINE_BINARY_MIMES['jpeg']).toBe('image/jpeg');
			expect(GEMINI_INLINE_BINARY_MIMES['gif']).toBe('image/gif');
			expect(GEMINI_INLINE_BINARY_MIMES['webp']).toBe('image/webp');
		});

		it('should include audio types', () => {
			expect(GEMINI_INLINE_BINARY_MIMES['mp3']).toBe('audio/mp3');
			expect(GEMINI_INLINE_BINARY_MIMES['wav']).toBe('audio/wav');
			expect(GEMINI_INLINE_BINARY_MIMES['flac']).toBe('audio/flac');
		});

		it('should include video types', () => {
			expect(GEMINI_INLINE_BINARY_MIMES['mp4']).toBe('video/mp4');
			expect(GEMINI_INLINE_BINARY_MIMES['webm']).toBe('video/webm');
			expect(GEMINI_INLINE_BINARY_MIMES['mov']).toBe('video/quicktime');
		});

		it('should include PDF', () => {
			expect(GEMINI_INLINE_BINARY_MIMES['pdf']).toBe('application/pdf');
		});
	});
});
