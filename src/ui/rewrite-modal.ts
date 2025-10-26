import { Modal, App } from 'obsidian';

export class RewriteInstructionsModal extends Modal {
	private instructionsEl: HTMLTextAreaElement;
	private onSubmit: (instructions: string) => void;
	private selectedText: string;
	private isFullFile: boolean;

	constructor(app: App, selectedText: string, onSubmit: (instructions: string) => void, isFullFile: boolean = false) {
		super(app);
		this.selectedText = selectedText;
		this.onSubmit = onSubmit;
		this.isFullFile = isFullFile;
		this.modalEl.addClass('gemini-scribe-rewrite-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.isFullFile ? 'Rewrite Entire File' : 'Rewrite Selected Text' });

		// Show preview of selected text or file info
		const previewSection = contentEl.createDiv({ cls: 'gemini-scribe-section' });
		previewSection.createEl('label', {
			text: this.isFullFile ? 'File content:' : 'Selected text:',
			cls: 'gemini-scribe-label'
		});

		const previewTextContainer = previewSection.createDiv({ cls: 'gemini-scribe-preview-text' });
		const previewDiv = previewTextContainer.createDiv({ cls: 'gemini-scribe-preview-content' });

		// Show truncated preview for full files
		if (this.isFullFile && this.selectedText.length > 500) {
			const preview = this.selectedText.substring(0, 500) + '\n\n... (file truncated for preview)';
			previewDiv.setText(preview);
		} else {
			previewDiv.setText(this.selectedText);
		}

		// Instructions input
		const instructionsSection = contentEl.createDiv({ cls: 'gemini-scribe-section' });
		instructionsSection.createEl('label', {
			text: 'Instructions:',
			cls: 'gemini-scribe-label'
		});

		const placeholder = this.isFullFile
			? 'How would you like to rewrite this file?\n\nExamples:\n• Make it more concise\n• Fix grammar and spelling throughout\n• Convert to a different format\n• Reorganize the structure\n• Improve clarity and readability'
			: 'How would you like to rewrite this text?\n\nExamples:\n• Make it more concise\n• Fix grammar and spelling\n• Make it more formal/casual\n• Expand with more detail\n• Simplify the language';

		this.instructionsEl = instructionsSection.createEl('textarea', {
			placeholder,
			cls: 'gemini-scribe-instructions-input'
		});

		// Submit button - full width
		const submitBtn = contentEl.createEl('button', { 
			text: 'Rewrite',
			cls: 'gemini-scribe-submit-button mod-cta'
		});

		submitBtn.onclick = () => this.submit();

		// Focus on instructions input
		this.instructionsEl.focus();

		// Keyboard shortcuts
		this.instructionsEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});

		// Close on Escape
		this.modalEl.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			}
		});
	}

	submit() {
		const instructions = this.instructionsEl.value;
		if (instructions.trim()) {
			this.close();
			this.onSubmit(instructions);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}