import { AgentViewProgress } from '../../../src/ui/agent-view/agent-view-progress';
import { MarkdownRenderer as MarkdownRendererBase } from 'obsidian';
// MarkdownRenderer.render is replaced with a vi.fn() by the obsidian mock below;
// cast to any so TS lets us call mockImplementationOnce/mock.calls on it.
const MarkdownRenderer = MarkdownRendererBase as unknown as { render: any };

// Mock the ChatTimer
vi.mock('../../../src/utils/timer-utils', () => ({
	ChatTimer: vi.fn().mockImplementation(function () {
		return {
			start: vi.fn(),
			stop: vi.fn(),
			isRunning: vi.fn().mockReturnValue(false),
		};
	}),
}));

// Mock Obsidian MarkdownRenderer
vi.mock('obsidian', async () => {
	const mock = await vi.importActual<any>('../../../__mocks__/obsidian.js');
	return {
		...mock,
		MarkdownRenderer: {
			render: vi.fn().mockImplementation((_app: any, markdown: string, el: HTMLElement) => {
				// Simulate basic markdown rendering
				const p = document.createElement('p');
				p.textContent = markdown;
				el.appendChild(p);
				return Promise.resolve();
			}),
		},
	};
});

// Helper to add Obsidian createDiv/createEl/createSpan/addClass/removeClass methods to a DOM element
function addObsidianMethods(el: HTMLElement): HTMLElement {
	(el as any).createDiv = function (opts?: any) {
		const div = document.createElement('div');
		if (opts?.cls) div.className = opts.cls;
		if (opts?.text) div.textContent = opts.text;
		addObsidianMethods(div);
		this.appendChild(div);
		return div;
	};
	(el as any).createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text) elem.textContent = opts.text;
		if (opts?.attr) {
			for (const [key, val] of Object.entries(opts.attr)) {
				elem.setAttribute(key, val as string);
			}
		}
		addObsidianMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	(el as any).createSpan = function (opts?: any) {
		return (this as any).createEl('span', opts);
	};
	(el as any).addClass = function (cls: string) {
		this.classList.add(cls);
	};
	(el as any).removeClass = function (cls: string) {
		this.classList.remove(cls);
	};
	(el as any).hasClass = function (cls: string) {
		return this.classList.contains(cls);
	};
	(el as any).empty = function () {
		this.innerHTML = '';
	};
	return el;
}

