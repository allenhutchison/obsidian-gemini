import { WebFetchTool } from './web-fetch-tool';
import { ToolExecutionContext } from './types';
import { GoogleGenAI } from '@google/genai';

// Mock Google Gen AI
jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn(),
}));

// Mock proxy-fetch
jest.mock('../utils/proxy-fetch', () => ({
	requestUrlWithRetry: jest.fn(),
}));

import { requestUrlWithRetry } from '../utils/proxy-fetch';

describe('WebFetchTool', () => {
	let tool: WebFetchTool;
	let mockContext: ToolExecutionContext;
	let mockGenAI: any;

	beforeEach(() => {
		jest.clearAllMocks();

		tool = new WebFetchTool();

		mockGenAI = {
			models: {
				generateContent: jest.fn(),
			},
		};

		(GoogleGenAI as jest.Mock).mockImplementation(() => mockGenAI);

		mockContext = {
			plugin: {
				settings: {
					apiKey: 'test-api-key',
					chatModelName: 'gemini-2.5-flash',
					temperature: 0.7,
				},
				logger: {
					log: jest.fn(),
					debug: jest.fn(),
					error: jest.fn(),
					warn: jest.fn(),
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

			(requestUrlWithRetry as jest.Mock).mockResolvedValue({
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
			(mockContext.plugin as any).settings.apiKey = '';

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
});
