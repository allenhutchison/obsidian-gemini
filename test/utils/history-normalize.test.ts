import type { Content } from '@google/genai';
import { getLegacyEntryText, getLegacyEntryTextTruthy, normalizeToContent } from '../../src/utils/history-normalize';

describe('history-normalize', () => {
	// Identity coercion for tests that don't exercise role logic.
	const identityCoerce = (role: string | undefined): 'user' | 'model' => (role === 'user' ? 'user' : 'model');

	describe('getLegacyEntryText (nullish precedence)', () => {
		it('returns text when present', () => {
			expect(getLegacyEntryText({ text: 'hello' })).toBe('hello');
		});

		it('falls back to message when text is absent', () => {
			expect(getLegacyEntryText({ message: 'from message' })).toBe('from message');
		});

		it('prefers text over message when both are present', () => {
			expect(getLegacyEntryText({ text: 'the text', message: 'the message' })).toBe('the text');
		});

		it('keeps an empty-string text and does NOT fall back to message (nullish)', () => {
			// The distinguishing edge: `'' ?? message` === '', so message is not used.
			expect(getLegacyEntryText({ text: '', message: 'ignored' })).toBe('');
		});

		it('returns undefined when neither field is present', () => {
			expect(getLegacyEntryText({})).toBeUndefined();
		});

		it('returns undefined for non-string field values', () => {
			expect(getLegacyEntryText({ text: 42 })).toBeUndefined();
		});
	});

	describe('getLegacyEntryTextTruthy (truthiness precedence)', () => {
		it('returns text when present and non-empty', () => {
			expect(getLegacyEntryTextTruthy({ text: 'hello' })).toBe('hello');
		});

		it('falls back to message when text is absent', () => {
			expect(getLegacyEntryTextTruthy({ message: 'from message' })).toBe('from message');
		});

		it('prefers text over message when both are non-empty', () => {
			expect(getLegacyEntryTextTruthy({ text: 'the text', message: 'the message' })).toBe('the text');
		});

		it('falls back to message when text is an empty string (truthiness)', () => {
			// The distinguishing edge vs. getLegacyEntryText: '' is falsy, so message wins.
			expect(getLegacyEntryTextTruthy({ text: '', message: 'used' })).toBe('used');
		});

		it('returns undefined when both fields are empty strings', () => {
			expect(getLegacyEntryTextTruthy({ text: '', message: '' })).toBeUndefined();
		});

		it('returns undefined when neither field is present', () => {
			expect(getLegacyEntryTextTruthy({})).toBeUndefined();
		});
	});

	describe('normalizeToContent', () => {
		it('passes through a canonical { role, parts } entry unchanged', () => {
			const entry: Content = { role: 'user', parts: [{ text: 'hi' }] };
			expect(normalizeToContent(entry, identityCoerce)).toBe(entry);
		});

		it('normalizes a legacy { role, text } entry to Content', () => {
			const entry = { role: 'user', text: 'legacy text' } as unknown as Content;
			expect(normalizeToContent(entry, identityCoerce)).toEqual({
				role: 'user',
				parts: [{ text: 'legacy text' }],
			});
		});

		it('normalizes a legacy { role, message } entry to Content', () => {
			const entry = { role: 'model', message: 'legacy message' } as unknown as Content;
			expect(normalizeToContent(entry, identityCoerce)).toEqual({
				role: 'model',
				parts: [{ text: 'legacy message' }],
			});
		});

		it('prefers text over message with nullish precedence (keeps empty text)', () => {
			const entry = { role: 'user', text: '', message: 'ignored' } as unknown as Content;
			expect(normalizeToContent(entry, identityCoerce)).toEqual({
				role: 'user',
				parts: [{ text: '' }],
			});
		});

		it('applies the caller-supplied role coercion', () => {
			const entry = { role: 'system', message: 'x' } as unknown as Content;
			const coerceToModel = (): 'user' | 'model' => 'model';
			expect(normalizeToContent(entry, coerceToModel)).toEqual({
				role: 'model',
				parts: [{ text: 'x' }],
			});
		});

		it('returns null for an unrecognized entry (no parts, no text/message)', () => {
			const entry = { role: 'user' } as unknown as Content;
			expect(normalizeToContent(entry, identityCoerce)).toBeNull();
		});

		it('does not treat a malformed non-array parts entry as canonical', () => {
			// `'parts' in entry` is true but the value is not an array; with no legacy
			// text/message to recover, the entry is rejected rather than passed through.
			const entry = { role: 'user', parts: null } as unknown as Content;
			expect(normalizeToContent(entry, identityCoerce)).toBeNull();
		});

		it('recovers legacy text when parts is present but not an array', () => {
			// A malformed `{ parts: null }` entry that also carries a legacy `text`
			// field falls through to the legacy branch instead of losing the text.
			const entry = { role: 'user', parts: null, text: 'recovered' } as unknown as Content;
			expect(normalizeToContent(entry, identityCoerce)).toEqual({
				role: 'user',
				parts: [{ text: 'recovered' }],
			});
		});
	});
});
