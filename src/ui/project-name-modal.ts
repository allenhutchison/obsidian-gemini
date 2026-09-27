import { App, Modal } from 'obsidian';
import { t, type TranslationKey } from '../i18n';

/**
 * Characters a project name can't contain: it becomes the project file's
 * basename, so path separators and the characters Obsidian rejects in file
 * names (or that break wikilinks) are out. `"` is also out because the name is
 * written into a double-quoted YAML scalar.
 */
const INVALID_NAME_CHARS = /[\\/:*?"<>|#^[\]]/;

/**
 * Windows device names, which can't be a file's basename even with an
 * extension: Windows reads everything before the first dot, so `CON.md` and
 * `CON.notes.md` are both refused.
 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Why `name` can't be used as a project name, or `null` when it can. */
export function projectNameError(name: string): TranslationKey | null {
	const trimmed = name.trim();
	if (!trimmed) return 'projectName.errorEmpty';
	if (INVALID_NAME_CHARS.test(trimmed)) return 'projectName.errorInvalidChars';
	if (trimmed.startsWith('.')) return 'projectName.errorInvalidChars';
	if (WINDOWS_RESERVED_NAME.test(trimmed.split('.')[0].trimEnd())) return 'projectName.errorReserved';
	return null;
}

/**
 * Asks for the name of a new project before the "Create project" command
 * writes its file. `onSubmit` receives the trimmed name and is called only
 * for a valid one; cancelling or dismissing the modal calls nothing.
 */
export class ProjectNameModal extends Modal {
	private onSubmit: (name: string) => void;
	private inputEl!: HTMLInputElement;
	private errorEl!: HTMLElement;

	constructor(app: App, onSubmit: (name: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('projectName.title') });

		this.inputEl = contentEl.createEl('input', { cls: 'gemini-scribe-project-name-input' });
		this.inputEl.type = 'text';
		this.inputEl.value = t('projectName.defaultName');
		this.inputEl.setAttribute('aria-label', t('projectName.inputLabel'));
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			}
		});
		this.inputEl.addEventListener('input', () => this.showError(null));

		this.errorEl = contentEl.createDiv({ cls: 'gemini-warning-text' });

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancelBtn = buttons.createEl('button', { text: t('projectName.cancelButton') });
		cancelBtn.addEventListener('click', () => this.close());
		const createBtn = buttons.createEl('button', { text: t('projectName.createButton'), cls: 'mod-cta' });
		createBtn.addEventListener('click', () => this.submit());

		this.inputEl.focus();
		this.inputEl.select();
	}

	submit() {
		const error = projectNameError(this.inputEl.value);
		if (error) {
			this.showError(error);
			return;
		}
		const name = this.inputEl.value.trim();
		this.close();
		this.onSubmit(name);
	}

	private showError(key: TranslationKey | null) {
		this.errorEl.textContent = key ? t(key) : '';
	}

	onClose() {
		this.contentEl.empty();
	}
}
