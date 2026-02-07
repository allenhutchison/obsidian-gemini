import { decodeHtmlEntities } from '../../src/utils/html-entities';

describe('decodeHtmlEntities', () => {
	// --- Basic named entities ---
	it('decodes single-encoded named entities', () => {
		expect(decodeHtmlEntities('&amp;')).toBe('&');
		expect(decodeHtmlEntities('&lt;')).toBe('<');
		expect(decodeHtmlEntities('&gt;')).toBe('>');
		expect(decodeHtmlEntities('&quot;')).toBe('"');
		expect(decodeHtmlEntities('&apos;')).toBe("'");
		expect(decodeHtmlEntities('&nbsp;')).toBe('\u00A0');
	});

	it('decodes multiple entities in a sentence', () => {
		expect(decodeHtmlEntities('He said &quot;hello&quot; &amp; goodbye')).toBe('He said "hello" & goodbye');
	});

	// --- Multi-layer encoding ---
	it('decodes double-encoded entities', () => {
		// &amp;quot; → &quot; → "
		expect(decodeHtmlEntities('&amp;quot;')).toBe('"');
		// &amp;amp; → &amp; → &
		expect(decodeHtmlEntities('&amp;amp;')).toBe('&');
		// &amp;lt; → &lt; → <
		expect(decodeHtmlEntities('&amp;lt;')).toBe('<');
	});

	it('decodes triple-encoded entities', () => {
		// &amp;amp;quot; → &amp;quot; → &quot; → "
		expect(decodeHtmlEntities('&amp;amp;quot;')).toBe('"');
		// &amp;amp;amp; → &amp;amp; → &amp; → &
		expect(decodeHtmlEntities('&amp;amp;amp;')).toBe('&');
	});

	it('decodes a realistic triple-encoded sentence', () => {
		const input = 'She said &amp;amp;quot;hello&amp;amp;quot; &amp;amp;amp; waved';
		expect(decodeHtmlEntities(input)).toBe('She said "hello" & waved');
	});

	// --- Numeric entities ---
	it('decodes decimal numeric entities', () => {
		expect(decodeHtmlEntities('&#39;')).toBe("'");
		expect(decodeHtmlEntities('&#34;')).toBe('"');
		expect(decodeHtmlEntities('&#60;')).toBe('<');
		expect(decodeHtmlEntities('&#62;')).toBe('>');
		expect(decodeHtmlEntities('&#38;')).toBe('&');
	});

	it('decodes hex numeric entities', () => {
		expect(decodeHtmlEntities('&#x27;')).toBe("'");
		expect(decodeHtmlEntities('&#x22;')).toBe('"');
		expect(decodeHtmlEntities('&#x3C;')).toBe('<');
		expect(decodeHtmlEntities('&#x3E;')).toBe('>');
		expect(decodeHtmlEntities('&#x26;')).toBe('&');
	});

	it('decodes double-encoded numeric entities', () => {
		// &amp;#39; → &#39; → '
		expect(decodeHtmlEntities('&amp;#39;')).toBe("'");
		// &amp;#x27; → &#x27; → '
		expect(decodeHtmlEntities('&amp;#x27;')).toBe("'");
	});

	// --- Code block preservation ---
	it('preserves entities inside fenced code blocks', () => {
		const input = 'Before &amp; ```const x = &amp;amp;``` After &amp;';
		expect(decodeHtmlEntities(input)).toBe('Before & ```const x = &amp;amp;``` After &');
	});

	it('preserves entities inside multi-line code blocks', () => {
		const input = 'Text &quot;here&quot;\n```\ncode &amp; more &lt;tag&gt;\n```\nEnd &amp;';
		expect(decodeHtmlEntities(input)).toBe('Text "here"\n```\ncode &amp; more &lt;tag&gt;\n```\nEnd &');
	});

	it('handles multiple code blocks', () => {
		const input = '&amp; ```&amp;``` middle &amp; ```&amp;``` &amp;';
		expect(decodeHtmlEntities(input)).toBe('& ```&amp;``` middle & ```&amp;``` &');
	});

	// --- Edge cases ---
	it('returns empty string unchanged', () => {
		expect(decodeHtmlEntities('')).toBe('');
	});

	it('returns null/undefined unchanged', () => {
		expect(decodeHtmlEntities(null as unknown as string)).toBe(null);
		expect(decodeHtmlEntities(undefined as unknown as string)).toBe(undefined);
	});

	it('passes through text with no entities', () => {
		const input = 'Hello, world! This is plain text with no entities.';
		expect(decodeHtmlEntities(input)).toBe(input);
	});

	it('handles entities at string boundaries', () => {
		expect(decodeHtmlEntities('&amp;start')).toBe('&start');
		expect(decodeHtmlEntities('end&amp;')).toBe('end&');
		expect(decodeHtmlEntities('&amp;')).toBe('&');
	});

	it('handles unknown named entities gracefully', () => {
		expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
	});

	it('does not loop infinitely on malformed input', () => {
		// This should terminate even with deeply nested encoding
		const input = '&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;';
		const result = decodeHtmlEntities(input);
		// After 5 iterations the remaining entities are left as-is
		expect(typeof result).toBe('string');
	});

	it('handles invalid Unicode code points gracefully', () => {
		// Code point above U+10FFFF should be left as-is
		expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;');
		// Extremely large decimal code point
		expect(decodeHtmlEntities('&#999999999;')).toBe('&#999999999;');
	});

	// --- Mixed content ---
	it('handles mixed entities and plain text', () => {
		const input = 'The &lt;div&gt; element &amp; the &quot;class&quot; attribute';
		expect(decodeHtmlEntities(input)).toBe('The <div> element & the "class" attribute');
	});

	it('handles entities mixed with markdown', () => {
		const input = '**Bold** text with &quot;quotes&quot; and `inline &amp; code`';
		expect(decodeHtmlEntities(input)).toBe('**Bold** text with "quotes" and `inline & code`');
	});
});