describe('AgentViewProgress', () => {
	let progress: AgentViewProgress;
	let container: HTMLElement;

	// Mock App and Component for MarkdownRenderer
	const mockApp = {} as any;
	const mockComponent = {} as any;

	beforeEach(() => {
		document.body.innerHTML = '';
		container = addObsidianMethods(document.createElement('div'));
		document.body.appendChild(container);

		progress = new AgentViewProgress(mockApp, mockComponent);
		progress.createProgressBar(container);
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	describe('createProgressBar', () => {
		it('should create correct DOM structure', () => {
			expect(container.querySelector('.gemini-agent-progress-bar-wrapper')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-progress-bar')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-progress-fill')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-progress-status-container')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-progress-status-text')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-progress-timer')).toBeTruthy();
		});

		it('should create thinking section elements', () => {
			expect(container.querySelector('.gemini-agent-thinking-chevron')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-thinking-section')).toBeTruthy();
			expect(container.querySelector('.gemini-agent-thinking-content')).toBeTruthy();
		});

		it('should be hidden by default', () => {
			expect(container.style.display).toBe('none');
		});

		it('should have thinking chevron hidden by default', () => {
			const chevron = container.querySelector('.gemini-agent-thinking-chevron') as HTMLElement;
			expect(chevron.style.display).toBe('none');
		});

		it('should have thinking section hidden by default', () => {
			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('none');
		});
	});

	describe('show/hide', () => {
		it('should make container visible when shown', () => {
			progress.show('Thinking...', 'thinking');
			expect(container.style.display).toBe('block');
		});

		it('should hide container', () => {
			progress.show('Thinking...', 'thinking');
			progress.hide();
			expect(container.style.display).toBe('none');
		});

		it('should set status text when shown', () => {
			progress.show('Thinking...', 'thinking');
			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).toBe('Thinking...');
		});

		it('should apply state class to progress fill', () => {
			progress.show('Thinking...', 'thinking');
			const fill = container.querySelector('.gemini-agent-progress-fill');
			expect(fill?.classList.contains('gemini-agent-progress-thinking')).toBe(true);
		});

		it('should apply different state classes', () => {
			progress.show('Executing tool...', 'tool');
			const fill = container.querySelector('.gemini-agent-progress-fill');
			expect(fill?.classList.contains('gemini-agent-progress-tool')).toBe(true);
		});
	});

	describe('update', () => {
		it('should update status text', () => {
			progress.show('Thinking...', 'thinking');
			progress.update('Processing...', 'waiting');

			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).toBe('Processing...');
		});

		it('should update state class when provided', () => {
			progress.show('Thinking...', 'thinking');
			progress.update('Streaming...', 'streaming');

			const fill = container.querySelector('.gemini-agent-progress-fill');
			expect(fill?.classList.contains('gemini-agent-progress-streaming')).toBe(true);
			expect(fill?.classList.contains('gemini-agent-progress-thinking')).toBe(false);
		});

		it('should not update when hidden', () => {
			progress.update('Should not appear');
			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).toBe('');
		});

		it('should format bold markdown', () => {
			progress.show('Starting...', 'thinking');
			progress.update('**Bold text** here');

			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).toContain('<strong>Bold text</strong>');
		});
	});

	describe('updateThought', () => {
		it('should show thinking chevron when thought arrives', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('I need to consider...');

			const chevron = container.querySelector('.gemini-agent-thinking-chevron') as HTMLElement;
			expect(chevron.style.display).toBe('');
		});

		it('should make status row clickable when thought arrives', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('I need to consider...');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container');
			expect(statusContainer?.classList.contains('gemini-agent-progress-clickable')).toBe(true);
		});

		it('should update status text with truncated preview', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Short thought');

			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).toContain('Short thought');
		});

		it('should truncate long thoughts in status text', () => {
			progress.show('Thinking...', 'thinking');
			const longThought = 'A'.repeat(200);
			progress.updateThought(longThought);

			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			const content = statusText?.innerHTML || '';
			// Should start with ... indicating truncation
			expect(content.startsWith('...')).toBe(true);
			// Should not contain the full text
			expect(content.length).toBeLessThan(200);
		});

		it('should render content in expandable section using MarkdownRenderer', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('**bold** thought');

			expect(MarkdownRenderer.render).toHaveBeenCalledWith(
				mockApp,
				'**bold** thought',
				expect.any(HTMLElement),
				'',
				mockComponent
			);
		});

		it('should not update when hidden', () => {
			progress.updateThought('Should not appear');

			const chevron = container.querySelector('.gemini-agent-thinking-chevron') as HTMLElement;
			expect(chevron.style.display).toBe('none');
		});
	});

	describe('thinking section toggle via status row click', () => {
		it('should expand when status row is clicked', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.click();

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('block');

			const chevron = container.querySelector('.gemini-agent-thinking-chevron');
			expect(chevron?.classList.contains('gemini-agent-thinking-chevron-expanded')).toBe(true);

			expect(statusContainer.getAttribute('aria-expanded')).toBe('true');
		});

		it('should collapse when status row is clicked again', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.click(); // expand
			statusContainer.click(); // collapse

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('none');

			const chevron = container.querySelector('.gemini-agent-thinking-chevron');
			expect(chevron?.classList.contains('gemini-agent-thinking-chevron-expanded')).toBe(false);

			expect(statusContainer.getAttribute('aria-expanded')).toBe('false');
		});

		it('should not expand when clicked without thinking content', () => {
			progress.show('Thinking...', 'thinking');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.click();

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('none');
		});

		it('should reset thinking section on hide', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.click(); // expand

			progress.hide();

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('none');

			const chevron = container.querySelector('.gemini-agent-thinking-chevron') as HTMLElement;
			expect(chevron.style.display).toBe('none');

			expect(statusContainer.classList.contains('gemini-agent-progress-clickable')).toBe(false);
			expect(statusContainer.getAttribute('tabindex')).toBeNull();
			expect(statusContainer.getAttribute('role')).toBeNull();
			expect(statusContainer.getAttribute('aria-expanded')).toBeNull();
		});
	});

	describe('keyboard accessibility', () => {
		it('should set tabindex and role when thinking content arrives', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			expect(statusContainer.getAttribute('tabindex')).toBe('0');
			expect(statusContainer.getAttribute('role')).toBe('button');
		});

		it('should expand when Enter key is pressed', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('block');
		});

		it('should expand when Space key is pressed', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('block');
		});

		it('should not toggle on other keys', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('none');
		});

		it('should not toggle via keyboard without thinking content', () => {
			progress.show('Thinking...', 'thinking');

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			statusContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

			const section = container.querySelector('.gemini-agent-thinking-section') as HTMLElement;
			expect(section.style.display).toBe('none');
		});

		it('should remove tabindex and role on hide', () => {
			progress.show('Thinking...', 'thinking');
			progress.updateThought('Some thought');
			progress.hide();

			const statusContainer = container.querySelector('.gemini-agent-progress-status-container') as HTMLElement;
			expect(statusContainer.getAttribute('tabindex')).toBeNull();
			expect(statusContainer.getAttribute('role')).toBeNull();
		});
	});

	describe('async render versioning', () => {
		it('should discard stale renders when newer thought arrives', async () => {
			// Make render resolve slowly for first call, instantly for second
			let resolveFirst: () => void;
			const firstRenderPromise = new Promise<void>((resolve) => {
				resolveFirst = resolve;
			});

			MarkdownRenderer.render
				.mockImplementationOnce((_app: any, _md: string, el: HTMLElement) => {
					// First render - slow, will be stale
					return firstRenderPromise.then(() => {
						const p = document.createElement('p');
						p.textContent = 'stale content';
						el.appendChild(p);
					});
				})
				.mockImplementationOnce((_app: any, markdown: string, el: HTMLElement) => {
					// Second render - immediate
					const p = document.createElement('p');
					p.textContent = markdown;
					el.appendChild(p);
					return Promise.resolve();
				});

			progress.show('Thinking...', 'thinking');

			// Fire first thought update (will be slow)
			progress.updateThought('First thought');

			// Fire second thought update immediately (will supersede first)
			progress.updateThought('Second thought');

			// Let the slow first render complete
			resolveFirst!();
			await firstRenderPromise;

			// Wait for microtasks to settle
			await new Promise((resolve) => setTimeout(resolve, 0));

			// The second render should win — verify no stale content leaked through
			const content = container.querySelector('.gemini-agent-thinking-content');
			expect(content?.textContent).not.toContain('stale content');
			expect(content?.textContent).toContain('Second thought');
		});
	});

	describe('isVisible', () => {
		it('should return false when hidden', () => {
			expect(progress.isVisible()).toBe(false);
		});

		it('should return true when shown', () => {
			progress.show('Test', 'thinking');
			expect(progress.isVisible()).toBe(true);
		});

		it('should return false after hide', () => {
			progress.show('Test', 'thinking');
			progress.hide();
			expect(progress.isVisible()).toBe(false);
		});
	});

	describe('XSS prevention', () => {
		it('should escape HTML in status text', () => {
			progress.show('Starting...', 'thinking');
			progress.update('<script>alert("xss")</script>');

			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).not.toContain('<script>');
			expect(statusText?.innerHTML).toContain('&lt;script&gt;');
		});

		it('should escape HTML in thought text preview', () => {
			progress.show('Starting...', 'thinking');
			progress.updateThought('<img onerror="alert(1)" src="">');

			const statusText = container.querySelector('.gemini-agent-progress-status-text');
			expect(statusText?.innerHTML).not.toContain('<img');
		});
	});

	describe('markdown rendering fallback', () => {
		it('should fall back to plain text when no app/component provided', () => {
			const plainProgress = new AgentViewProgress();
			const plainContainer = addObsidianMethods(document.createElement('div'));
			document.body.appendChild(plainContainer);
			plainProgress.createProgressBar(plainContainer);

			plainProgress.show('Thinking...', 'thinking');
			plainProgress.updateThought('Plain text fallback');

			const content = plainContainer.querySelector('.gemini-agent-thinking-content');
			expect(content?.textContent).toBe('Plain text fallback');
		});

		it('should fall back to plain text when MarkdownRenderer.render rejects', async () => {
			MarkdownRenderer.render.mockImplementationOnce(() => {
				return Promise.reject(new Error('Render failed'));
			});

			progress.show('Thinking...', 'thinking');
			progress.updateThought('Fallback on error');

			// Wait for the async render to complete and catch
			await new Promise((resolve) => setTimeout(resolve, 0));

			const content = container.querySelector('.gemini-agent-thinking-content');
			expect(content?.textContent).toBe('Fallback on error');
		});
	});
});
