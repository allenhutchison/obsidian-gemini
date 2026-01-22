/**
 * Utility class for managing timer display in chat interfaces
 */
export class ChatTimer {
	private timerInterval: NodeJS.Timeout | null = null;
	private startTime: number | null = null;
	private timerDisplay: HTMLElement | null = null;

	/**
	 * Start the timer and update the display element
	 * @param timerDisplay - The HTML element to display the timer
	 */
	start(timerDisplay: HTMLElement): void {
		// Clean up any existing timer
		this.stop();

		this.startTime = Date.now();
		this.timerDisplay = timerDisplay;

		// Initial display
		this.updateDisplay();

		// Update every 100ms for smooth display
		this.timerInterval = setInterval(() => {
			this.updateDisplay();
		}, 100);
	}

	/**
	 * Stop the timer and clean up
	 */
	stop(): void {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
		this.startTime = null;
		this.timerDisplay = null;
	}

	/**
	 * Check if the timer is currently running
	 */
	isRunning(): boolean {
		return this.timerInterval !== null;
	}

	/**
	 * Get the elapsed time in seconds
	 */
	getElapsedTime(): number {
		if (!this.startTime) return 0;
		return (Date.now() - this.startTime) / 1000;
	}

	/**
	 * Update the timer display
	 */
	private updateDisplay(): void {
		if (this.timerDisplay && this.startTime) {
			const elapsed = this.getElapsedTime();
			this.timerDisplay.textContent = `${elapsed.toFixed(1)}s`;
		}
	}

	/**
	 * Clean up on destroy
	 */
	destroy(): void {
		this.stop();
	}
}
