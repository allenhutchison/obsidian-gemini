/**
 * Tests for UpdateFrontmatterTool — moved here from the former flat
 * `test/tools/vault-tools-extended.test.ts` alongside the tool's move into
 * `src/tools/vault/` (#1310). The tool resolves paths through the shared
 * `resolvePathToFile`, so these tests exercise real resolution against a mock
 * vault (direct paths, .md fallback, wikilinks, system-folder exclusion).
 */
import { TFile } from 'obsidian';
import { UpdateFrontmatterTool } from '../../../src/tools/vault';
import type { Tool } from '../../../src/tools/types';
import { ToolExecutionContext } from '../../../src/tools/types';
import { ToolCategory } from '../../../src/types/agent';
import { ToolClassification } from '../../../src/types/tool-policy';

/** Tool narrowed to include the optional methods these tests exercise. */
type ToolWithOptionals = Tool & {
	getProgressDescription: NonNullable<Tool['getProgressDescription']>;
	confirmationMessage: NonNullable<Tool['confirmationMessage']>;
};

let tool: ToolWithOptionals;

function getTool(): ToolWithOptionals {
	const candidates: Tool[] = [new UpdateFrontmatterTool()];
	const found = candidates.find(
		(t): t is ToolWithOptionals =>
			typeof t.getProgressDescription === 'function' && typeof t.confirmationMessage === 'function'
	);
	if (!found) {
		throw new Error('UpdateFrontmatterTool is missing the optional methods the tests exercise');
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

describe('UpdateFrontmatterTool', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getTool();
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
		const msg = tool.confirmationMessage({ path: 'notes/foo.md', key: 'status', value: 'done' });
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
		// Even if the file exists at that path, the resolver returns null for excluded paths
		const file = makeTFile('gemini-scribe/some.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		const result = await tool.execute({ path: 'gemini-scribe/some.md', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
		expect(plugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
	});

	it('rejects .obsidian paths', async () => {
		const plugin = createMockPlugin();
		const file = makeTFile('.obsidian/config.md');
		plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
		const result = await tool.execute({ path: '.obsidian/config.md', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
		expect(plugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
	});

	it('rejects wikilink that resolves to a file inside the history folder', async () => {
		// Regression for issue #910: a bare wikilink like "Foo" could resolve via
		// metadataCache.getFirstLinkpathDest() to a file inside gemini-scribe/Skills/,
		// and the prior inline resolver skipped the exclusion check on the resolved path.
		const plugin = createMockPlugin();
		const skillFile = makeTFile('gemini-scribe/Skills/Foo/SKILL.md');
		plugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(skillFile);
		const result = await tool.execute({ path: 'Foo', key: 'k', value: 'v' }, makeContext(plugin));
		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
		expect(plugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
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
		await tool.execute({ path: 'notes/foo.md', key: 'num', value: 99 }, makeContext(plugin));
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
