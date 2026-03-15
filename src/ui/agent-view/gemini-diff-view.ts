import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { unifiedMergeView } from '@codemirror/merge';
import type ObsidianGemini from '../../main';
import { VIEW_TYPE_DIFF } from '../../main';

export interface DiffViewState {
	filePath: string;
	originalContent: string;
	proposedContent: string;
	isNewFile: boolean;
	onResolve: (result: { approved: boolean; finalContent: string; userEdited: boolean }) => void;
}

export class GeminiDiffView extends ItemView {
	plugin: InstanceType<typeof ObsidianGemini>;
	private editorView: EditorView | null = null;
	private state: DiffViewState | null = null;
	private resolved = false;

	constructor(leaf: WorkspaceLeaf, plugin: InstanceType<typeof ObsidianGemini>) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_DIFF;
	}

	getDisplayText(): string {
		if (this.state) {
			const action = this.state.isNewFile ? 'Preview' : 'Review Changes';
			return `${action}: ${this.state.filePath}`;
		}
		return 'Diff View';
	}

	getIcon(): string {
		return 'file-diff';
	}

	/**
	 * Initialize the diff view with file data and resolution callback.
	 * Called after the leaf is created but before the view is visible.
	 */
	setDiffState(state: DiffViewState): void {
		this.state = state;
		this.resolved = false;
		// updateHeader is an internal Obsidian API to refresh the tab title
		(this.leaf as any).updateHeader();
		this.renderView();
	}

	async onOpen(): Promise<void> {
		// View will be rendered when setDiffState is called
	}

	private renderView(): void {
		if (!this.state) return;

		const container = this.contentEl;
		container.empty();
		container.addClass('gemini-diff-view-container');

		// Action bar
		const actionBar = container.createDiv({ cls: 'gemini-diff-action-bar' });

		const fileInfo = actionBar.createDiv({ cls: 'gemini-diff-file-info' });
		const fileIcon = fileInfo.createSpan({ cls: 'gemini-diff-file-icon' });
		setIcon(fileIcon, this.state.isNewFile ? 'file-plus' : 'file-diff');
		fileInfo.createSpan({
			text: this.state.filePath,
			cls: 'gemini-diff-file-path',
		});

		if (this.state.isNewFile) {
			fileInfo.createSpan({ text: '(new file)', cls: 'gemini-diff-new-badge' });
		}

		const actionButtons = actionBar.createDiv({ cls: 'gemini-diff-actions' });

		const approveBtn = actionButtons.createEl('button', {
			cls: 'gemini-diff-btn gemini-diff-btn-approve mod-cta',
		});
		const approveIcon = approveBtn.createSpan({ cls: 'gemini-diff-btn-icon' });
		setIcon(approveIcon, 'check');
		approveBtn.createSpan({ text: 'Approve' });
		approveBtn.addEventListener('click', () => this.resolve(true));

		const cancelBtn = actionButtons.createEl('button', {
			cls: 'gemini-diff-btn gemini-diff-btn-cancel',
		});
		const cancelIcon = cancelBtn.createSpan({ cls: 'gemini-diff-btn-icon' });
		setIcon(cancelIcon, 'x');
		cancelBtn.createSpan({ text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.resolve(false));

		// Editor container
		const editorContainer = container.createDiv({ cls: 'gemini-diff-editor' });

		// Build CodeMirror extensions
		const extensions = [basicSetup];

		if (!this.state.isNewFile) {
			extensions.push(
				unifiedMergeView({
					original: this.state.originalContent,
				})
			);
		}

		// Create the editor
		this.editorView = new EditorView({
			state: EditorState.create({
				doc: this.state.proposedContent,
				extensions,
			}),
			parent: editorContainer,
		});
	}

	/**
	 * Resolve the diff view with approve or cancel.
	 */
	private resolve(approved: boolean): void {
		if (this.resolved || !this.state) return;
		this.resolved = true;

		const finalContent = this.editorView?.state.doc.toString() ?? this.state.proposedContent;
		const userEdited = finalContent !== this.state.proposedContent;

		this.state.onResolve({ approved, finalContent, userEdited });

		// Close the leaf
		this.leaf.detach();
	}

	async onClose(): Promise<void> {
		// If not yet resolved, treat close as cancel
		if (!this.resolved && this.state) {
			this.resolved = true;
			this.state.onResolve({
				approved: false,
				finalContent: this.state.proposedContent,
				userEdited: false,
			});
		}

		// Clean up CodeMirror
		if (this.editorView) {
			this.editorView.destroy();
			this.editorView = null;
		}
	}
}
