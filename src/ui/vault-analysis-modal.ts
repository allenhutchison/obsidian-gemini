/**
 * Progress Modal for Vault Analysis
 * Shows real-time progress updates while analyzing vault and generating AGENTS.md
 */

import { App, Modal } from 'obsidian';

export class VaultAnalysisModal extends Modal {
	private statusEl: HTMLElement;
	private spinnerEl: HTMLElement;
	private stepsEl: HTMLElement;
	private steps: Map<string, HTMLElement> = new Map();
	private currentStep: string = '';

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Add modal styling
		contentEl.addClass('gemini-vault-analysis-modal');

		// Header
		contentEl.createEl('h2', {
			text: '🔍 Analyzing Vault',
			cls: 'gemini-vault-analysis-header'
		});

		// Description
		const description = contentEl.createDiv({ cls: 'gemini-vault-analysis-description' });
		description.createEl('p', {
			text: 'Generating context for AGENTS.md...'
		});

		// Current status with spinner
		const statusContainer = contentEl.createDiv({ cls: 'gemini-vault-analysis-status' });

		this.spinnerEl = statusContainer.createDiv({ cls: 'gemini-vault-analysis-spinner' });
		this.spinnerEl.innerHTML = `
			<svg class="gemini-spinner" viewBox="0 0 50 50">
				<circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle>
			</svg>
		`;

		this.statusEl = statusContainer.createDiv({ cls: 'gemini-vault-analysis-status-text' });
		this.statusEl.setText('Initializing...');

		// Steps list
		this.stepsEl = contentEl.createDiv({ cls: 'gemini-vault-analysis-steps' });

		// Add CSS
		this.addStyles();
	}

	/**
	 * Update the current status message
	 */
	updateStatus(message: string): void {
		if (this.statusEl) {
			this.statusEl.setText(message);
		}
	}

	/**
	 * Add a step to the progress list
	 */
	addStep(id: string, message: string): void {
		const stepEl = this.stepsEl.createDiv({ cls: 'gemini-vault-analysis-step' });

		const iconEl = stepEl.createDiv({ cls: 'gemini-vault-analysis-step-icon' });
		iconEl.innerHTML = '⏳'; // Waiting icon

		const textEl = stepEl.createDiv({ cls: 'gemini-vault-analysis-step-text' });
		textEl.setText(message);

		this.steps.set(id, stepEl);
		this.currentStep = id;
	}

	/**
	 * Mark a step as in progress
	 */
	setStepInProgress(id: string): void {
		const stepEl = this.steps.get(id);
		if (stepEl) {
			const iconEl = stepEl.querySelector('.gemini-vault-analysis-step-icon');
			if (iconEl) {
				iconEl.innerHTML = '▶️'; // In progress icon
			}
			stepEl.addClass('in-progress');
			this.currentStep = id;
		}
	}

	/**
	 * Mark a step as complete
	 */
	setStepComplete(id: string): void {
		const stepEl = this.steps.get(id);
		if (stepEl) {
			const iconEl = stepEl.querySelector('.gemini-vault-analysis-step-icon');
			if (iconEl) {
				iconEl.innerHTML = '✅'; // Complete icon
			}
			stepEl.removeClass('in-progress');
			stepEl.addClass('complete');
		}
	}

	/**
	 * Mark a step as failed
	 */
	setStepFailed(id: string, error: string): void {
		const stepEl = this.steps.get(id);
		if (stepEl) {
			const iconEl = stepEl.querySelector('.gemini-vault-analysis-step-icon');
			if (iconEl) {
				iconEl.innerHTML = '❌'; // Failed icon
			}
			stepEl.removeClass('in-progress');
			stepEl.addClass('failed');

			// Add error message
			const errorEl = stepEl.createDiv({ cls: 'gemini-vault-analysis-step-error' });
			errorEl.setText(error);
		}
	}

	/**
	 * Mark the process as complete
	 */
	setComplete(message: string = 'Analysis complete!'): void {
		this.updateStatus(message);

		// Hide spinner
		if (this.spinnerEl) {
			this.spinnerEl.style.display = 'none';
		}

		// Add a close button
		setTimeout(() => {
			this.close();
		}, 2000); // Auto-close after 2 seconds
	}

	/**
	 * Add CSS styles for the modal
	 */
	private addStyles(): void {
		// Check if styles already exist
		if (document.getElementById('gemini-vault-analysis-styles')) {
			return;
		}

		const style = document.createElement('style');
		style.id = 'gemini-vault-analysis-styles';
		style.textContent = `
			.gemini-vault-analysis-modal {
				padding: 20px;
			}

			.gemini-vault-analysis-header {
				margin-bottom: 16px;
			}

			.gemini-vault-analysis-description {
				margin-bottom: 24px;
				color: var(--text-muted);
			}

			.gemini-vault-analysis-status {
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 16px;
				background: var(--background-secondary);
				border-radius: 8px;
				margin-bottom: 20px;
			}

			.gemini-vault-analysis-spinner {
				flex-shrink: 0;
			}

			.gemini-spinner {
				width: 24px;
				height: 24px;
				animation: rotate 2s linear infinite;
			}

			.gemini-spinner .path {
				stroke: var(--interactive-accent);
				stroke-linecap: round;
				animation: dash 1.5s ease-in-out infinite;
			}

			@keyframes rotate {
				100% {
					transform: rotate(360deg);
				}
			}

			@keyframes dash {
				0% {
					stroke-dasharray: 1, 150;
					stroke-dashoffset: 0;
				}
				50% {
					stroke-dasharray: 90, 150;
					stroke-dashoffset: -35;
				}
				100% {
					stroke-dasharray: 90, 150;
					stroke-dashoffset: -124;
				}
			}

			.gemini-vault-analysis-status-text {
				flex: 1;
				font-weight: 500;
			}

			.gemini-vault-analysis-steps {
				display: flex;
				flex-direction: column;
				gap: 8px;
			}

			.gemini-vault-analysis-step {
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 8px 12px;
				border-radius: 6px;
				transition: background-color 0.2s;
			}

			.gemini-vault-analysis-step.in-progress {
				background: var(--background-secondary);
			}

			.gemini-vault-analysis-step.complete {
				opacity: 0.7;
			}

			.gemini-vault-analysis-step.failed {
				background: var(--background-modifier-error);
			}

			.gemini-vault-analysis-step-icon {
				font-size: 16px;
				flex-shrink: 0;
			}

			.gemini-vault-analysis-step-text {
				flex: 1;
			}

			.gemini-vault-analysis-step-error {
				margin-top: 4px;
				padding: 8px;
				background: var(--background-primary);
				border-radius: 4px;
				font-size: 0.9em;
				color: var(--text-error);
			}
		`;

		document.head.appendChild(style);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
