import { TFile } from 'obsidian';
import { getExtendedVaultTools } from '../../src/tools/vault-tools-extended';
import { Tool, ToolExecutionContext } from '../../src/tools/types';
import { resolvePathToFile, safeReadFileForDiff } from '../../src/tools/vault/utils';

// The two extended vault tools resolve paths through resolvePathToFile; mock it
// (and the diff-preview read helper) so the tests exercise the tools' own
// branching (JSON parsing, newline handling, replace-vs-append, diff building)
// without depending on the full vault-resolution machinery.
vi.mock('../../src/tools/vault/utils', () => ({
	resolvePathToFile: vi.fn(),
	safeReadFileForDiff: vi.fn(),
}));

const mockResolvePathToFile = vi.mocked(resolvePathToFile);
const mockSafeReadFileForDiff = vi.mocked(safeReadFileForDiff);

// Captures the frontmatter object handed to the processFrontMatter callback so
// tests can assert the native value that was written.
let capturedFrontmatter: Record<string, any> = {};
const mockProcessFrontMatter = vi.fn(async (_file: TFile, cb: (fm: Record<string, any>) => void) => {
	capturedFrontmatter = {};
	cb(capturedFrontmatter);
});

const mockVault = {
	modify: vi.fn().mockResolvedValue(undefined),
	append: vi.fn().mockResolvedValue(undefined),
	read: vi.fn().mockResolvedValue(''),
};

const mockPlugin = {
	app: {
		fileManager: {
			processFrontMatter: mockProcessFrontMatter,
		},
		vault: mockVault,
	},
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
	},
} as any;

const mockContext: ToolExecutionContext = {
	plugin: mockPlugin,
	session: {
		id: 'test-session',
		type: 'agent-session',
		context: {
			contextFiles: [],
			contextDepth: 2,
			enabledTools: [],
			requireConfirmation: [],
		},
	},
} as any;

/** Build a TFile-shaped object with the fields the extended tools read. */
function makeFile(path: string, extension = 'md'): TFile {
	const file = new TFile();
	file.path = path;
	file.extension = extension;
	return file;
}

function getTools(): { updateFrontmatter: Tool; appendContent: Tool } {
	const tools = getExtendedVaultTools();
	return { updateFrontmatter: tools[0], appendContent: tools[1] };
}

