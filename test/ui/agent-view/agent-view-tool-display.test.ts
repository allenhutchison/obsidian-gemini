import { AgentViewToolDisplay } from '../../../src/ui/agent-view/agent-view-tool-display';
import type { ToolResult } from '../../../src/tools/types';

// The obsidian alias (see vitest.config.ts) resolves `obsidian` to __mocks__/obsidian.js,
// which stubs setIcon as a no-op and exports TFile. The renderer under test dispatches on
// the *runtime shape* of a tool result through a set of module-private type guards
// (isCitationAnswerResult / isGeneratedImageResult / isFileContentResult); these tests pin
// that dispatch through the public showToolResult render path so they survive helper
// reshuffling, rather than reaching into the private guards directly.

/**
 * Add the Obsidian DOM sugar (createDiv/createEl/createSpan/addClass/removeClass/hasClass/
 * empty/appendText) that jsdom lacks. The global vitest setup already patches
 * hide/show/toggle/toggleClass onto HTMLElement.prototype; the element-factory helpers with
 * cls/text/attr options stay per-test, mirroring test/ui/agent-view/agent-view-progress.test.ts.
 */
function addObsidianMethods(el: HTMLElement): HTMLElement {
	const anyEl = el as any;
	anyEl.createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text !== undefined) elem.textContent = opts.text;
		if (opts?.href) (elem as HTMLAnchorElement).href = opts.href;
		if (opts?.attr) {
			for (const [key, val] of Object.entries(opts.attr)) {
				elem.setAttribute(key, val as string);
			}
		}
		addObsidianMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	anyEl.createDiv = function (opts?: any) {
		return this.createEl('div', opts);
	};
	anyEl.createSpan = function (opts?: any) {
		return this.createEl('span', opts);
	};
	anyEl.addClass = function (cls: string) {
		this.classList.add(cls);
	};
	anyEl.removeClass = function (cls: string) {
		this.classList.remove(cls);
	};
	anyEl.hasClass = function (cls: string) {
		return this.classList.contains(cls);
	};
	anyEl.empty = function () {
		this.innerHTML = '';
	};
	anyEl.appendText = function (text: string) {
		this.appendChild(document.createTextNode(text));
	};
	return el;
}

