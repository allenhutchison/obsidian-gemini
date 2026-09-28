import { App, MarkdownRenderer, Component, setIcon } from 'obsidian';
import { ChatTimer } from '../../utils/timer-utils';
import { t } from '../../i18n';

export type ProgressState = 'thinking' | 'tool' | 'waiting' | 'streaming';

/**
 * Manages the progress bar display for agent operations
 * Shows status text, elapsed time, visual state indicators,
 * and an expandable section for viewing full thinking text
 */
export class AgentViewProgress {
	private progressBarContainer!: HTMLElement;
	private progressBar!: HTMLElement;
	private progressFill!: HTMLElement;
	private progressStatusContainer!: HTMLElement;
	private progressStatus!: HTMLElement;
	private progressTimer!: HTMLElement;
	private chatTimer: ChatTimer;

	// Expandable thinking section
	private thinkingSection!: HTMLElement;
	private thinkingContent!: HTMLElement;
	private thinkingChevron!: HTMLElement;
	private isThinkingExpanded: boolean = false;
	private hasThinkingContent: boolean = false;
	private thinkingRenderVersion: number = 0;

	// Obsidian rendering context
	private app?: App;
	private renderComponent?: Component;

	constructor(app?: App, renderComponent?: Component) {
		this.chatTimer = new ChatTimer();
		if (app) this.app = app;
		if (renderComponent) this.renderComponent = renderComponent;
	}

	/**
	 * Creates the progress bar UI elements
	 */
	createProgressBar(container: HTMLElement): void {
		this.progressBarContainer = container;
		this.progressBarContainer.addClass('gemini-agent-progress-container--hidden'); // Hidden by default

		// Progress bar wrapper
		const barWrapper = this.progressBarContainer.createDiv({
			cls: 'gemini-agent-progress-bar-wrapper',
		});

		this.progressBar = barWrapper.createDiv({
			cls: 'gemini-agent-progress-bar',
		});

		this.progressFill = this.progressBar.createDiv({
			cls: 'gemini-agent-progress-fill',
		});

		// Status text container — entire row is clickable to toggle thinking
		this.progressStatusContainer = this.progressBarContainer.createDiv({
			cls: 'gemini-agent-progress-status-container',
		});

		// Chevron indicator (shown when thinking content is available)
		this.thinkingChevron = this.progressStatusContainer.createSpan({
			cls: 'gemini-agent-thinking-chevron',
		});
		setIcon(this.thinkingChevron, 'chevron-down');
		this.thinkingChevron.addClass('gemini-agent-thinking-chevron--hidden'); // Hidden until thinking content arrives

		this.progressStatus = this.progressStatusContainer.createSpan({
			cls: 'gemini-agent-progress-status-text',
		});

		this.progressTimer = this.progressStatusContainer.createSpan({
			cls: 'gemini-agent-progress-timer',
			attr: {
				'aria-live': 'polite',
				'aria-label': t('agent.progress.elapsedAria'),
			},
		});

		// Click handler on the entire status container
		this.progressStatusContainer.addEventListener('click', () => {
			if (this.hasThinkingContent) {
				this.toggleThinkingSection();
			}
		});

		// Keyboard handler for accessibility (Enter/Space to toggle)
		this.progressStatusContainer.addEventListener('keydown', (e: KeyboardEvent) => {
			if (this.hasThinkingContent && (e.key === 'Enter' || e.key === ' ')) {
				e.preventDefault();
				this.toggleThinkingSection();
			}
		});

		// Expandable thinking section (below the status line)
		this.thinkingSection = this.progressBarContainer.createDiv({
			cls: 'gemini-agent-thinking-section',
		});
		this.thinkingSection.addClass('gemini-agent-thinking-section--collapsed');

		this.thinkingContent = this.thinkingSection.createDiv({
			cls: 'gemini-agent-thinking-content',
		});
	}

	/**
	 * Shows the progress bar with initial status
	 */
	show(statusText: string, state: ProgressState): void {
		if (!this.progressBarContainer) return;

		this.progressBarContainer.removeClass('gemini-agent-progress-container--hidden');
		this.renderProgressText(statusText);

		// Update state class for color coding
		this.progressFill.className = 'gemini-agent-progress-fill';
		this.progressFill.addClass(`gemini-agent-progress-${state}`);

		// Start timer if not already running
		if (!this.chatTimer.isRunning()) {
			this.chatTimer.start(this.progressTimer);
		}
	}

	/**
	 * Updates the progress bar with new status
	 */
	update(statusText: string, state?: ProgressState): void {
		if (!this.progressBarContainer || this.progressBarContainer.hasClass('gemini-agent-progress-container--hidden'))
			return;

		this.renderProgressText(statusText);

		if (state) {
			this.progressFill.className = 'gemini-agent-progress-fill';
			this.progressFill.addClass(`gemini-agent-progress-${state}`);
		}
	}

	/**
	 * Updates the expandable thinking section with accumulated thought text.
	 * Shows the chevron and makes the status row clickable.
	 * The status line shows a truncated preview; the expanded section renders the full markdown.
	 */
	updateThought(accumulatedThought: string): void {
		if (!this.progressBarContainer || this.progressBarContainer.hasClass('gemini-agent-progress-container--hidden'))
			return;

		this.hasThinkingContent = true;

		// Show the chevron and make the row look clickable + keyboard-accessible
		this.thinkingChevron.removeClass('gemini-agent-thinking-chevron--hidden');
		this.progressStatusContainer.addClass('gemini-agent-progress-clickable');
		this.progressStatusContainer.setAttribute('tabindex', '0');
		this.progressStatusContainer.setAttribute('role', 'button');
		// Set initial collapsed state for assistive tech (only if not already expanded)
		if (!this.isThinkingExpanded) {
			this.progressStatusContainer.setAttribute('aria-expanded', 'false');
		}

		// Update status line with truncated preview
		const preview = this.truncateThought(accumulatedThought);
		this.renderProgressText(preview);

		// Update the full thinking content in the expandable section (fire-and-forget async)
		void this.renderThinkingContent(accumulatedThought);
	}

