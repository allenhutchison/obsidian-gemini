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
	ModelClientFactory: { createSummaryModel: vi.fn() },
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

// ---------------------------------------------------------------------------
// Additional coverage blocks
// ---------------------------------------------------------------------------

describe('ImageGeneration.validateOutputPath – edge cases', () => {
	let service: ImageGeneration;

	const validate = (path: string): string => (service as any).validateOutputPath(path);

	const createService = (historyFolder: string | undefined) => {
		const mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder, temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		} as any;
		return new ImageGeneration(mockPlugin);
	};

	beforeEach(() => {
		service = createService('gemini-scribe');
	});

	it('does NOT throw for a trailing slash because normalizePath strips it', () => {
		// normalizePath('foo/') → 'foo' which is a valid filename
		expect(validate('foo/')).toBe('foo.png');
	});

	it('throws when the path is whitespace-only (normalizes to "/")', () => {
		// normalizePath('   ') → '/' which ends with '/'
		expect(() => validate('   ')).toThrow('Output path must include a filename');
	});

	it('rejects a path with ".." in middle segments', () => {
		expect(() => validate('foo/../bar.png')).toThrow('escapes the vault');
	});

	it('rejects a path inside the historyFolder (not in Background-Tasks/)', () => {
		// 'gemini-scribe/foo.png' is inside the state folder but NOT in Background-Tasks/
		expect(() => validate('gemini-scribe/foo.png')).toThrow('plugin state folder');
	});

	it('skips the state-folder check when historyFolder is empty/falsy', () => {
		service = createService('');
		// A path that would normally collide with a state folder works fine.
		expect(validate('gemini-scribe/Skills/foo.png')).toBe('gemini-scribe/Skills/foo.png');
	});

	it('skips the state-folder check when historyFolder is undefined', () => {
		service = createService(undefined);
		expect(validate('gemini-scribe/Agent-Sessions/foo.png')).toBe('gemini-scribe/Agent-Sessions/foo.png');
	});
});