describe('AgentViewToolDisplay', () => {
	let container: HTMLElement;
	let display: AgentViewToolDisplay;
	let plugin: any;
	let execCounter = 0;

	beforeEach(() => {
		document.body.innerHTML = '';
		container = addObsidianMethods(document.createElement('div'));
		document.body.appendChild(container);

		plugin = {
			logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
			toolRegistry: { getTool: vi.fn().mockReturnValue({ displayName: 'Tool' }) },
			app: {
				vault: {
					// Null keeps the generate_image branch on its "no TFile" path so the test
					// doesn't depend on resource-path plumbing; the branch is still chosen.
					getAbstractFileByPath: vi.fn().mockReturnValue(null),
					getResourcePath: vi.fn().mockReturnValue('app://resource'),
				},
			},
		};

		display = new AgentViewToolDisplay(container, plugin);
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	/**
	 * Render a tool result through the full public path (create the row, then feed the
	 * result) and return the row's details element that holds the rendered output.
	 */
	async function renderResult(toolName: string, result: ToolResult): Promise<HTMLElement> {
		const executionId = `exec-${++execCounter}`;
		await display.showToolExecution(toolName, {}, executionId);
		await display.showToolResult(toolName, result, executionId);
		const details = container.querySelector('.gemini-tool-row-details') as HTMLElement;
		expect(details).toBeTruthy();
		return details;
	}

	describe('citation-answer dispatch (isCitationAnswerResult)', () => {
		it('renders the search-answer + citations branch for a well-formed google_search result', async () => {
			const details = await renderResult('google_search', {
				success: true,
				data: {
					answer: 'The capital is [Paris](https://example.com/paris).',
					citations: [{ title: 'Paris', url: 'https://example.com/paris', snippet: 'A city.' }],
				},
			});

			expect(details.querySelector('.gemini-agent-tool-search-answer')).toBeTruthy();
			const citations = details.querySelector('.gemini-agent-tool-citations');
			expect(citations).toBeTruthy();
			// The markdown link in the answer becomes a real anchor.
			const answerLink = details.querySelector('.gemini-agent-tool-search-answer a') as HTMLAnchorElement;
			expect(answerLink?.textContent).toBe('Paris');
			expect(answerLink?.getAttribute('href')).toBe('https://example.com/paris');
			// It is NOT the generic object fallback.
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeFalsy();
		});

		it('falls back to the generic object branch when the toolName is not a search tool', async () => {
			// Citation-shaped payload, but read_file is not a search tool: the toolName gate
			// keeps it out of the citation branch.
			const details = await renderResult('read_file', {
				success: true,
				data: { answer: 'hi', citations: [{ url: 'https://example.com' }] },
			});

			expect(details.querySelector('.gemini-agent-tool-search-answer')).toBeFalsy();
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeTruthy();
		});

		it('falls back to the generic object branch for a near-miss shape (citations not an array)', async () => {
			const details = await renderResult('google_search', {
				success: true,
				data: { answer: 'hi', citations: 'not-an-array' },
			});

			expect(details.querySelector('.gemini-agent-tool-search-answer')).toBeFalsy();
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeTruthy();
		});
	});

	describe('generated-image dispatch (isGeneratedImageResult)', () => {
		it('renders the image-result branch for a well-formed generate_image result', async () => {
			const details = await renderResult('generate_image', {
				success: true,
				data: { path: 'images/out.png', wikilink: '![[images/out.png]]', prompt: 'a cat' },
			});

			expect(details.querySelector('.gemini-agent-tool-image-result')).toBeTruthy();
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeFalsy();
		});

		it('falls back to the generic object branch for a near-miss shape (missing wikilink)', async () => {
			const details = await renderResult('generate_image', {
				success: true,
				data: { path: 'images/out.png' },
			});

			expect(details.querySelector('.gemini-agent-tool-image-result')).toBeFalsy();
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeTruthy();
		});
	});

	describe('file-content dispatch (isFileContentResult)', () => {
		it('renders the file-info branch plus code for a well-formed read_file result', async () => {
			const details = await renderResult('read_file', {
				success: true,
				data: { content: 'file body', path: 'notes/todo.md', size: 1234 },
			});

			expect(details.querySelector('.gemini-agent-tool-file-info')).toBeTruthy();
			expect(details.querySelector('.gemini-agent-tool-code-result')).toBeTruthy();
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeFalsy();
		});

		it('falls back to the generic object branch for a near-miss shape (missing path)', async () => {
			const details = await renderResult('read_file', {
				success: true,
				data: { content: 'file body' },
			});

			expect(details.querySelector('.gemini-agent-tool-file-info')).toBeFalsy();
			expect(details.querySelector('.gemini-agent-tool-result-object')).toBeTruthy();
		});
	});

	describe('generic object fallback', () => {
		it('renders key/value items for a record matching no guard', async () => {
			const details = await renderResult('some_tool', {
				success: true,
				data: { foo: 'bar', count: 3 },
			});

			const object = details.querySelector('.gemini-agent-tool-result-object');
			expect(object).toBeTruthy();
			expect(object?.querySelectorAll('.gemini-agent-tool-result-item').length).toBe(2);
		});
	});

	describe('renderTruncatableCode (via string result data)', () => {
		it('renders short string data inline with no expand button', async () => {
			const details = await renderResult('some_tool', { success: true, data: 'short output' });

			const code = details.querySelector('.gemini-agent-tool-code-result code') as HTMLElement;
			expect(code).toBeTruthy();
			expect(code.textContent).toBe('short output');
			expect(details.querySelector('.gemini-agent-tool-expand-content')).toBeFalsy();
		});

		it('truncates over-threshold string data and expands to full text on click', async () => {
			const longText = 'A'.repeat(600);
			const details = await renderResult('some_tool', { success: true, data: longText });

			const code = details.querySelector('.gemini-agent-tool-code-result code') as HTMLElement;
			const expandBtn = details.querySelector('.gemini-agent-tool-expand-content') as HTMLButtonElement;
			expect(expandBtn).toBeTruthy();
			// Truncated: shorter than the full text and does not contain all 600 chars.
			expect(code.textContent.length).toBeLessThan(longText.length);

			expandBtn.click();

			expect(code.textContent).toBe(longText);
			expect(details.querySelector('.gemini-agent-tool-expand-content')).toBeFalsy();
		});
	});

	describe('array and error results', () => {
		it('renders array data as a list', async () => {
			const details = await renderResult('list_files', { success: true, data: ['a.md', 'b.md', 'c.md'] });

			const list = details.querySelector('.gemini-agent-tool-result-list');
			expect(list).toBeTruthy();
			expect(list?.querySelectorAll('li').length).toBe(3);
		});

		it('renders the error branch for a failed result', async () => {
			const details = await renderResult('write_file', { success: false, error: 'permission denied' });

			const errorContent = details.querySelector('.gemini-agent-tool-error-content');
			expect(errorContent).toBeTruthy();
			expect(errorContent?.querySelector('.gemini-agent-tool-error-message')?.textContent).toBe('permission denied');
			// Failed rows auto-expand their details.
			const row = container.querySelector('.gemini-tool-row') as HTMLElement;
			expect(row.classList.contains('gemini-tool-row-expanded')).toBe(true);
		});
	});
});
