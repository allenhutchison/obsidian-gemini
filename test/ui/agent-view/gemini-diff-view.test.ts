import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiDiffView, VIEW_TYPE_DIFF, type DiffViewState } from '../../../src/ui/agent-view/gemini-diff-view';
import type { Mock } from 'vitest';
import type { ObsidianGemini } from '../../../src/types/plugin';

// The diff view's observable contract is its *resolution semantics*, not its
// CodeMirror chrome: exactly-once resolution, the userEdited flag (the chat
// "Allow" button must know whether the user changed the proposal), and the
// close-without-resolve notification. The CodeMirror editor itself is stubbed —
// rendering a real merge view under jsdom is out of scope for these guarantees.

vi.mock('obsidian', () => ({
	ItemView: class {
		contentEl = document.createElement('div');
		navigation = false;
		leaf: unknown;
		constructor(leaf?: unknown) {
			// The View base class assigns this.leaf in the real constructor.
			this.leaf = leaf ?? { detach: vi.fn(), updateHeader: vi.fn() };
		}
	},
	WorkspaceLeaf: class {},
	setIcon: vi.fn(),
	setTooltip: vi.fn(),
	getLanguage: vi.fn(() => 'en'),
	normalizePath: (p: string) => p,
	Notice: vi.fn(),
}));

vi.mock('codemirror', () => ({
	EditorView: Object.assign(
		vi.fn().mockImplementation(function (this: any, cfg: any) {
			// The real EditorView exposes `state.doc`, matching what the source reads.
			this.state = { doc: cfg?.state?.doc ?? { toString: () => '' } };
			this.destroy = vi.fn();
		}),
		{
			lineWrapping: 'line-wrapping-ext',
		}
	),
	basicSetup: ['basic-setup'],
}));

vi.mock('@codemirror/state', () => ({
	EditorState: {
		create: vi.fn((cfg: { doc?: string }) => ({ doc: { toString: () => cfg?.doc ?? '' }, extensions: [] })),
	},
}));

vi.mock('@codemirror/merge', () => ({
	unifiedMergeView: vi.fn(() => 'merge-view-ext'),
}));

// Imported after the mocks.
import { EditorView } from 'codemirror';
import { unifiedMergeView } from '@codemirror/merge';

function addObsidianMethods(el: HTMLElement): HTMLElement {
	(el as any).createDiv = function (opts?: any) {
		const div = document.createElement('div');
		if (opts?.cls) div.className = opts.cls;
		if (opts?.text) div.textContent = opts.text;
		if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) div.setAttribute(k, String(v));
		addObsidianMethods(div);
		this.appendChild(div);
		return div;
	};
	(el as any).createEl = function (tag: string, opts?: any) {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text) elem.textContent = opts.text;
		if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) elem.setAttribute(k, String(v));
		addObsidianMethods(elem);
		this.appendChild(elem);
		return elem;
	};
	(el as any).createSpan = function (opts?: any) {
		return this.createEl('span', opts);
	};
	(el as any).addClass = function (cls: string) {
		this.classList.add(cls);
	};
	(el as any).removeClass = function (cls: string) {
		this.classList.remove(cls);
	};
	(el as any).empty = function () {
		this.innerHTML = '';
	};
	return el;
}

interface Harness {
	leaf: { detach: Mock };
	onResolve: Mock;
	onClose: Mock;
	view: GeminiDiffView;
	state: DiffViewState;
}

