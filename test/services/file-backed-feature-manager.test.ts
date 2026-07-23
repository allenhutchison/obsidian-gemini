import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TFile } from 'obsidian';
import { FileBackedFeatureManager, type FileBackedDefinition } from '../../src/services/file-backed-feature-manager';

// normalizePath is a no-op in tests; TFile is only used as a type here.
vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {},
}));

// feature-definition pulls skill-manager for findFrontmatterEndOffset — stub it
// so the base's dependency graph stays light in this unit test.
vi.mock('../../src/services/skill-manager', () => ({
	findFrontmatterEndOffset: vi.fn().mockReturnValue(undefined),
}));

// ─── Test doubles ───────────────────────────────────────────────────────────

interface TestDef extends FileBackedDefinition {
	readonly slug: string;
	readonly filePath: string;
}

type TestEntryState = { seededAt?: string; note?: string };

function createMockPlugin(): any {
	const disk: Record<string, string> = {};
	return {
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
		settings: { historyFolder: 'gemini-scribe' },
		app: {
			fileManager: { trashFile: vi.fn().mockResolvedValue(undefined) },
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([]),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				adapter: {
					exists: vi.fn().mockImplementation(async (path: string) => path in disk),
					read: vi.fn().mockImplementation(async (path: string) => disk[path] ?? '{}'),
					write: vi.fn().mockImplementation(async (path: string, content: string) => {
						disk[path] = content;
					}),
				},
			},
		},
		_disk: disk,
	};
}

/**
 * Minimal concrete manager that exercises the base seams. `parseDefinitionFile`
 * treats a file basename `bad-*` as a parse failure (throws) and `null-*` as a
 * non-definition (returns null); everything else becomes a `{ slug, filePath }`.
 */
class TestManager extends FileBackedFeatureManager<TestDef, TestEntryState> {
	readonly defs = new Map<string, TestDef>();
	seedCalls: string[] = [];

	constructor(plugin: any, seedOnDiscovery = false) {
		super(plugin, {
			featureFolder: 'Widgets',
			stateFileName: 'widgets-state.json',
			logPrefix: '[TestManager]',
			featureNoun: 'widget',
			entityLabel: 'Widget',
		});
		this.seedOnDiscovery = seedOnDiscovery;
	}

	private seedOnDiscovery: boolean;

	protected get definitions(): Map<string, TestDef> {
		return this.defs;
	}

	protected async parseDefinitionFile(file: TFile): Promise<TestDef | null> {
		const basename = file.path.split('/').pop() ?? file.path;
		if (basename.startsWith('bad-')) throw new Error('boom');
		if (basename.startsWith('null-')) return null;
		const slug = basename.replace(/\.md$/, '');
		return { slug, filePath: file.path };
	}

	protected seedDiscoveredState(def: TestDef): void {
		this.seedCalls.push(def.slug);
		if (this.seedOnDiscovery && !this.state[def.slug]) {
			this.state[def.slug] = { seededAt: 'now' };
		}
	}

	protected onOrphanPurged(slug: string): void {
		this.plugin.logger.log(`purged ${slug}`);
	}

	// Expose the protected seams for the test.
	runDiscover() {
		return this.discoverDefinitions();
	}
	runDelete(slug: string) {
		return this.deleteDefinition(slug);
	}
	runLoad() {
		return this.loadState();
	}
	runSave() {
		return this.saveState();
	}
	getState() {
		return this.state;
	}
	setState(next: Record<string, TestEntryState>) {
		this.state = next;
	}
}

