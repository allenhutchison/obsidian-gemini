/**
 * Tests for AppendContentTool — moved here from the former flat
 * `test/tools/vault-tools-extended.test.ts` alongside the tool's move into
 * `src/tools/vault/` (#1310). The tool resolves paths through the shared
 * `resolvePathToFile`, so these tests exercise real resolution against a mock
 * vault (direct paths, .md fallback, wikilinks, system-folder exclusion).
 */
import { TFile } from 'obsidian';
import { AppendContentTool, getVaultTools } from '../../../src/tools/vault';
import type { Tool } from '../../../src/tools/types';
import { ToolExecutionContext } from '../../../src/tools/types';
import { ToolCategory } from '../../../src/types/agent';
import { ToolClassification } from '../../../src/types/tool-policy';

/** Tool narrowed to include the optional methods these tests exercise. */
type ToolWithOptionals = Tool & {
	getProgressDescription: NonNullable<Tool['getProgressDescription']>;
	confirmationMessage: NonNullable<Tool['confirmationMessage']>;
	buildDiffContext: NonNullable<Tool['buildDiffContext']>;
	applyConfirmedEdit: NonNullable<Tool['applyConfirmedEdit']>;
};

let tool: ToolWithOptionals;

function getTool(): ToolWithOptionals {
	const candidates: Tool[] = [new AppendContentTool()];
	const found = candidates.find((t): t is ToolWithOptionals => {
		return (
			typeof t.getProgressDescription === 'function' &&
			typeof t.confirmationMessage === 'function' &&
			typeof t.buildDiffContext === 'function' &&
			typeof t.applyConfirmedEdit === 'function'
		);
	});
	if (!found) {
		throw new Error('AppendContentTool is missing the optional methods the tests exercise');
	}
	tool = found;
	return found;
}

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../../__mocks__/obsidian.js')),
}));

// ─── Shared helpers ──────────────────────────────────────────────────────────

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: {
				configDir: '.obsidian',
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				getFiles: vi.fn().mockReturnValue([]),
				modify: vi.fn().mockResolvedValue(undefined),
				read: vi.fn().mockResolvedValue(''),
				append: vi.fn().mockResolvedValue(undefined),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
			fileManager: {
				processFrontMatter: vi.fn().mockImplementation(async (_file: any, mutator: (fm: any) => void) => {
					mutator({});
				}),
			},
		},
		settings: {
			historyFolder: 'gemini-scribe',
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		},
		...overrides,
	};
}

function makeContext(plugin: any): ToolExecutionContext {
	return { plugin } as unknown as ToolExecutionContext;
}

function makeTFile(path: string, extension = 'md'): TFile {
	const file = new TFile();
	(file as any).path = path;
	(file as any).name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
	(file as any).basename = (file as any).name.replace(/\.[^.]+$/, '');
	(file as any).extension = extension;
	return file;
}

