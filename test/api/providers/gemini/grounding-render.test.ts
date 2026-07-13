import { describe, test, expect } from 'vitest';
import {
	renderGroundingSources,
	escapeHtml,
	safeExternalUrl,
	type RenderableGroundingSource,
} from '../../../../src/api/providers/gemini/grounding-render';

describe('grounding-render: shared search-grounding renderer', () => {
	test('no sources -> empty string', () => {
		expect(renderGroundingSources([])).toBe('');
	});

	test('renders the search-grounding block with escaped, rel-guarded links', () => {
		const html = renderGroundingSources([
			{ url: 'https://a.example/paris', title: 'Paris' },
			{ url: 'https://b.example/france', title: 'France' },
		]);
		expect(html).toContain('<div class="search-grounding">');
		expect(html).toContain('<h4>Sources:</h4>');
		expect(html).toContain('<a href="https://a.example/paris" target="_blank" rel="noopener noreferrer">Paris</a>');
		expect(html).toContain('<a href="https://b.example/france" target="_blank" rel="noopener noreferrer">France</a>');
		expect(html.match(/<li>/g)).toHaveLength(2);
	});

	test('missing title falls back to the URL as the label', () => {
		const html = renderGroundingSources([{ url: 'https://no-title.example' }]);
		expect(html).toContain(
			'<a href="https://no-title.example" target="_blank" rel="noopener noreferrer">https://no-title.example</a>'
		);
	});

	describe('HTML-safety contract (untrusted grounding metadata)', () => {
		test('neutralizes a javascript: scheme in the href', () => {
			const html = renderGroundingSources([{ url: 'javascript:alert(1)', title: 'Click me' }]);
			expect(html).toContain('href="#"');
			expect(html).not.toContain('javascript:alert(1)');
		});

		test('neutralizes a data: scheme in the href', () => {
			const html = renderGroundingSources([{ url: 'data:text/html,<script>alert(1)</script>' }]);
			expect(html).toContain('href="#"');
			expect(html).not.toContain('<script>');
		});

		test('escapes an HTML-injecting title so no live markup is emitted', () => {
			const html = renderGroundingSources([{ url: 'https://evil.example', title: '"><img src=x onerror=alert(1)>' }]);
			expect(html).not.toContain('<img');
			expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
			// The closing-quote break-out is escaped, keeping the href attribute intact.
			expect(html).toContain('&quot;&gt;');
		});

		test('escapes a break-out attempt in the url when it is also the label', () => {
			// A non-http(s) url is neutralized to '#', and the raw string is never
			// echoed into the label unescaped.
			const html = renderGroundingSources([{ url: 'javascript:"><script>alert(1)</script>' }]);
			expect(html).toContain('href="#"');
			expect(html).not.toContain('<script>');
			expect(html).toContain('&lt;script&gt;');
		});
	});

	describe('cross-transport parity', () => {
		// Both the generateContent path (client.ts) and the Interactions path
		// (interactions-mapper.ts) now feed the same normalized shape into this
		// renderer, so identical sources must render identically regardless of
		// which transport produced them.
		test('same sources render byte-for-byte identically', () => {
			const sources: RenderableGroundingSource[] = [
				{ url: 'https://x.example', title: 'X' },
				{ url: 'https://y.example' },
			];
			// Two independent calls simulate the two call sites mapping their own
			// metadata into the shared shape.
			const fromGenerateContent = renderGroundingSources(sources.map((s) => ({ url: s.url, title: s.title })));
			const fromInteractions = renderGroundingSources(sources.map((s) => ({ url: s.url, title: s.title })));
			expect(fromGenerateContent).toBe(fromInteractions);
		});
	});
});

describe('grounding-render helpers', () => {
	test('escapeHtml escapes all five significant characters', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
	});

	test('safeExternalUrl passes http(s) through unchanged and rejects other schemes', () => {
		expect(safeExternalUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
		expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
		expect(safeExternalUrl('javascript:alert(1)')).toBe('#');
		expect(safeExternalUrl('data:text/html,x')).toBe('#');
		expect(safeExternalUrl('not a url')).toBe('#');
	});
});