function mkFile(path: string): TFile {
	return { path } as unknown as TFile;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('FileBackedFeatureManager', () => {
	let plugin: any;
	let manager: TestManager;

	beforeEach(() => {
		plugin = createMockPlugin();
		manager = new TestManager(plugin);
	});

	describe('folder path helpers', () => {
		it('derives feature/runs/state paths from historyFolder + config', () => {
			expect(manager.featureFolderPath).toBe('gemini-scribe/Widgets');
			expect(manager.runsFolder).toBe('gemini-scribe/Widgets/Runs');
			expect(manager.stateFilePath).toBe('gemini-scribe/Widgets/widgets-state.json');
		});

		it('reflects a runtime historyFolder change (lazy resolution)', () => {
			plugin.settings.historyFolder = 'other-folder';
			expect(manager.stateFilePath).toBe('other-folder/Widgets/widgets-state.json');
		});
	});

	describe('discoverDefinitions', () => {
		it('builds the map from files, excluding the Runs/ subtree', async () => {
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				mkFile('gemini-scribe/Widgets/a.md'),
				mkFile('gemini-scribe/Widgets/b.md'),
				mkFile('gemini-scribe/Widgets/Runs/a/2026-01-01.md'), // filtered out
				mkFile('some-other-folder/c.md'), // outside feature folder
			]);

			await manager.runDiscover();

			expect([...manager.defs.keys()].sort()).toEqual(['a', 'b']);
		});

		it('skips null parses and logs a warning on a throwing parse, then continues', async () => {
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				mkFile('gemini-scribe/Widgets/good.md'),
				mkFile('gemini-scribe/Widgets/null-x.md'),
				mkFile('gemini-scribe/Widgets/bad-y.md'),
			]);

			await manager.runDiscover();

			expect([...manager.defs.keys()]).toEqual(['good']);
			expect(plugin.logger.warn).toHaveBeenCalledWith(
				'[TestManager] Failed to parse widget file gemini-scribe/Widgets/bad-y.md:',
				expect.any(Error)
			);
		});

		it('calls seedDiscoveredState for each discovered definition', async () => {
			plugin.app.vault.getMarkdownFiles.mockReturnValue([
				mkFile('gemini-scribe/Widgets/a.md'),
				mkFile('gemini-scribe/Widgets/b.md'),
			]);

			await manager.runDiscover();

			expect(manager.seedCalls.sort()).toEqual(['a', 'b']);
		});

		it('purges orphan state entries and reports them via onOrphanPurged, keeping live ones', async () => {
			manager.setState({ live: { note: 'keep' }, orphan: { note: 'drop' } });
			plugin.app.vault.getMarkdownFiles.mockReturnValue([mkFile('gemini-scribe/Widgets/live.md')]);

			await manager.runDiscover();

			expect(manager.getState()).toEqual({ live: { note: 'keep' } });
			expect(plugin.logger.log).toHaveBeenCalledWith('purged orphan');
			expect(plugin.logger.log).not.toHaveBeenCalledWith('purged live');
		});

		it('persists the state after discovery', async () => {
			plugin.app.vault.getMarkdownFiles.mockReturnValue([mkFile('gemini-scribe/Widgets/a.md')]);
			await manager.runDiscover();
			expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith(
				'gemini-scribe/Widgets/widgets-state.json',
				expect.any(String)
			);
		});

		it('a subclass override can seed per-definition state on discovery', async () => {
			const seeding = new TestManager(plugin, true);
			plugin.app.vault.getMarkdownFiles.mockReturnValue([mkFile('gemini-scribe/Widgets/a.md')]);
			await seeding.runDiscover();
			expect(seeding.getState()).toEqual({ a: { seededAt: 'now' } });
		});
	});

	describe('deleteDefinition', () => {
		it('trashes the file, drops the map entry and state, and saves', async () => {
			manager.defs.set('a', { slug: 'a', filePath: 'gemini-scribe/Widgets/a.md' });
			manager.setState({ a: { note: 'x' } });
			const fileObj = mkFile('gemini-scribe/Widgets/a.md');
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(fileObj);

			await manager.runDelete('a');

			expect(plugin.app.fileManager.trashFile).toHaveBeenCalledWith(fileObj);
			expect(manager.defs.has('a')).toBe(false);
			expect(manager.getState().a).toBeUndefined();
			expect(plugin.app.vault.adapter.write).toHaveBeenCalled();
		});

		it('tolerates a file already gone from the vault', async () => {
			manager.defs.set('a', { slug: 'a', filePath: 'gemini-scribe/Widgets/a.md' });
			plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			await manager.runDelete('a');

			expect(plugin.app.fileManager.trashFile).not.toHaveBeenCalled();
			expect(manager.defs.has('a')).toBe(false);
		});

		it('throws a labelled not-found error for an unknown slug', async () => {
			await expect(manager.runDelete('nope')).rejects.toThrow('Widget "nope" not found');
		});
	});

	describe('state persistence', () => {
		it('loadState reads the sidecar; saveState writes it back', async () => {
			plugin._disk['gemini-scribe/Widgets/widgets-state.json'] = JSON.stringify({ a: { note: 'loaded' } });

			await manager.runLoad();
			expect(manager.getState()).toEqual({ a: { note: 'loaded' } });

			manager.setState({ b: { note: 'saved' } });
			await manager.runSave();
			expect(JSON.parse(plugin._disk['gemini-scribe/Widgets/widgets-state.json'])).toEqual({ b: { note: 'saved' } });
		});
	});
});