describe('vault-tools-extended', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockVault.modify.mockResolvedValue(undefined);
		mockVault.append.mockResolvedValue(undefined);
		mockVault.read.mockResolvedValue('');
		mockProcessFrontMatter.mockImplementation(async (_file: TFile, cb: (fm: Record<string, any>) => void) => {
			capturedFrontmatter = {};
			cb(capturedFrontmatter);
		});
	});

	describe('getExtendedVaultTools', () => {
		it('returns exactly the two extended tools in the declared order', () => {
			const tools = getExtendedVaultTools();
			expect(tools).toHaveLength(2);
			expect(tools[0].name).toBe('update_frontmatter');
			expect(tools[1].name).toBe('append_content');
		});
	});

	describe('UpdateFrontmatterTool', () => {
		it('parses a stringified JSON array into a native list', async () => {
			mockResolvePathToFile.mockReturnValue({ file: makeFile('notes/test.md') });

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'notes/test', key: 'tags', value: '["a","b"]' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.value).toEqual(['a', 'b']);
			expect(capturedFrontmatter.tags).toEqual(['a', 'b']);
		});

		it('parses a stringified JSON boolean into a native boolean', async () => {
			mockResolvePathToFile.mockReturnValue({ file: makeFile('notes/test.md') });

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'notes/test', key: 'published', value: 'true' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.value).toBe(true);
			expect(capturedFrontmatter.published).toBe(true);
		});

		it('parses a stringified JSON number into a native number', async () => {
			mockResolvePathToFile.mockReturnValue({ file: makeFile('notes/test.md') });

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'notes/test', key: 'rating', value: '42' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.value).toBe(42);
			expect(capturedFrontmatter.rating).toBe(42);
		});

		it('falls back to a plain string when the value is not valid JSON', async () => {
			mockResolvePathToFile.mockReturnValue({ file: makeFile('notes/test.md') });

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'notes/test', key: 'status', value: 'In Progress' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.value).toBe('In Progress');
			expect(capturedFrontmatter.status).toBe('In Progress');
		});

		it('returns failure for a non-markdown file without touching frontmatter', async () => {
			mockResolvePathToFile.mockReturnValue({ file: makeFile('notes/data.txt', 'txt') });

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'notes/data.txt', key: 'status', value: 'done' },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not a markdown file');
			expect(mockProcessFrontMatter).not.toHaveBeenCalled();
		});

		it('returns failure when the file cannot be resolved', async () => {
			mockResolvePathToFile.mockReturnValue({ file: null });

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'missing', key: 'status', value: 'done' },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('File not found');
			expect(mockProcessFrontMatter).not.toHaveBeenCalled();
		});

		it('propagates errors thrown by processFrontMatter as a failure result', async () => {
			mockResolvePathToFile.mockReturnValue({ file: makeFile('notes/test.md') });
			mockProcessFrontMatter.mockRejectedValueOnce(new Error('frontmatter blew up'));

			const result = await getTools().updateFrontmatter.execute(
				{ path: 'notes/test', key: 'status', value: 'done' },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('frontmatter blew up');
		});
	});

	describe('AppendContentTool', () => {
		it('prepends a newline when the file is non-empty and lacks a trailing newline', async () => {
			const file = makeFile('notes/log.md');
			mockResolvePathToFile.mockReturnValue({ file });
			mockVault.read.mockResolvedValue('existing content');

			const result = await getTools().appendContent.execute({ path: 'notes/log', content: 'new line' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.action).toBe('appended');
			expect(mockVault.append).toHaveBeenCalledWith(file, '\nnew line');
			expect(mockVault.modify).not.toHaveBeenCalled();
		});

		it('does not prepend a newline when the file already ends with one', async () => {
			const file = makeFile('notes/log.md');
			mockResolvePathToFile.mockReturnValue({ file });
			mockVault.read.mockResolvedValue('existing content\n');

			await getTools().appendContent.execute({ path: 'notes/log', content: 'new line' }, mockContext);

			expect(mockVault.append).toHaveBeenCalledWith(file, 'new line');
		});

		it('does not prepend a newline when the appended content already starts with one', async () => {
			const file = makeFile('notes/log.md');
			mockResolvePathToFile.mockReturnValue({ file });
			mockVault.read.mockResolvedValue('existing content');

			await getTools().appendContent.execute({ path: 'notes/log', content: '\nnew line' }, mockContext);

			expect(mockVault.append).toHaveBeenCalledWith(file, '\nnew line');
		});

		it('does not prepend a newline when the existing file is empty', async () => {
			const file = makeFile('notes/log.md');
			mockResolvePathToFile.mockReturnValue({ file });
			mockVault.read.mockResolvedValue('');

			await getTools().appendContent.execute({ path: 'notes/log', content: 'new line' }, mockContext);

			expect(mockVault.append).toHaveBeenCalledWith(file, 'new line');
		});

		it('overwrites via vault.modify in _replaceFullContent mode', async () => {
			const file = makeFile('notes/log.md');
			mockResolvePathToFile.mockReturnValue({ file });

			const result = await getTools().appendContent.execute(
				{ path: 'notes/log', content: 'full edited body', _replaceFullContent: true, _userEdited: true },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.action).toBe('replaced');
			expect(result.data.userEdited).toBe(true);
			expect(mockVault.modify).toHaveBeenCalledWith(file, 'full edited body');
			expect(mockVault.append).not.toHaveBeenCalled();
			expect(mockVault.read).not.toHaveBeenCalled();
		});

		it('returns failure when the file is missing', async () => {
			mockResolvePathToFile.mockReturnValue({ file: null });

			const result = await getTools().appendContent.execute({ path: 'missing', content: 'new line' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('File not found');
			expect(mockVault.append).not.toHaveBeenCalled();
			expect(mockVault.modify).not.toHaveBeenCalled();
		});

		describe('buildDiffContext', () => {
			it('builds proposed = original + content, mirroring the newline insertion', async () => {
				const file = makeFile('notes/log.md');
				mockResolvePathToFile.mockReturnValue({ file });
				mockSafeReadFileForDiff.mockResolvedValue('existing content');

				const diff = await getTools().appendContent.buildDiffContext!(
					{ path: 'notes/log', content: 'new line' },
					mockContext
				);

				expect(diff).toBeDefined();
				expect(diff!.filePath).toBe('notes/log.md');
				expect(diff!.originalContent).toBe('existing content');
				expect(diff!.proposedContent).toBe('existing content\nnew line');
				expect(diff!.isNewFile).toBe(false);
			});

			it('does not insert a newline when the original already ends with one', async () => {
				const file = makeFile('notes/log.md');
				mockResolvePathToFile.mockReturnValue({ file });
				mockSafeReadFileForDiff.mockResolvedValue('existing content\n');

				const diff = await getTools().appendContent.buildDiffContext!(
					{ path: 'notes/log', content: 'new line' },
					mockContext
				);

				expect(diff!.proposedContent).toBe('existing content\nnew line');
			});

			it('returns undefined when the file cannot be resolved', async () => {
				mockResolvePathToFile.mockReturnValue({ file: null });

				const diff = await getTools().appendContent.buildDiffContext!(
					{ path: 'missing', content: 'text' },
					mockContext
				);

				expect(diff).toBeUndefined();
			});

			it('returns undefined when content is missing', async () => {
				const diff = await getTools().appendContent.buildDiffContext!({ path: 'notes/log' }, mockContext);
				expect(diff).toBeUndefined();
			});
		});

		describe('applyConfirmedEdit', () => {
			it('flips to full-overwrite mode when the user edited the diff', () => {
				const params: Record<string, unknown> = { path: 'notes/log', content: 'suffix' };
				getTools().appendContent.applyConfirmedEdit!(params, {
					confirmed: true,
					allowWithoutConfirmation: false,
					finalContent: 'full edited body',
					userEdited: true,
				});
				expect(params.content).toBe('full edited body');
				expect(params._userEdited).toBe(true);
				expect(params._replaceFullContent).toBe(true);
			});

			it('leaves params untouched when the user approved without editing', () => {
				const params: Record<string, unknown> = { path: 'notes/log', content: 'suffix' };
				getTools().appendContent.applyConfirmedEdit!(params, {
					confirmed: true,
					allowWithoutConfirmation: false,
					finalContent: 'suffix',
					userEdited: false,
				});
				expect(params.content).toBe('suffix');
				expect(params._userEdited).toBeUndefined();
				expect(params._replaceFullContent).toBeUndefined();
			});
		});
	});
});