describe('ImageGeneration.resolveOutputPath', () => {
	let service: ImageGeneration;

	beforeEach(() => {
		const mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('delegates to validateOutputPath when an explicit outputPath is given', async () => {
		const validateSpy = vi.spyOn(service as any, 'validateOutputPath');
		const result = await service.resolveOutputPath('prompt', 'images/test.jpg');
		expect(validateSpy).toHaveBeenCalledWith('images/test.jpg');
		// Extension rewritten to .png
		expect(result).toBe('images/test.png');
	});

	it('delegates to resolveDefaultOutputPath when no outputPath is given', async () => {
		const defaultSpy = vi.spyOn(service as any, 'resolveDefaultOutputPath');
		const result = await service.resolveOutputPath('a sunset');
		expect(defaultSpy).toHaveBeenCalledWith('a sunset');
		expect(result).toMatch(/^gemini-scribe\/Background-Tasks\/generated-.*\.png$/);
	});
});

describe('ImageGeneration.resolveDefaultOutputPath', () => {
	let service: ImageGeneration;

	beforeEach(() => {
		const mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'my-state', temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('returns a path under [historyFolder]/Background-Tasks/ with a generated filename', async () => {
		const result = await service.resolveDefaultOutputPath('a beautiful sunset');
		expect(result).toMatch(/^my-state\/Background-Tasks\/generated-a-beautiful-sunset-\d+-[a-z0-9]+\.png$/);
	});

	it('sanitizes special characters in the prompt', async () => {
		const result = await service.resolveDefaultOutputPath('Hello, World! @#$ test');
		// Special chars replaced with hyphens, then consecutive hyphens collapsed, leading/trailing stripped
		expect(result).toMatch(/^my-state\/Background-Tasks\/generated-Hello-World-test-\d+-[a-z0-9]+\.png$/);
	});

	it('truncates long prompts to 50 characters before sanitization', async () => {
		const longPrompt = 'a'.repeat(100);
		const result = await service.resolveDefaultOutputPath(longPrompt);
		const filename = result.split('/').pop()!;
		// "generated-" + 50 a's + "-" + timestamp + "-" + random + ".png"
		expect(filename.startsWith('generated-')).toBe(true);
		// The 'a' portion should be max 50 chars
		const sanitizedPart = filename.replace(/^generated-/, '').split('-')[0];
		expect(sanitizedPart.length).toBeLessThanOrEqual(50);
	});
});

describe('ImageGeneration.saveImageToVault (private)', () => {
	let service: ImageGeneration;
	let createBinaryMock: ReturnType<typeof vi.fn>;
	let mockPlugin: any;

	const save = (base64: string, prompt: string, outputPath?: string): Promise<string> =>
		(service as any).saveImageToVault(base64, prompt, outputPath);

	beforeEach(() => {
		vi.clearAllMocks();
		createBinaryMock = vi.fn().mockResolvedValue(undefined);
		mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			app: {
				vault: { createBinary: createBinaryMock },
			},
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('throws on invalid base64 data', async () => {
		await expect(save('!!!not-base64!!!', 'test')).rejects.toThrow('Invalid base64 image data');
	});

	it('throws on empty base64 data (decodes to empty string)', async () => {
		const emptyBase64 = btoa('');
		await expect(save(emptyBase64, 'test')).rejects.toThrow(/Invalid base64 image data.*Empty image data/);
	});

	it('calls validateOutputPath and ensureFolderExists when an explicit outputPath is provided', async () => {
		const { ensureFolderExists } = await import('../../src/utils/file-utils');
		const validBase64 = btoa('fake-png-data');

		const result = await save(validBase64, 'test', 'images/subfolder/out.jpg');

		expect(result).toBe('images/subfolder/out.png');
		expect(ensureFolderExists).toHaveBeenCalledWith(
			mockPlugin.app.vault,
			'images/subfolder',
			'image output folder',
			mockPlugin.logger
		);
		expect(createBinaryMock).toHaveBeenCalledWith('images/subfolder/out.png', expect.any(ArrayBuffer));
	});

	it('resolves the default path when no outputPath is provided', async () => {
		const validBase64 = btoa('fake-png-data');
		const result = await save(validBase64, 'my prompt');

		expect(result).toMatch(/^gemini-scribe\/Background-Tasks\/generated-my-prompt-\d+-[a-z0-9]+\.png$/);
		expect(createBinaryMock).toHaveBeenCalled();
	});

	it('does NOT call ensureFolderExists when file is in the vault root (no slash in path)', async () => {
		const { ensureFolderExists } = await import('../../src/utils/file-utils');
		const validBase64 = btoa('fake-png-data');

		await save(validBase64, 'test', 'root-image.png');

		expect(ensureFolderExists).not.toHaveBeenCalled();
		expect(createBinaryMock).toHaveBeenCalledWith('root-image.png', expect.any(ArrayBuffer));
	});
});

describe('ImageGeneration.suggestPromptFromPage', () => {
	let service: ImageGeneration;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0 },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			gfile: { getCurrentFileContent: vi.fn() },
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('throws when there is no file content', async () => {
		mockPlugin.gfile.getCurrentFileContent.mockResolvedValue(null);
		await expect(service.suggestPromptFromPage()).rejects.toThrow('Failed to get file content');
	});

	it('calls ModelClientFactory.createSummaryModel and returns trimmed result on success', async () => {
		const { ModelClientFactory } = await import('../../src/api');

		const mockModelApi = {
			generateModelResponse: vi.fn().mockResolvedValue({ markdown: '  A beautiful cat sitting on a table  ' }),
		};
		(ModelClientFactory.createSummaryModel as ReturnType<typeof vi.fn>).mockReturnValue(mockModelApi);
		mockPlugin.gfile.getCurrentFileContent.mockResolvedValue('Some note content here');

		// Need to provide imagePromptGenerator on the prompts instance
		(service as any).prompts.imagePromptGenerator = vi.fn().mockReturnValue('generated prompt text');

		const result = await service.suggestPromptFromPage();

		expect(ModelClientFactory.createSummaryModel).toHaveBeenCalledWith(mockPlugin);
		expect(mockModelApi.generateModelResponse).toHaveBeenCalledWith({
			prompt: 'generated prompt text',
		});
		expect(result).toBe('A beautiful cat sitting on a table');
	});
});

describe('ImageGeneration.generateImage (agent tool method)', () => {
	let service: ImageGeneration;
	let createBinaryMock: ReturnType<typeof vi.fn>;
	let mockPlugin: any;
	const validBase64 = btoa('fake-png-bytes');

	beforeEach(() => {
		vi.clearAllMocks();
		createBinaryMock = vi.fn().mockResolvedValue(undefined);
		mockGenerateImageBytes.mockResolvedValue(validBase64);

		mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0, imageModelName: 'imagen-3' },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			app: {
				vault: { createBinary: createBinaryMock },
			},
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('generates an image and returns the saved path on success', async () => {
		const result = await service.generateImage('a red car');

		expect(mockGenerateImageBytes).toHaveBeenCalledWith('a red car', 'imagen-3');
		expect(createBinaryMock).toHaveBeenCalled();
		expect(result).toMatch(/\.png$/);
	});

	it('generates an image at an explicit output path', async () => {
		const result = await service.generateImage('a blue car', 'photos/car.jpg');

		expect(result).toBe('photos/car.png');
		expect(createBinaryMock).toHaveBeenCalledWith('photos/car.png', expect.any(ArrayBuffer));
	});

	it('logs the error and rethrows when client.generateImage fails', async () => {
		const error = new Error('API quota exceeded');
		mockGenerateImageBytes.mockRejectedValue(error);

		await expect(service.generateImage('fail prompt')).rejects.toThrow('API quota exceeded');
		expect(mockPlugin.logger.error).toHaveBeenCalledWith('Failed to generate image:', error);
	});
});

describe('ImageGeneration.generateAndInsertSynchronously – error path', () => {
	let service: ImageGeneration;
	let mockEditor: any;
	let activeView: any;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockEditor = {
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			replaceRange: vi.fn(),
		};
		activeView = { file: { path: 'test.md' }, editor: mockEditor };

		mockPlugin = {
			apiKey: 'test-key',
			settings: { historyFolder: 'gemini-scribe', temperature: 0, topP: 0, imageModelName: 'imagen-3' },
			logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
			backgroundTaskManager: null, // force synchronous path
			app: {
				vault: { createBinary: vi.fn() },
				workspace: {
					getActiveViewOfType: vi.fn().mockReturnValue(activeView),
				},
			},
		} as any;
		service = new ImageGeneration(mockPlugin);
	});

	it('catches the error, logs it, and shows a Notice when generateImage throws', async () => {
		const error = new Error('Render pipeline exploded');
		mockGenerateImageBytes.mockRejectedValue(error);

		// generateAndInsertImage with null backgroundTaskManager → synchronous path
		await service.generateAndInsertImage('error prompt');

		// Should NOT throw — error is caught internally
		// getErrorMessage wraps the raw message, so check for the prefix
		expect(mockPlugin.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to generate image'), error);
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Failed to generate image'));
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Render pipeline exploded'));
		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
	});
});