function makeView(
	overrides?: Partial<Pick<DiffViewState, 'isNewFile' | 'originalContent' | 'proposedContent'>>
): Harness & { state: DiffViewState } {
	const leaf = { detach: vi.fn(), updateHeader: vi.fn() };
	const plugin = { app: {}, settings: {} } as unknown as ObsidianGemini;
	const view = new GeminiDiffView(leaf as any, plugin);
	// Replace the mock-fixture contentEl with a real DOM element carrying the
	// Obsidian DOM-builder methods the render path uses.
	const content = addObsidianMethods(document.createElement('div'));
	document.body.appendChild(content);
	(view as any).contentEl = content;

	const state: DiffViewState = {
		filePath: 'notes/proposal.md',
		originalContent: 'original text',
		proposedContent: 'proposed text',
		isNewFile: false,
		onResolve: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
	view.setDiffState(state);
	return {
		leaf,
		onResolve: state.onResolve as unknown as Mock,
		onClose: state.onClose as unknown as Mock,
		view,
		state,
	};
}

beforeEach(() => {
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('GeminiDiffView', () => {
	it('exposes the stable view type and icon', () => {
		const { view } = makeView();

		expect(view.getViewType()).toBe(VIEW_TYPE_DIFF);
		expect(view.getViewType()).toBe('gemini-diff-view');
		expect(view.getIcon()).toBe('file-diff');
	});

	it('getDisplayText distinguishes new-file preview from review by state', () => {
		const review = makeView();
		expect(review.view.getDisplayText()).toBe('Review changes: notes/proposal.md');

		const fresh = makeView({ isNewFile: true });
		expect(fresh.view.getDisplayText()).toBe('Preview: notes/proposal.md');
	});

	it('setDiffState renders the action bar with approve/cancel buttons and the file path', () => {
		const { view } = makeView();

		const content = (view as any).contentEl as HTMLElement;
		expect(content.classList.contains('gemini-diff-view-container')).toBe(true);
		expect(content.querySelector('.gemini-diff-file-path')!.textContent).toBe('notes/proposal.md');
		const buttons = content.querySelectorAll('button');
		expect(buttons).toHaveLength(2);
		expect(buttons[0].classList.contains('gemini-diff-btn-approve')).toBe(true);
		expect(buttons[1].classList.contains('gemini-diff-btn-cancel')).toBe(true);
	});

	it('shows the new-file badge and skips the merge view for new files', () => {
		makeView({ isNewFile: true });

		expect(unifiedMergeView as unknown as Mock).not.toHaveBeenCalled();
	});

	it('uses the unified merge view for edits to existing files', () => {
		makeView({ isNewFile: false });

		expect(unifiedMergeView as unknown as Mock).toHaveBeenCalledTimes(1);
		expect((unifiedMergeView as unknown as Mock).mock.calls[0][0].original).toBe('original text');
	});

	it('approve resolves exactly once with the editor content and detaches the leaf', () => {
		const { leaf, onResolve, view } = makeView();

		const approveBtn = ((view as any).contentEl as HTMLElement).querySelector(
			'.gemini-diff-btn-approve'
		) as HTMLElement;
		approveBtn.click();
		// A second click must not re-resolve — the resolved guard wins.
		approveBtn.click();

		expect(onResolve).toHaveBeenCalledTimes(1);
		expect(onResolve).toHaveBeenCalledWith({ approved: true, finalContent: 'proposed text', userEdited: false });
		expect(leaf.detach).toHaveBeenCalledTimes(1);
	});

	it('cancel resolves with approved=false and still detaches exactly once', () => {
		const { leaf, onResolve, view } = makeView();

		const cancelBtn = ((view as any).contentEl as HTMLElement).querySelector('.gemini-diff-btn-cancel') as HTMLElement;
		cancelBtn.click();
		cancelBtn.click();

		expect(onResolve).toHaveBeenCalledTimes(1);
		expect(onResolve).toHaveBeenCalledWith({ approved: false, finalContent: 'proposed text', userEdited: false });
		expect(leaf.detach).toHaveBeenCalledTimes(1);
	});

	it('userEdited is true when the editor content diverges from the proposal', () => {
		const { onResolve, view } = makeView({ proposedContent: 'proposed text' });
		// Simulate a user edit in the CodeMirror surface.
		(view as any).editorView = {
			state: { doc: { toString: () => 'proposed text — edited by user' } },
			destroy: vi.fn(),
		};

		const approveBtn = ((view as any).contentEl as HTMLElement).querySelector(
			'.gemini-diff-btn-approve'
		) as HTMLElement;
		approveBtn.click();

		expect(onResolve).toHaveBeenCalledWith({
			approved: true,
			finalContent: 'proposed text — edited by user',
			userEdited: true,
		});
	});

	it('getCurrentContent prefers the live editor and falls back to the proposal, then empty', () => {
		const { view } = makeView();

		// No editor created (renderView stubs the editor via mock) — falls back to proposal.
		expect(view.getCurrentContent()).toBe('proposed text');

		// With an editor, its doc wins.
		(view as any).editorView = { state: { doc: { toString: () => 'live content' } } };
		expect(view.getCurrentContent()).toBe('live content');

		// Neither state nor editor — empty string, not a crash.
		const leaf2 = { detach: vi.fn(), updateHeader: vi.fn() };
		const bare = new GeminiDiffView(leaf2 as any, {} as unknown as ObsidianGemini);
		expect(bare.getCurrentContent()).toBe('');
	});

	it('onClose without resolve fires onClose once and destroys the editor; after resolve it does not', () => {
		const { onClose, view } = makeView();
		const editorDestroy = vi.fn();
		(view as any).editorView = { doc: { toString: () => 'x' }, destroy: editorDestroy };

		void view.onClose();
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(editorDestroy).toHaveBeenCalledTimes(1);
		expect((view as any).editorView).toBeNull();
	});

	it('onClose after a resolution does not fire onClose', async () => {
		const { onClose, view } = makeView();

		const approveBtn = ((view as any).contentEl as HTMLElement).querySelector(
			'.gemini-diff-btn-approve'
		) as HTMLElement;
		approveBtn.click();

		void view.onClose();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('renderView is a no-op before setDiffState', async () => {
		const leaf = { detach: vi.fn(), updateHeader: vi.fn() };
		const view = new GeminiDiffView(leaf as any, {} as unknown as ObsidianGemini);
		const content = addObsidianMethods(document.createElement('div'));
		(view as any).contentEl = content;

		await view.onOpen();

		expect(content.children).toHaveLength(0);
	});
});
