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

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
