import { Modal, App, Setting } from 'obsidian';
import { Tool } from '../tools/types';

export class ToolConfirmationModal extends Modal {
	private tool: Tool;
	private parameters: any;
	private onConfirm: (confirmed: boolean) => void;

	constructor(app: App, tool: Tool, parameters: any, onConfirm: (confirmed: boolean) => void) {
		super(app);
		this.tool = tool;
		this.parameters = parameters;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Title
		contentEl.createEl('h2', { text: 'Confirm Tool Execution' });

		// Tool info
		const toolInfo = contentEl.createDiv({ cls: 'gemini-tool-info' });
		toolInfo.createEl('h3', { text: `🔧 ${this.tool.name}` });
		toolInfo.createEl('p', { text: this.tool.description });

		// Parameters section
		if (this.parameters && Object.keys(this.parameters).length > 0) {
			const paramsSection = contentEl.createDiv({ cls: 'gemini-tool-params-section' });
			paramsSection.createEl('h4', { text: 'Parameters:' });
			
			const paramsContainer = paramsSection.createDiv({ cls: 'gemini-tool-params-container' });
			
			for (const [key, value] of Object.entries(this.parameters)) {
				const paramRow = paramsContainer.createDiv({ cls: 'gemini-tool-param-row' });
				paramRow.createSpan({ text: `${key}:`, cls: 'gemini-tool-param-key' });
				
				const valueEl = paramRow.createDiv({ cls: 'gemini-tool-param-value' });
				
				if (typeof value === 'string' && value.length > 100) {
					// Show truncated version with expansion
					const truncated = value.substring(0, 100) + '...';
					const truncatedEl = valueEl.createSpan({ text: truncated });
					
					const expandBtn = valueEl.createEl('button', { 
						text: 'Show more',
						cls: 'gemini-tool-expand-btn' 
					});
					
					expandBtn.addEventListener('click', () => {
						truncatedEl.textContent = value;
						expandBtn.remove();
					});
				} else {
					valueEl.createEl('code', { text: JSON.stringify(value, null, 2) });
				}
			}
		}

		// Custom confirmation message
		if (this.tool.confirmationMessage) {
			const customMessage = contentEl.createDiv({ cls: 'gemini-tool-custom-message' });
			const message = this.tool.confirmationMessage(this.parameters);
			customMessage.createEl('p', { text: message });
		}

		// Warning for destructive actions
		if (this.tool.requiresConfirmation) {
			const warning = contentEl.createDiv({ cls: 'gemini-tool-warning' });
			warning.createEl('p', { 
				text: '⚠️ This action may modify your vault. Please review the parameters carefully.',
				cls: 'gemini-tool-warning-text'
			});
		}

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'gemini-tool-buttons' });
		
		const cancelBtn = buttonContainer.createEl('button', { 
			text: 'Cancel',
			cls: 'gemini-tool-cancel-btn'
		});
		
		const confirmBtn = buttonContainer.createEl('button', { 
			text: 'Execute Tool',
			cls: 'gemini-tool-confirm-btn mod-cta'
		});

		// Event listeners
		cancelBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm(false);
		});

		confirmBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm(true);
		});

		// ESC key to cancel
		this.scope.register([], 'Escape', () => {
			this.close();
			this.onConfirm(false);
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}