	/**
	 * Render the thinking content as markdown if possible, otherwise plain text
	 */
	private async renderThinkingContent(text: string): Promise<void> {
		const renderVersion = ++this.thinkingRenderVersion;

		if (this.app && this.renderComponent) {
			// Render into a detached container to avoid stale async renders
			// mutating the live DOM node; appendChild below adopts the rendered
			// nodes into the live node's document (including a popout window's).
			const tempEl = createDiv();
			try {
				await MarkdownRenderer.render(this.app, text, tempEl, '', this.renderComponent);

				// Bail if a newer render has started while we were awaiting
				if (renderVersion !== this.thinkingRenderVersion) return;

				// Swap rendered content into the live node
				this.thinkingContent.empty();
				while (tempEl.firstChild) {
					this.thinkingContent.appendChild(tempEl.firstChild);
				}
			} catch {
				// If markdown rendering fails, fall back to plain text
				if (renderVersion !== this.thinkingRenderVersion) return;
				this.thinkingContent.empty();
				this.thinkingContent.textContent = text;
			}
		} else {
			// Fallback: render as plain text
			this.thinkingContent.empty();
			this.thinkingContent.textContent = text;
		}

		// Auto-scroll to bottom of thinking section if expanded
		if (this.isThinkingExpanded) {
			window.requestAnimationFrame(() => {
				if (renderVersion !== this.thinkingRenderVersion) return;
				this.thinkingContent.scrollTop = this.thinkingContent.scrollHeight;
			});
		}
	}

	/**
	 * Hides the progress bar and stops the timer
	 */
	hide(): void {
		if (!this.progressBarContainer) return;

		this.progressBarContainer.addClass('gemini-agent-progress-container--hidden');
		this.chatTimer.stop();

		// Reset thinking section
		this.collapseThinkingSection();
		this.thinkingContent.empty();
		this.thinkingChevron.addClass('gemini-agent-thinking-chevron--hidden');
		this.hasThinkingContent = false;
		// Invalidate any in-flight async renders
		this.thinkingRenderVersion++;
		this.progressStatusContainer.removeClass('gemini-agent-progress-clickable');
		this.progressStatusContainer.removeAttribute('tabindex');
		this.progressStatusContainer.removeAttribute('role');
		this.progressStatusContainer.removeAttribute('aria-expanded');
	}

	/**
	 * Checks if progress is currently visible
	 */
	isVisible(): boolean {
		return this.progressBarContainer && !this.progressBarContainer.hasClass('gemini-agent-progress-container--hidden');
	}

	/**
	 * Toggle the expanded thinking section
	 */
	private toggleThinkingSection(): void {
		if (this.isThinkingExpanded) {
			this.collapseThinkingSection();
		} else {
			this.expandThinkingSection();
		}
	}

	/**
	 * Expand the thinking section
	 */
	private expandThinkingSection(): void {
		this.isThinkingExpanded = true;
		this.thinkingSection.removeClass('gemini-agent-thinking-section--collapsed');
		this.thinkingChevron.addClass('gemini-agent-thinking-chevron-expanded');
		this.progressStatusContainer.setAttribute('aria-expanded', 'true');

		// Scroll to bottom to show latest content
		window.requestAnimationFrame(() => {
			this.thinkingContent.scrollTop = this.thinkingContent.scrollHeight;
		});
	}

	/**
	 * Collapse the thinking section
	 */
	private collapseThinkingSection(): void {
		this.isThinkingExpanded = false;
		if (this.thinkingSection) {
			this.thinkingSection.addClass('gemini-agent-thinking-section--collapsed');
		}
		if (this.thinkingChevron) {
			this.thinkingChevron.removeClass('gemini-agent-thinking-chevron-expanded');
		}
		if (this.progressStatusContainer) {
			this.progressStatusContainer.setAttribute('aria-expanded', 'false');
		}
	}

	/**
	 * Truncate thought text for the progress status line preview
	 */
	private truncateThought(text: string): string {
		const MAX_DISPLAY_LENGTH = 150;
		if (text.length <= MAX_DISPLAY_LENGTH) return text;
		// Show the latest portion of the thinking text
		return '...' + text.slice(-(MAX_DISPLAY_LENGTH - 3));
	}

	/**
	 * Render status text into the status line as a single line, turning
	 * `**bold**` spans into <strong> elements. Text is inserted as text nodes,
	 * never parsed as HTML, so model output can't inject markup.
	 */
	private renderProgressText(text: string): void {
		this.progressStatus.empty();
		const line = (text ?? '').replace(/\s+/g, ' ').trim();
		// split() with a capture group alternates plain and bold segments.
		line.split(/\*\*(.*?)\*\*/g).forEach((segment, i) => {
			if (i % 2 === 1) {
				this.progressStatus.createEl('strong', { text: segment });
			} else if (segment) {
				this.progressStatus.appendChild(this.progressStatus.ownerDocument.createTextNode(segment));
			}
		});
	}
}
