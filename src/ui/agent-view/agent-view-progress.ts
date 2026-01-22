import { ChatTimer } from '../../utils/timer-utils';

export type ProgressState = 'thinking' | 'tool' | 'waiting' | 'streaming';

/**
 * Manages the progress bar display for agent operations
 * Shows status text, elapsed time, and visual state indicators
 */
export class AgentViewProgress {
	private progressBarContainer: HTMLElement;
	private progressBar: HTMLElement;
	private progressFill: HTMLElement;
	private progressStatus: HTMLElement;
	private progressTimer: HTMLElement;
	private chatTimer: ChatTimer;

	constructor() {
		this.chatTimer = new ChatTimer();
	}

	/**
	 * Creates the progress bar UI elements
	 */
	createProgressBar(container: HTMLElement): void {
		this.progressBarContainer = container;
		this.progressBarContainer.style.display = 'none'; // Hidden by default

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

		// Status text container
		const statusContainer = this.progressBarContainer.createDiv({
			cls: 'gemini-agent-progress-status-container',
		});

		this.progressStatus = statusContainer.createSpan({
			cls: 'gemini-agent-progress-status-text',
		});

		this.progressTimer = statusContainer.createSpan({
			cls: 'gemini-agent-progress-timer',
			attr: {
				'aria-live': 'polite',
				'aria-label': 'Elapsed time',
			},
		});
	}

	/**
	 * Shows the progress bar with initial status
	 */
	show(statusText: string, state: ProgressState): void {
		if (!this.progressBarContainer) return;

		this.progressBarContainer.style.display = 'block';
		this.progressStatus.innerHTML = this.formatProgressText(statusText);

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
		if (!this.progressBarContainer || this.progressBarContainer.style.display === 'none') return;

		this.progressStatus.innerHTML = this.formatProgressText(statusText);

		if (state) {
			this.progressFill.className = 'gemini-agent-progress-fill';
			this.progressFill.addClass(`gemini-agent-progress-${state}`);
		}
	}

	/**
	 * Hides the progress bar and stops the timer
	 */
	hide(): void {
		if (!this.progressBarContainer) return;

		this.progressBarContainer.style.display = 'none';
		this.chatTimer.stop();
	}

	/**
	 * Checks if progress is currently visible
	 */
	isVisible(): boolean {
		return this.progressBarContainer && this.progressBarContainer.style.display !== 'none';
	}

	/**
	 * Sets the title attribute on the progress status element (for hover tooltip)
	 */
	setStatusTitle(title: string): void {
		if (this.progressStatus) {
			this.progressStatus.title = title;
		}
	}

	/**
	 * Escape HTML entities to prevent XSS
	 */
	private escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * Convert simple markdown formatting to HTML for progress status
	 * Handles **bold** and basic text
	 * Note: Input is sanitized before markdown conversion to prevent XSS
	 */
	private formatProgressText(text: string): string {
		if (!text) return '';

		// First, escape HTML entities to prevent XSS
		let formatted = this.escapeHtml(text);

		// Then convert **text** to <strong>text</strong>
		formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

		// Replace newlines with spaces for single-line display
		formatted = formatted.replace(/\n+/g, ' ');

		// Trim extra spaces
		formatted = formatted.replace(/\s+/g, ' ').trim();

		return formatted;
	}
}