describe('AppendContentTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getTool();
	});

	// ── Static properties ────────────────────────────────────────────────

	it('has correct metadata', () => {
		expect(tool.name).toBe('append_content');
		expect(tool.displayName).toBe('Append Content');
		expect(tool.category).toBe(ToolCategory.VAULT_OPERATIONS);
		expect(tool.classification).toBe(ToolClassification.WRITE);
		expect(tool.requiresConfirmation).toBe(true);
	});

	it('confirmationMessage formats params and truncates long content', () => {
		const shortMsg = tool.confirmationMessage({ path: 'notes/foo.md', content: 'hello' });
		expect(shortMsg).toContain('notes/foo.md');
		expect(shortMsg).toContain('hello');

		const longContent = 'x'.repeat(300);
		const longMsg = tool.confirmationMessage({ path: 'notes/foo.md', content: longContent });
		expect(longMsg).toContain('...');
	});

	it('getProgressDescription shows path when available', () => {
		expect(tool.getProgressDescription({ path: 'notes/foo.md' })).toBe('Appending to notes/foo.md');
	});

	it('getProgressDescription shows generic when path is empty', () => {
		expect(tool.getProgressDescription({ path: '' })).toBe('Appending content');
	});

	// ── Successful append ────────────────────────────────────────────────

	it('appends content to a file found by direct path', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.vault.read.mockResolvedValue('existing content');

		const result = await tool.execute({ path: 'notes/foo.md', content: 'new text' }, makeContext(plugin));

		expect(result.success).toBe(true);
		expect(result.data.action).toBe('appended');
		expect(plugin.app.vault.append).toHaveBeenCalledWith(file, '\nnew text');
	});

	it('does not prepend newline when file ends with newline', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.vault.read.mockResolvedValue('existing content\n');

		await tool.execute({ path: 'notes/foo.md', content: 'new text' }, makeContext(plugin));

		expect(plugin.app.vault.append).toHaveBeenCalledWith(file, 'new text');
	});

	it('does not prepend newline when content starts with newline', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.vault.read.mockResolvedValue('existing content');

		await tool.execute({ path: 'notes/foo.md', content: '\nnew text' }, makeContext(plugin));

		expect(plugin.app.vault.append).toHaveBeenCalledWith(file, '\nnew text');
	});

	it('does not prepend newline when file is empty', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.vault.read.mockResolvedValue('');

		await tool.execute({ path: 'notes/foo.md', content: 'first content' }, makeContext(plugin));

		expect(plugin.app.vault.append).toHaveBeenCalledWith(file, 'first content');
	});

	// ── .md extension fallback ───────────────────────────────────────────

	it('appends .md when the path is missing the extension', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'notes/foo.md' ? file : null));
		plugin.app.vault.read.mockResolvedValue('');

		const result = await tool.execute({ path: 'notes/foo', content: 'new' }, makeContext(plugin));
		expect(result.success).toBe(true);
	});

	// ── Wikilink resolution ──────────────────────────────────────────────

	it('resolves wikilink paths', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(file);
		plugin.app.vault.read.mockResolvedValue('');

		const result = await tool.execute({ path: '[[foo]]', content: 'appended' }, makeContext(plugin));
		expect(result.success).toBe(true);
	});

	// ── _replaceFullContent ──────────────────────────────────────────────

	it('replaces full content when _replaceFullContent is set', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const result = await tool.execute(
			{ path: 'notes/foo.md', content: 'replaced', _replaceFullContent: true },
			makeContext(plugin)
		);

		expect(result.success).toBe(true);
		expect(result.data.action).toBe('replaced');
		expect(result.data.userEdited).toBe(false);
		expect(plugin.app.vault.modify).toHaveBeenCalledWith(file, 'replaced');
		expect(plugin.app.vault.append).not.toHaveBeenCalled();
	});

	it('sets userEdited flag when _userEdited is true', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const result = await tool.execute(
			{ path: 'notes/foo.md', content: 'edited', _replaceFullContent: true, _userEdited: true },
			makeContext(plugin)
		);

		expect(result.data.userEdited).toBe(true);
	});

	// ── System folder exclusion ──────────────────────────────────────────

	it('rejects paths inside the history folder', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('gemini-scribe/some.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		const result = await tool.execute({ path: 'gemini-scribe/some.md', content: 'x' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('File not found');
		expect(plugin.app.vault.append).not.toHaveBeenCalled();
		expect(plugin.app.vault.modify).not.toHaveBeenCalled();
	});

	it('rejects wikilink that resolves to a file inside the history folder', async () => {
		// Regression for issue #910: a bare wikilink like "Foo" could resolve via
		// metadataCache.getFirstLinkpathDest() to a file inside gemini-scribe/Skills/,
		// and the prior inline resolver skipped the exclusion check on the resolved path,
		// letting vault.append() write into the plugin's state folder.
		const plugin = createMockPlugin();
		const skillFile = makeTFile('gemini-scribe/Skills/Foo/SKILL.md');
		plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(skillFile);
		const result = await tool.execute({ path: 'Foo', content: 'appended' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('File not found');
		expect(plugin.app.vault.append).not.toHaveBeenCalled();
		expect(plugin.app.vault.modify).not.toHaveBeenCalled();
	});

	// ── File not found ───────────────────────────────────────────────────

	it('returns error when file is not found', async () => {
		const plugin = createMockPlugin();
		const result = await tool.execute({ path: 'nonexistent.md', content: 'x' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('File not found');
	});

	it('returns error when resolved file is not a TFile', async () => {
		const plugin = createMockPlugin();
		// Return a non-TFile object (e.g. a folder)
		plugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: 'folder' });
		const result = await tool.execute({ path: 'folder', content: 'x' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('File not found');
	});

	// ── Error handling ───────────────────────────────────────────────────

	it('catches errors and returns a failure result', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.vault.read.mockRejectedValue(new Error('Read failed'));

		const result = await tool.execute({ path: 'notes/foo.md', content: 'x' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('Read failed');
	});

	it('handles non-Error thrown values', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.vault.read.mockRejectedValue('string error');

		const result = await tool.execute({ path: 'notes/foo.md', content: 'x' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('Unknown error');
	});

	// ── buildDiffContext (ported from the former flat test file) ─────────

	describe('buildDiffContext', () => {
		it('builds proposed = original + content, mirroring the newline insertion', async () => {
			const plugin = createMockPlugin();
			const file = makeTFile('notes/log.md');
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
			// safeReadFileForDiff reads through vault.read
			plugin.app.vault.read.mockResolvedValue('existing content');

			const diff = await getTool().buildDiffContext({ path: 'notes/log', content: 'new line' }, makeContext(plugin));

			expect(diff).toBeDefined();
			expect(diff!.filePath).toBe('notes/log.md');
			expect(diff!.originalContent).toBe('existing content');
			expect(diff!.proposedContent).toBe('existing content\nnew line');
			expect(diff!.isNewFile).toBe(false);
		});

		it('does not insert a newline when the original already ends with one', async () => {
			const plugin = createMockPlugin();
			const file = makeTFile('notes/log.md');
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
			plugin.app.vault.read.mockResolvedValue('existing content\n');

			const diff = await getTool().buildDiffContext({ path: 'notes/log', content: 'new line' }, makeContext(plugin));

			expect(diff!.proposedContent).toBe('existing content\nnew line');
		});

		it('returns undefined when the file cannot be resolved', async () => {
			const plugin = createMockPlugin();

			const diff = await getTool().buildDiffContext({ path: 'missing', content: 'text' }, makeContext(plugin));

			expect(diff).toBeUndefined();
		});

		it('returns undefined when content is missing', async () => {
			const plugin = createMockPlugin();

			const diff = await getTool().buildDiffContext({ path: 'notes/log' }, makeContext(plugin));

			expect(diff).toBeUndefined();
		});
	});

	// ── applyConfirmedEdit (ported from the former flat test file) ───────

	describe('applyConfirmedEdit', () => {
		it('flips to full-overwrite mode when the user edited the diff', () => {
			const params: Record<string, unknown> = { path: 'notes/log', content: 'suffix' };
			getTool().applyConfirmedEdit(params, {
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
			getTool().applyConfirmedEdit(params, {
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

// ─── Registration (#1310: the moved tools keep their registration order) ─────

describe('vault tool registration', () => {
	it('registers the moved tools last, in their previous order', () => {
		const tools = getVaultTools();
		expect(tools).toHaveLength(11);
		expect(tools.slice(-2).map((t) => t.name)).toEqual(['update_frontmatter', 'append_content']);
	});
});
