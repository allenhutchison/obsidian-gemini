import type { Mock } from 'vitest';
import { WebFetchTool } from '../../src/tools/web-fetch-tool';
import { ToolExecutionContext } from '../../src/tools/types';
import { GoogleGenAI } from '@google/genai';

// Mock Google Gen AI
vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn(),
}));

vi.mock('../../src/utils/retry', async () => {
	const actual = await vi.importActual<any>('../../src/utils/retry');
	return {
		...actual,
		executeWithRetry: vi.fn().mockImplementation((operation, _config, options) => {
			const zeroConfig = {
				maxRetries: 0,
				initialDelayMs: 1,
				maxDelayMs: 1,
				jitter: false,
			};
			return actual.executeWithRetry(operation, zeroConfig, options);
		}),
	};
});

// Mock proxy-fetch
vi.mock('../../src/utils/proxy-fetch', () => ({
	requestUrlWithRetry: vi.fn(),
}));

import { requestUrlWithRetry } from '../../src/utils/proxy-fetch';

describe('WebFetchTool', () => {
	let tool: WebFetchTool;
	let mockContext: ToolExecutionContext;
	let mockGenAI: any;

	beforeEach(() => {
		vi.clearAllMocks();

		tool = new WebFetchTool();

		mockGenAI = {
			models: {
				generateContent: vi.fn(),
			},
		};

		(GoogleGenAI as Mock).mockImplementation(function () {
			return mockGenAI;
		});

		mockContext = {
			plugin: {
				apiKey: 'test-api-key',
				settings: {
					chatModelName: 'gemini-2.5-flash',
					temperature: 0.7,
				},
				logger: {
					log: vi.fn(),
					debug: vi.fn(),
					error: vi.fn(),
					warn: vi.fn(),
				},
			},
			session: {
				id: 'test-session',
				type: 'agent-session',
				context: {
					contextFiles: [],
					contextDepth: 2,
					enabledTools: [],
					requireConfirmation: [],
				},
			},
		} as any;
	});

	describe('basic properties', () => {
		it('should have correct name and category', () => {
			expect(tool.name).toBe('fetch_url');
			expect(tool.category).toBe('read_only');
		});

		it('should require url and query parameters', () => {
			expect(tool.parameters.required).toEqual(['url', 'query']);
		});
	});

	describe('fallback HTML-to-markdown conversion', () => {
		// Helper to trigger the fallback path: primary URL context fails, then fallback uses requestUrlWithRetry
		async function executeFallbackWithHtml(html: string): Promise<any> {
			// Make primary method fail so fallback is triggered
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('URL context failed')).mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [{ text: 'Analysis result' }],
						},
					},
				],
			});

			(requestUrlWithRetry as Mock).mockResolvedValue({
				status: 200,
				text: html,
			});

			return tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);
		}

		it('should convert HTML to markdown using turndown', async () => {
			const html = `
        <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Hello World</h1>
          <p>This is a <strong>test</strong> paragraph.</p>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			// Verify the prompt sent to Gemini contains markdown, not HTML tags
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Hello World');
			expect(fallbackPrompt).toContain('**test**');
			expect(fallbackPrompt).not.toContain('<h1>');
			expect(fallbackPrompt).not.toContain('<strong>');
		});

		it('should strip script tags completely', async () => {
			const html = `
        <html>
        <head><title>Page</title></head>
        <body>
          <p>Safe content</p>
          <script>alert('xss')</script>
          <script type="text/javascript">
            document.cookie = 'stolen';
          </script>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Safe content');
			expect(fallbackPrompt).not.toContain('alert');
			expect(fallbackPrompt).not.toContain('document.cookie');
			expect(fallbackPrompt).not.toContain('<script');
		});

		it('should strip style tags completely', async () => {
			const html = `
        <html>
        <head>
          <title>Page</title>
          <style>body { background: red; }</style>
        </head>
        <body>
          <p>Visible content</p>
          <style>.hidden { display: none; }</style>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Visible content');
			expect(fallbackPrompt).not.toContain('background: red');
			expect(fallbackPrompt).not.toContain('display: none');
		});

		it('should strip noscript tags', async () => {
			const html = `
        <html>
        <head><title>Page</title></head>
        <body>
          <p>Main content</p>
          <noscript>Please enable JavaScript</noscript>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Main content');
			expect(fallbackPrompt).not.toContain('enable JavaScript');
		});

		it('should decode HTML entities in the title', async () => {
			const html = `
        <html>
        <head><title>Tom &amp; Jerry&#39;s &quot;Adventure&quot;</title></head>
        <body><p>Content</p></body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Tom & Jerry\'s "Adventure"');
		});

		it('should preserve link URLs in markdown format', async () => {
			const html = `
        <html>
        <head><title>Links</title></head>
        <body>
          <p>Visit <a href="https://example.com">Example Site</a> for more.</p>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('[Example Site](https://example.com)');
		});

		it('should convert lists to markdown', async () => {
			const html = `
        <html>
        <head><title>Lists</title></head>
        <body>
          <ul>
            <li>Item one</li>
            <li>Item two</li>
            <li>Item three</li>
          </ul>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Item one');
			expect(fallbackPrompt).toContain('Item two');
			expect(fallbackPrompt).toContain('Item three');
		});

		it('should truncate content exceeding 10000 characters', async () => {
			const longContent = 'x'.repeat(200);
			// Build HTML with many paragraphs to exceed 10000 chars after conversion
			const paragraphs = Array(100).fill(`<p>${longContent}</p>`).join('\n');
			const html = `
        <html>
        <head><title>Long</title></head>
        <body>${paragraphs}</body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('[Content truncated...]');
		});

		it('should handle malformed HTML gracefully', async () => {
			const html = `
        <html>
        <head><title>Broken</title>
        <body>
          <p>Unclosed paragraph
          <div>Nested <span>content</div></span>
          <p>More text</p>
        </body>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Unclosed paragraph');
			expect(fallbackPrompt).toContain('More text');
		});

		it('should handle event handler attributes safely', async () => {
			const html = `
        <html>
        <head><title>XSS</title></head>
        <body>
          <img onerror="alert('xss')" src="x">
          <div onmouseover="steal()">Hover me</div>
          <p>Safe text</p>
        </body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).not.toContain('onerror');
			expect(fallbackPrompt).not.toContain('onmouseover');
			expect(fallbackPrompt).not.toContain('alert');
			expect(fallbackPrompt).not.toContain('steal()');
			expect(fallbackPrompt).toContain('Safe text');
		});

		it('should use URL as title when no title tag exists', async () => {
			const html = `
        <html>
        <body><p>No title here</p></body>
        </html>
      `;

			const result = await executeFallbackWithHtml(html);

			expect(result.success).toBe(true);
			const fallbackPrompt = mockGenAI.models.generateContent.mock.calls[1][0].contents;
			expect(fallbackPrompt).toContain('Web Page Title: https://example.com');
		});
	});

	describe('execute - primary path', () => {
		it('should return error when API key is missing', async () => {
			(mockContext.plugin as any).apiKey = '';

			const result = await tool.execute({ url: 'https://example.com', query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('API key not configured');
		});

		it('should reject non-HTTP URLs', async () => {
			const result = await tool.execute({ url: 'ftp://example.com/file', query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Only HTTP and HTTPS URLs are supported');
		});
	});

	describe('execute - successful primary URL context fetch', () => {
		it('should return success with urlsRetrieved data when URL context succeeds', async () => {
			mockGenAI.models.generateContent.mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [{ text: 'Analyzed content from the page' }],
						},
						urlContextMetadata: {
							urlMetadata: [
								{
									retrievedUrl: 'https://example.com',
									urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
								},
							],
						},
					},
				],
			});

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.content).toBe('Analyzed content from the page');
			expect(result.data.url).toBe('https://example.com');
			expect(result.data.query).toBe('summarize');
			expect(result.data.urlsRetrieved).toEqual([
				{ url: 'https://example.com', status: 'URL_RETRIEVAL_STATUS_SUCCESS' },
			]);
			expect(result.data.fetchedAt).toBeDefined();
		});
	});

	describe('execute - URL retrieval failure triggers fallback', () => {
		async function setupFallbackFromUrlStatus(status: string): Promise<any> {
			// Primary returns text but with a failed URL retrieval status
			mockGenAI.models.generateContent.mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [{ text: 'Some text' }],
						},
						urlContextMetadata: {
							urlMetadata: [
								{
									retrievedUrl: 'https://example.com',
									urlRetrievalStatus: status,
								},
							],
						},
					},
				],
			});

			// Fallback fetch
			(requestUrlWithRetry as Mock).mockResolvedValueOnce({
				status: 200,
				text: '<html><head><title>Test</title></head><body><p>Fallback content</p></body></html>',
			});

			// Fallback Gemini analysis
			mockGenAI.models.generateContent.mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [{ text: 'Fallback analysis result' }],
						},
					},
				],
			});

			return tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);
		}

		it('should fallback when URL_RETRIEVAL_STATUS_ERROR', async () => {
			const result = await setupFallbackFromUrlStatus('URL_RETRIEVAL_STATUS_ERROR');

			expect(result.success).toBe(true);
			expect(result.data.fallbackMethod).toBe(true);
			expect(requestUrlWithRetry).toHaveBeenCalled();
		});

		it('should fallback when URL_RETRIEVAL_STATUS_ACCESS_DENIED', async () => {
			const result = await setupFallbackFromUrlStatus('URL_RETRIEVAL_STATUS_ACCESS_DENIED');

			expect(result.success).toBe(true);
			expect(result.data.fallbackMethod).toBe(true);
			expect(requestUrlWithRetry).toHaveBeenCalled();
		});

		it('should fallback when URL_RETRIEVAL_STATUS_NOT_FOUND', async () => {
			const result = await setupFallbackFromUrlStatus('URL_RETRIEVAL_STATUS_NOT_FOUND');

			expect(result.success).toBe(true);
			expect(result.data.fallbackMethod).toBe(true);
			expect(requestUrlWithRetry).toHaveBeenCalled();
		});
	});

	describe('execute - empty text from primary response', () => {
		it('should return error when primary returns no text', async () => {
			mockGenAI.models.generateContent.mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [],
						},
					},
				],
			});

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('No response generated from URL content');
		});

		it('should return error when candidates have no content parts', async () => {
			mockGenAI.models.generateContent.mockResolvedValueOnce({
				candidates: [{}],
			});

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('No response generated from URL content');
		});
	});

	describe('execute - error classification', () => {
		it('should classify 404 errors', async () => {
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('Resource not found 404'));

			const result = await tool.execute({ url: 'https://example.com', query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('URL not found (404)');
		});

		it('should classify 403 errors', async () => {
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('Forbidden 403'));

			const result = await tool.execute({ url: 'https://example.com', query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Access forbidden to this URL (403)');
		});

		it('should classify quota errors', async () => {
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('API quota exceeded'));

			const result = await tool.execute({ url: 'https://example.com', query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('API quota exceeded');
		});

		it('should classify TypeError for invalid URL', async () => {
			mockGenAI.models.generateContent.mockRejectedValueOnce(new TypeError("Failed to construct 'URL': Invalid URL"));

			const result = await tool.execute({ url: 'https://example.com', query: 'test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Invalid URL format: https://example.com');
		});
	});

	describe('execute - generic error with fallback', () => {
		it('should succeed via fallback when primary throws generic error', async () => {
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('Unknown server error')).mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [{ text: 'Fallback analysis' }],
						},
					},
				],
			});

			(requestUrlWithRetry as Mock).mockResolvedValueOnce({
				status: 200,
				text: '<html><head><title>Page</title></head><body><p>Content</p></body></html>',
			});

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.fallbackMethod).toBe(true);
		});

		it('should return fallback error when both primary and fallback fail', async () => {
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('Primary failure'));

			// Fallback requestUrlWithRetry also fails — fallbackFetch catches it and returns error
			(requestUrlWithRetry as Mock).mockRejectedValueOnce(new Error('Fallback failure'));

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Fallback fetch failed');
			expect(result.error).toContain('Fallback failure');
		});
	});

	describe('execute - fallback path edge cases', () => {
		it('should return error on fallback HTTP non-200 status', async () => {
			// Make primary fail to trigger fallback
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('Primary error'));

			(requestUrlWithRetry as Mock).mockResolvedValueOnce({
				status: 503,
				text: 'Service Unavailable',
			});

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('HTTP 503');
		});

		it('should return error when fallback analysis returns empty text', async () => {
			// Make primary fail to trigger fallback
			mockGenAI.models.generateContent.mockRejectedValueOnce(new Error('Primary error')).mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [],
						},
					},
				],
			});

			(requestUrlWithRetry as Mock).mockResolvedValueOnce({
				status: 200,
				text: '<html><head><title>Test</title></head><body><p>Content</p></body></html>',
			});

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('No analysis generated from page content');
		});

		it('should return fallback fetch failed error when requestUrlWithRetry throws', async () => {
			// Make primary fail with URL retrieval status to trigger fallback
			mockGenAI.models.generateContent.mockResolvedValueOnce({
				candidates: [
					{
						content: {
							parts: [{ text: 'Some text' }],
						},
						urlContextMetadata: {
							urlMetadata: [
								{
									retrievedUrl: 'https://example.com',
									urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_ERROR',
								},
							],
						},
					},
				],
			});

			(requestUrlWithRetry as Mock).mockRejectedValueOnce(new Error('Network timeout'));

			const result = await tool.execute({ url: 'https://example.com', query: 'summarize' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Fallback fetch failed');
			expect(result.error).toContain('Network timeout');
		});
	});

	describe('getProgressDescription', () => {
		it('should extract domain from valid URL', () => {
			const desc = tool.getProgressDescription({ url: 'https://www.example.com/path/to/page' });
			expect(desc).toBe('Fetching from example.com');
		});

		it('should return generic message for invalid URL', () => {
			const desc = tool.getProgressDescription({ url: 'not-a-url' });
			expect(desc).toBe('Fetching web page');
		});

		it('should return generic message when url is empty', () => {
			const desc = tool.getProgressDescription({ url: '' });
			expect(desc).toBe('Fetching web page');
		});
	});
});
