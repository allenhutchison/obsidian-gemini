import { Modal, App, Setting, setIcon } from 'obsidian';
import { Tool } from '../tools/types';
import { ToolCategory } from '../types/agent';

export class ToolConfirmationModal extends Modal {
	private tool: Tool;
	private parameters: any;
	private onConfirm: (confirmed: boolean, allowWithoutConfirmation?: boolean) => void;

	constructor(app: App, tool: Tool, parameters: any, onConfirm: (confirmed: boolean, allowWithoutConfirmation?: boolean) => void) {
		super(app);
		this.tool = tool;
		this.parameters = parameters;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('gemini-tool-confirmation-modal');

		// Header with icon
		const header = contentEl.createDiv({ cls: 'gemini-tool-modal-header' });
		const headerIcon = header.createDiv({ cls: 'gemini-tool-modal-icon' });
		this.setToolIcon(headerIcon);
		
		const headerText = header.createDiv({ cls: 'gemini-tool-modal-header-text' });
		headerText.createEl('h2', { text: 'Tool Confirmation Required' });
		headerText.createEl('p', { text: 'The AI assistant wants to execute the following action:', cls: 'gemini-tool-modal-subtitle' });

		// Tool info card
		const toolCard = contentEl.createDiv({ cls: 'gemini-tool-card' });
		const toolHeader = toolCard.createDiv({ cls: 'gemini-tool-card-header' });
		
		const toolName = toolHeader.createDiv({ cls: 'gemini-tool-name-badge' });
		toolName.createSpan({ text: this.tool.name, cls: 'gemini-tool-name-text' });
		
		const toolCategory = toolHeader.createDiv({ cls: 'gemini-tool-category-badge' });
		toolCategory.textContent = this.getCategoryLabel();
		
		const toolDescription = toolCard.createDiv({ cls: 'gemini-tool-description' });
		toolDescription.createEl('p', { text: this.tool.description });

		// Parameters section
		if (this.parameters && Object.keys(this.parameters).length > 0) {
			const paramsSection = contentEl.createDiv({ cls: 'gemini-tool-params-section' });
			const paramsHeader = paramsSection.createDiv({ cls: 'gemini-tool-params-header' });
			const paramsIcon = paramsHeader.createSpan({ cls: 'gemini-tool-params-icon' });
			setIcon(paramsIcon, 'settings-2');
			paramsHeader.createSpan({ text: 'Parameters', cls: 'gemini-tool-params-title' });
			
			const paramsContainer = paramsSection.createDiv({ cls: 'gemini-tool-params-container' });
			
			for (const [key, value] of Object.entries(this.parameters)) {
				const paramRow = paramsContainer.createDiv({ cls: 'gemini-tool-param-row' });
				
				const keyEl = paramRow.createDiv({ cls: 'gemini-tool-param-key' });
				keyEl.createSpan({ text: key });
				
				const valueEl = paramRow.createDiv({ cls: 'gemini-tool-param-value' });
				
				if (typeof value === 'string' && value.length > 100) {
					// Create collapsible parameter
					const valueContent = valueEl.createDiv({ cls: 'gemini-tool-param-content gemini-tool-param-collapsed' });
					valueContent.createEl('code', { text: value });
					
					const expandBtn = valueEl.createEl('button', { 
						cls: 'gemini-tool-expand-btn' 
					});
					setIcon(expandBtn, 'chevron-down');
					
					let expanded = false;
					expandBtn.addEventListener('click', () => {
						expanded = !expanded;
						if (expanded) {
							valueContent.removeClass('gemini-tool-param-collapsed');
							setIcon(expandBtn, 'chevron-up');
						} else {
							valueContent.addClass('gemini-tool-param-collapsed');
							setIcon(expandBtn, 'chevron-down');
						}
					});
				} else {
					valueEl.createEl('code', { text: JSON.stringify(value, null, 2), cls: 'gemini-tool-param-code' });
				}
			}
		}

		// Custom confirmation message
		if (this.tool.confirmationMessage) {
			const customMessage = contentEl.createDiv({ cls: 'gemini-tool-custom-message' });
			const messageIcon = customMessage.createDiv({ cls: 'gemini-tool-message-icon' });
			setIcon(messageIcon, 'info');
			const messageContent = customMessage.createDiv({ cls: 'gemini-tool-message-content' });
			const message = this.tool.confirmationMessage(this.parameters);
			messageContent.createEl('p', { text: message });
		}


		// Allow without confirmation checkbox
		const allowContainer = contentEl.createDiv({ cls: 'gemini-tool-allow-container' });
		const allowLabel = allowContainer.createEl('label', { cls: 'gemini-tool-allow-label' });
		const allowCheckbox = allowLabel.createEl('input', { 
			type: 'checkbox',
			cls: 'gemini-tool-allow-checkbox'
		});
		allowLabel.createSpan({ 
			text: 'Allow this action in the future without confirmation (this session only)',
			cls: 'gemini-tool-allow-text'
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'gemini-tool-buttons' });
		
		const cancelBtn = buttonContainer.createEl('button', { 
			cls: 'gemini-tool-cancel-btn'
		});
		const cancelIcon = cancelBtn.createSpan({ cls: 'gemini-tool-btn-icon' });
		setIcon(cancelIcon, 'x');
		cancelBtn.createSpan({ text: 'Cancel' });
		
		const confirmBtn = buttonContainer.createEl('button', { 
			cls: 'gemini-tool-confirm-btn mod-cta'
		});
		const confirmIcon = confirmBtn.createSpan({ cls: 'gemini-tool-btn-icon' });
		setIcon(confirmIcon, 'check');
		confirmBtn.createSpan({ text: 'Execute Tool' });

		// Event listeners
		cancelBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm(false, false);
		});

		confirmBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm(true, allowCheckbox.checked);
		});

		// ESC key to cancel
		this.scope.register([], 'Escape', () => {
			this.close();
			this.onConfirm(false, false);
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private setToolIcon(container: HTMLElement) {
		const iconMap: Record<string, string> = {
			'read_file': 'file-text',
			'write_file': 'file-edit',
			'list_files': 'folder-open',
			'create_folder': 'folder-plus',
			'delete_file': 'trash-2',
			'move_file': 'file-symlink',
			'search_files': 'search',
			'google_search': 'globe',
			'web_fetch': 'download'
		};
		
		const icon = iconMap[this.tool.name] || 'tool';
		setIcon(container, icon);
	}

	private getCategoryLabel(): string {
		// Map tool names to their categories
		const toolCategories: Record<string, string> = {
			'read_file': 'Read Only',
			'list_files': 'Read Only',
			'search_files': 'Read Only',
			'write_file': 'Vault Operation',
			'create_folder': 'Vault Operation',
			'delete_file': 'Vault Operation',
			'move_file': 'Vault Operation',
			'google_search': 'External',
			'web_fetch': 'External'
		};
		
		return toolCategories[this.tool.name] || 'Tool';
	}
}