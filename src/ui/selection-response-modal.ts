import { App, Modal, MarkdownRenderer, Editor, Notice, setIcon } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { t } from '../i18n';
import { getRawErrorMessageOr } from '../utils/error-utils';
import { formatModelMessage } from '../utils/markdown-formatting';

/**
 * Modal that displays an AI response to a selection and allows inserting it as a callout.
 */
export class SelectionResponseModal extends Modal {
	private plugin: ObsidianGemini;
	private editor: Editor;
	private selectedText: string;
	private selectionEndPos: { line: number; ch: number };
	private responseContainer!: HTMLElement;
	private loadingEl!: HTMLElement;
	private actionsContainer!: HTMLElement;
	private response: string = '';

	constructor(
		app: App,
		plugin: ObsidianGemini,
		editor: Editor,
		selectedText: string,
		selectionEnd: { line: number; ch: number }
	) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.selectedText = selectedText;
		this.selectionEndPos = selectionEnd;
		this.modalEl.addClass('gemini-scribe-selection-response-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Header
		contentEl.createEl('h2', { text: t('selectionResponse.title') });

		// Selection preview (collapsed)
		const previewSection = contentEl.createDiv({ cls: 'gemini-scribe-selection-preview' });
		const previewHeader = previewSection.createDiv({ cls: 'gemini-scribe-preview-header' });
		previewHeader.createSpan({ text: t('selectionResponse.selectedTextLabel'), cls: 'gemini-scribe-preview-label' });

		const previewContent = previewSection.createDiv({ cls: 'gemini-scribe-preview-content' });
		previewContent.setText(this.selectedText);

		// Loading indicator
		this.loadingEl = contentEl.createDiv({ cls: 'gemini-scribe-loading' });
		const spinner = this.loadingEl.createDiv({ cls: 'gemini-scribe-spinner' });
		setIcon(spinner, 'loader-2');
		this.loadingEl.createSpan({ text: t('selectionResponse.generating') });

		// Response container (hidden initially)
		this.responseContainer = contentEl.createDiv({ cls: 'gemini-scribe-response-container' });
		this.responseContainer.hide();

		// Actions container (hidden initially)
		this.actionsContainer = contentEl.createDiv({ cls: 'gemini-scribe-actions' });
		this.actionsContainer.hide();

		const insertBtn = this.actionsContainer.createEl('button', {
			text: t('selectionResponse.insertButton'),
			cls: 'mod-cta',
		});
		insertBtn.onclick = () => this.insertAsCallout();

		const copyBtn = this.actionsContainer.createEl('button', {
			text: t('selectionResponse.copyButton'),
		});
		copyBtn.onclick = () => this.copyResponse();

		const closeBtn = this.actionsContainer.createEl('button', {
			text: t('selectionResponse.closeButton'),
		});
		closeBtn.onclick = () => this.close();
	}

	/**
	 * Show the response in the modal
	 */
	async showResponse(response: string) {
		this.response = response;

		// Hide loading, show response
		this.loadingEl.hide();
		this.responseContainer.show();
		this.actionsContainer.show();

		// Normalize newlines for proper Markdown rendering (shared with the agent
		// view; see markdown-formatting.ts)
		const normalizedResponse = formatModelMessage(response);

		// Render markdown response
		this.responseContainer.empty();
		// eslint-disable-next-line obsidianmd/no-plugin-as-component -- modal lifecycle is short; render happens once and Obsidian cleans up on close
		await MarkdownRenderer.render(this.app, normalizedResponse, this.responseContainer, '', this.plugin);
	}

	/**
	 * Show an error in the modal
	 */
	showError(error: string) {
		this.loadingEl.hide();
		this.responseContainer.show();
		this.actionsContainer.show();

		this.responseContainer.empty();
		const errorEl = this.responseContainer.createDiv({ cls: 'gemini-scribe-error' });
		errorEl.setText(t('selectionResponse.errorPrefix', { error }));
	}

	/**
	 * Insert the response as a callout block after the selection
	 */
	private insertAsCallout() {
		if (!this.response) return;

		// Normalize newlines for consistent formatting in the callout
		const normalizedResponse = formatModelMessage(this.response);

		// Format response as a callout
		const calloutLines = normalizedResponse.split('\n').map((line) => `> ${line}`);
		const callout = `\n\n> [!info] AI Response\n${calloutLines.join('\n')}\n`;

		// Insert after the selection
		const insertPos = {
			line: this.selectionEndPos.line,
			ch: this.editor.getLine(this.selectionEndPos.line).length,
		};

		this.editor.replaceRange(callout, insertPos);

		new Notice(t('selectionResponse.insertedNotice'));
		this.close();
	}

	/**
	 * Copy the response to clipboard
	 */
	private async copyResponse() {
		if (!this.response) return;

		if (!navigator.clipboard) {
			new Notice(t('selectionResponse.clipboardUnavailable'));
			return;
		}

		try {
			await navigator.clipboard.writeText(this.response);
			new Notice(t('selectionResponse.copiedNotice'));
		} catch (error) {
			this.plugin.logger.error('Failed to copy to clipboard:', error);
			const message = getRawErrorMessageOr(error, t('selectionResponse.unknownError'));
			new Notice(t('selectionResponse.copyFailed', { message }));
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for asking a question about a selection
 */
export class AskQuestionModal extends Modal {
	private questionInput!: HTMLTextAreaElement;
	private onSubmit: (question: string) => void | Promise<void>;
	private selectedText: string;

	constructor(app: App, selectedText: string, onSubmit: (question: string) => void | Promise<void>) {
		super(app);
		this.selectedText = selectedText;
		this.onSubmit = onSubmit;
		this.modalEl.addClass('gemini-scribe-ask-question-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('selectionResponse.askTitle') });

		// Selection preview
		const previewSection = contentEl.createDiv({ cls: 'gemini-scribe-selection-preview' });
		previewSection.createSpan({
			text: t('selectionResponse.askSelectedTextLabel'),
			cls: 'gemini-scribe-preview-label',
		});

		const previewContent = previewSection.createDiv({ cls: 'gemini-scribe-preview-content' });
		previewContent.setText(this.selectedText);

		// Question input
		const inputSection = contentEl.createDiv({ cls: 'gemini-scribe-question-section' });
		inputSection.createEl('label', { text: t('selectionResponse.questionLabel'), cls: 'gemini-scribe-label' });

		this.questionInput = inputSection.createEl('textarea', {
			placeholder: t('selectionResponse.questionPlaceholder'),
			cls: 'gemini-scribe-question-input',
		});

		// Submit button
		const submitBtn = contentEl.createEl('button', {
			text: t('selectionResponse.askButton'),
			cls: 'gemini-scribe-submit-button mod-cta',
		});
		submitBtn.onclick = () => this.submit();

		// Focus and keyboard shortcuts
		this.questionInput.focus();
		this.questionInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});
	}

	private submit() {
		const question = this.questionInput.value.trim();
		if (question) {
			this.close();
			void this.onSubmit(question);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
