import { ImageGeneration } from '../../src/services/image-generation';

// Hoist test doubles so they exist before vi.mock factories are evaluated.
const { MockTFile, MockMarkdownView, mockGenerateImageBytes } = vi.hoisted(() => {
	class MockTFile {
		path: string = '';
	}
	class MockMarkdownView {
		file: { path: string } | null = null;
		editor: any = null;
	}
	return {
		MockTFile,
		MockMarkdownView,
		mockGenerateImageBytes: vi.fn(),
	};
});

// Real obsidian mock provides Notice, Modal, normalizePath etc.
// Augment it with MarkdownView + TFile classes the production code uses.
vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../__mocks__/obsidian.js')),
	TFile: MockTFile,
	MarkdownView: MockMarkdownView,
}));

vi.mock('../../src/api', () => ({
	GeminiClient: vi.fn().mockImplementation(function () {
		return { generateImage: mockGenerateImageBytes };
	}),
	GeminiClientFactory: { createSummaryModel: vi.fn() },
}));

vi.mock('../../src/prompts', () => ({
	GeminiPrompts: vi.fn().mockImplementation(function () {
		return {};
	}),
}));

vi.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: vi.fn().mockResolvedValue(undefined),
}));

import { Notice } from 'obsidian';

describe('ImageGeneration.validateOutputPath (output-path validator)', () => {
	let service: ImageGeneration;

	// Pin the state-folder allowlist behavior added in #724: Background-Tasks/
	// is the one allowed subtree under the plugin state folder. Reach into the
	// private method directly — its contract is what callers depend on.
	const validate = (path: string): string => (service as any).validateOutputPath(path);

	beforeEach(() => {
		const mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('allows a file under [state-folder]/Background-Tasks/ and rewrites the extension to .png', () => {
		expect(validate('gemini-scribe/Background-Tasks/foo.png')).toBe('gemini-scribe/Background-Tasks/foo.png');
		expect(validate('gemini-scribe/Background-Tasks/foo.jpg')).toBe('gemini-scribe/Background-Tasks/foo.png');
		expect(validate('gemini-scribe/Background-Tasks/foo')).toBe('gemini-scribe/Background-Tasks/foo.png');
	});

	it('rejects other subfolders under the state folder', () => {
		expect(() => validate('gemini-scribe/Skills/foo.png')).toThrow(/plugin state folder/);
		expect(() => validate('gemini-scribe/Agent-Sessions/foo.png')).toThrow(/plugin state folder/);
	});

	it('rejects sibling-prefix paths that start with Background-Tasks but are not the subfolder', () => {
		// Without the trailing-slash check, "Background-Tasks-Other/foo" would
		// sneak past startsWith('Background-Tasks') — guard that.
		expect(() => validate('gemini-scribe/Background-Tasks-Other/foo.png')).toThrow(/plugin state folder/);
	});

	it('rejects bare "Background-Tasks" because the .png rewrite leaves it outside the allowed subfolder', () => {
		// The extension rewrite happens before the state-folder check, so a bare
		// "gemini-scribe/Background-Tasks" path becomes "gemini-scribe/Background-Tasks.png"
		// which does not start with "gemini-scribe/Background-Tasks/" and is therefore rejected.
		expect(() => validate('gemini-scribe/Background-Tasks')).toThrow(/plugin state folder/);
	});

	it('rejects paths inside .obsidian/', () => {
		expect(() => validate('.obsidian/snippets/foo.png')).toThrow(/Obsidian configuration folder/);
	});

	it('rejects vault-escaping paths', () => {
		expect(() => validate('../outside.png')).toThrow(/escapes the vault/);
	});

	it('allows arbitrary paths outside the state folder and forces a .png extension', () => {
		expect(validate('attachments/foo.png')).toBe('attachments/foo.png');
		expect(validate('attachments/foo.jpg')).toBe('attachments/foo.png');
		expect(validate('attachments/foo')).toBe('attachments/foo.png');
	});
});

describe('ImageGeneration.generateAndInsertImage (palette flow)', () => {
	let service: ImageGeneration;
	let activeView: InstanceType<typeof MockMarkdownView>;
	let mockEditor: { getCursor: any; replaceRange: any; lineCount: any; getLine: any };
	let mockSubmit: ReturnType<typeof vi.fn>;
	let mockPlugin: any;
	let leaves: Array<{ view: any }>;

	const createBinaryMock = vi.fn();
	const validBase64 = btoa('fake-png-bytes');

	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateImageBytes.mockResolvedValue(validBase64);

		mockEditor = {
			getCursor: vi.fn().mockReturnValue({ line: 5, ch: 3 }),
			replaceRange: vi.fn(),
			lineCount: vi.fn().mockReturnValue(20),
			getLine: vi.fn().mockReturnValue('some line content here'),
		};

		activeView = new MockMarkdownView();
		activeView.file = { path: 'notes/today.md' };
		activeView.editor = mockEditor;

		// Default: the captured note is still open in a leaf.
		leaves = [{ view: activeView }];

		mockSubmit = vi.fn().mockReturnValue('task-1');

		mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0, imageModelName: 'image-model' },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			backgroundTaskManager: { submit: mockSubmit },
			app: {
				vault: {
					createBinary: createBinaryMock,
					getAbstractFileByPath: vi.fn((path: string) => {
						const f = new MockTFile();
						f.path = path;
						return f;
					}),
				},
				workspace: {
					getActiveViewOfType: vi.fn().mockReturnValue(activeView),
					iterateAllLeaves: vi.fn((cb: (l: any) => void) => leaves.forEach(cb)),
				},
				fileManager: {},
			},
		} as any;

		service = new ImageGeneration(mockPlugin);
	});

	it('submits work to BackgroundTaskManager and returns immediately', async () => {
		await service.generateAndInsertImage('a sunset');

		expect(mockSubmit).toHaveBeenCalledWith('image-generation', 'a sunset', expect.any(Function));
		// Notice is fired synchronously to acknowledge submission.
		expect(Notice).toHaveBeenCalledWith('Image generation submitted — you can keep working.', 3000);
	});

	it('truncates long prompts in the BackgroundTaskManager label', async () => {
		const longPrompt = 'P'.repeat(60);
		await service.generateAndInsertImage(longPrompt);

		const label = mockSubmit.mock.calls[0][1] as string;
		expect(label.length).toBeLessThanOrEqual(40);
		expect(label.endsWith('…')).toBe(true);
	});

	it('inserts the wikilink at the captured cursor when the note is still open', async () => {
		await service.generateAndInsertImage('a cat');

		const work = mockSubmit.mock.calls[0][2] as (isCancelled: () => boolean) => Promise<string | undefined>;
		const result = await work(() => false);

		// Vault write happened (saveImageToVault path).
		expect(createBinaryMock).toHaveBeenCalled();
		// Wikilink inserted at the captured cursor.
		expect(mockEditor.replaceRange).toHaveBeenCalledWith(expect.stringMatching(/^!\[\[.+\.png\]\]$/), {
			line: 5,
			ch: 3,
		});
		// Returns the saved image path so the BackgroundTaskManager Notice gets
		// an "Open result" link.
		expect(result).toBeDefined();
	});

	it('falls back to a Notice with the wikilink when the captured note is no longer open', async () => {
		// User navigated away — no leaves still hold the captured file path.
		leaves = [];

		await service.generateAndInsertImage('a fox');
		const work = mockSubmit.mock.calls[0][2];
		await work(() => false);

		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith(expect.stringMatching(/Image saved.*Wikilink: !\[\[/), 10000);
	});

	it('falls back to a Notice when the captured file no longer exists', async () => {
		mockPlugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

		await service.generateAndInsertImage('a dog');
		const work = mockSubmit.mock.calls[0][2];
		await work(() => false);

		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('target note no longer exists'), 10000);
	});

	it('clamps the captured cursor to the current line length when the line shrank', async () => {
		mockEditor.getLine.mockReturnValue('short'); // 5 chars; captured ch=3 fits
		mockEditor.getCursor.mockReturnValue({ line: 5, ch: 99 }); // way past EOL

		await service.generateAndInsertImage('clamp test');
		const work = mockSubmit.mock.calls[0][2];
		await work(() => false);

		expect(mockEditor.replaceRange).toHaveBeenCalledWith(expect.any(String), { line: 5, ch: 5 });
	});

	it('falls back to the Notice path when the captured cursor line is past EOF', async () => {
		mockEditor.lineCount.mockReturnValue(3);
		mockEditor.getCursor.mockReturnValue({ line: 10, ch: 0 });

		await service.generateAndInsertImage('past EOF');
		const work = mockSubmit.mock.calls[0][2];
		await work(() => false);

		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('cursor position is no longer valid'), 10000);
	});

	it('errors early when no markdown view is active', async () => {
		mockPlugin.app.workspace.getActiveViewOfType = vi.fn().mockReturnValue(null);

		await service.generateAndInsertImage('test');

		expect(mockSubmit).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith('No active note. Please open a note first.');
	});

	it('skips insertion (but keeps the file) when cancelled after the image is saved', async () => {
		await service.generateAndInsertImage('cancelled mid-flight');
		const work = mockSubmit.mock.calls[0][2];

		// Cancel after the image is saved but before insertion.
		let calls = 0;
		const isCancelled = () => {
			calls++;
			// First two checks (start, post-generate) → not cancelled.
			// Third check (post-save) → cancelled.
			return calls >= 3;
		};
		const result = await work(isCancelled);

		expect(createBinaryMock).toHaveBeenCalled();
		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		// Returns the path so the user can still find the file.
		expect(result).toBeDefined();
	});

	it('falls back to the synchronous flow when BackgroundTaskManager is unavailable', async () => {
		mockPlugin.backgroundTaskManager = null;

		await service.generateAndInsertImage('startup race');

		// No background submit — work runs inline.
		expect(mockSubmit).not.toHaveBeenCalled();
		expect(createBinaryMock).toHaveBeenCalled();
		expect(mockEditor.replaceRange).toHaveBeenCalled();
	});
});
