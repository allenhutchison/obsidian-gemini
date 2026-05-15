import { TFile } from 'obsidian';
import { getExtendedVaultTools } from '../../../src/tools/vault-tools-extended';
import type { Tool } from '../../../src/tools/types';
import { ToolExecutionContext } from '../../../src/tools/types';
import { ToolCategory } from '../../../src/types/agent';
import { ToolClassification } from '../../../src/types/tool-policy';

vi.mock('obsidian', async () => ({
	...(await vi.importActual<any>('../../../__mocks__/obsidian.js')),
}));

// ─── Shared helpers ──────────────────────────────────────────────────────────

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
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

// ─── UpdateFrontmatterTool ───────────────────────────────────────────────────

describe('UpdateFrontmatterTool', () => {
	let tool: Tool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = getExtendedVaultTools().find((t) => t.name === 'update_frontmatter')!;
	});

	// ── Static properties ────────────────────────────────────────────────

	it('has correct metadata', () => {
		expect(tool.name).toBe('update_frontmatter');
		expect(tool.displayName).toBe('Update Frontmatter');
		expect(tool.category).toBe(ToolCategory.VAULT_OPERATIONS);
		expect(tool.classification).toBe(ToolClassification.WRITE);
		expect(tool.requiresConfirmation).toBe(true);
	});

	it('confirmationMessage formats params', () => {
		const msg = tool.confirmationMessage!({ path: 'notes/foo.md', key: 'status', value: 'done' });
		expect(msg).toContain('notes/foo.md');
		expect(msg).toContain('status');
		expect(msg).toContain('done');
	});

	it('getProgressDescription shows path when available', () => {
		expect(tool.getProgressDescription({ path: 'notes/foo.md', key: 'k' })).toBe(
			'Updating frontmatter in notes/foo.md'
		);
	});

	it('getProgressDescription shows generic when path is empty', () => {
		expect(tool.getProgressDescription({ path: '', key: '' })).toBe('Updating frontmatter');
	});

	// ── Successful update ────────────────────────────────────────────────

	it('updates frontmatter on a direct-path file', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const captured: Record<string, any> = {};
		plugin.app.fileManager.processFrontMatter.mockImplementation(async (_f: any, mutator: (fm: any) => void) => {
			mutator(captured);
		});

		const result = await tool.execute({ path: 'notes/foo.md', key: 'status', value: 'done' }, makeContext(plugin));

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ path: 'notes/foo.md', key: 'status', value: 'done', action: 'updated' });
		expect(captured['status']).toBe('done');
	});

	// ── .md extension fallback ───────────────────────────────────────────

	it('appends .md when the path is missing the extension', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockImplementation((p: string) => (p === 'notes/foo.md' ? file : null));

		const result = await tool.execute({ path: 'notes/foo', key: 'tags', value: '["a"]' }, makeContext(plugin));
		expect(result.success).toBe(true);
		expect(plugin.app.vault.getAbstractFileByPath).toHaveBeenCalledWith('notes/foo');
		expect(plugin.app.vault.getAbstractFileByPath).toHaveBeenCalledWith('notes/foo.md');
	});

	// ── Wikilink resolution ──────────────────────────────────────────────

	it('resolves wikilink paths', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(file);

		const result = await tool.execute({ path: '[[foo]]', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(true);
		expect(plugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('foo', '');
	});

	// ── System folder exclusion ──────────────────────────────────────────

	it('rejects paths inside the history folder', async () => {
		const plugin = createMockPlugin();
		const result = await tool.execute({ path: 'gemini-scribe/some.md', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('system folder');
	});

	it('rejects .obsidian paths', async () => {
		const plugin = createMockPlugin();
		const result = await tool.execute({ path: '.obsidian/config.json', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('system folder');
	});

	// ── File not found ───────────────────────────────────────────────────

	it('returns error when file is not found by any method', async () => {
		const plugin = createMockPlugin();
		const result = await tool.execute({ path: 'nonexistent.md', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
	});

	it('returns error when resolved file is not a TFile', async () => {
		const plugin = createMockPlugin();
		// Return a non-TFile object
		plugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: 'folder' });
		const result = await tool.execute({ path: 'folder', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('not found or is not a markdown file');
	});

	it('returns error when file has a non-md extension', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('image.png', 'png');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		const result = await tool.execute({ path: 'image.png', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('not a markdown file');
	});

	// ── JSON value parsing ───────────────────────────────────────────────

	it('parses JSON array strings into native arrays', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const captured: Record<string, any> = {};
		plugin.app.fileManager.processFrontMatter.mockImplementation(async (_f: any, mutator: (fm: any) => void) => {
			mutator(captured);
		});

		await tool.execute({ path: 'notes/foo.md', key: 'tags', value: '["a", "b"]' }, makeContext(plugin));
		expect(captured['tags']).toEqual(['a', 'b']);
	});

	it('parses JSON number strings into native numbers', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const captured: Record<string, any> = {};
		plugin.app.fileManager.processFrontMatter.mockImplementation(async (_f: any, mutator: (fm: any) => void) => {
			mutator(captured);
		});

		await tool.execute({ path: 'notes/foo.md', key: 'count', value: '42' }, makeContext(plugin));
		expect(captured['count']).toBe(42);
	});

	it('parses JSON boolean strings into native booleans', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const captured: Record<string, any> = {};
		plugin.app.fileManager.processFrontMatter.mockImplementation(async (_f: any, mutator: (fm: any) => void) => {
			mutator(captured);
		});

		await tool.execute({ path: 'notes/foo.md', key: 'done', value: 'true' }, makeContext(plugin));
		expect(captured['done']).toBe(true);
	});

	it('keeps non-JSON strings as plain strings', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const captured: Record<string, any> = {};
		plugin.app.fileManager.processFrontMatter.mockImplementation(async (_f: any, mutator: (fm: any) => void) => {
			mutator(captured);
		});

		await tool.execute({ path: 'notes/foo.md', key: 'title', value: 'Hello World' }, makeContext(plugin));
		expect(captured['title']).toBe('Hello World');
	});

	it('passes non-string values through without parsing', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);

		const captured: Record<string, any> = {};
		plugin.app.fileManager.processFrontMatter.mockImplementation(async (_f: any, mutator: (fm: any) => void) => {
			mutator(captured);
		});

		// When value is already a number (not a string), skip parsing
		await tool.execute({ path: 'notes/foo.md', key: 'num', value: 99 as any }, makeContext(plugin));
		expect(captured['num']).toBe(99);
	});

	// ── Error handling ───────────────────────────────────────────────────

	it('catches errors and returns a failure result', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.fileManager.processFrontMatter.mockRejectedValue(new Error('Permission denied'));

		const result = await tool.execute({ path: 'notes/foo.md', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('Permission denied');
		expect(plugin.logger.error).toHaveBeenCalled();
	});

	it('handles non-Error thrown values', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('notes/foo.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		plugin.app.fileManager.processFrontMatter.mockRejectedValue('string error');

		const result = await tool.execute({ path: 'notes/foo.md', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('Unknown error');
	});
});

// ─── AppendContentTool ───────────────────────────────────────────────────────

describe('AppendContentTool', () => {
	let tool: Tool;

	beforeEach(() => {
		vi.clearAllMocks();
		tool = getExtendedVaultTools().find((t) => t.name === 'append_content')!;
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
		const shortMsg = tool.confirmationMessage!({ path: 'notes/foo.md', content: 'hello' });
		expect(shortMsg).toContain('notes/foo.md');
		expect(shortMsg).toContain('hello');

		const longContent = 'x'.repeat(300);
		const longMsg = tool.confirmationMessage!({ path: 'notes/foo.md', content: longContent });
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
		const result = await tool.execute({ path: 'gemini-scribe/some.md', content: 'x' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('system folder');
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
});

// ─── getExtendedVaultTools ───────────────────────────────────────────────────

describe('getExtendedVaultTools', () => {
	it('returns both tools', () => {
		const tools = getExtendedVaultTools();
		expect(tools).toHaveLength(2);
		expect(tools.map((t) => t.name)).toEqual(['update_frontmatter', 'append_content']);
	});
});
