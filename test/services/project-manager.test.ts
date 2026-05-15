vi.mock('obsidian', () => {
	class TFile {
		path: string = '';
		basename: string = '';
		extension: string = 'md';
		parent: { path: string } | null = null;
	}
	return { TFile, normalizePath: (p: string) => p };
});

import { TFile } from 'obsidian';
import { ProjectManager } from '../../src/services/project-manager';
import { ToolPermission } from '../../src/types/tool-policy';
import { PROJECT_TAG } from '../../src/types/project';

function createMockFile(path: string, basename?: string): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = basename ?? path.replace(/^.*\//, '').replace(/\.md$/, '');
	file.extension = 'md';
	const lastSlash = path.lastIndexOf('/');
	(file as any).parent = lastSlash > 0 ? { path: path.substring(0, lastSlash) } : { path: '' };
	return file;
}

function createMockPlugin(overrides: Record<string, any> = {}): any {
	return {
		app: {
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([]),
				getAbstractFileByPath: vi.fn(),
				read: vi.fn().mockResolvedValue(''),
				on: vi.fn().mockReturnValue({ id: 'mock-event' }),
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
			fileManager: {
				processFrontMatter: vi.fn(),
			},
		},
		logger: {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		},
		registerEvent: vi.fn(),
		...overrides,
	};
}

describe('ProjectManager', () => {
	let manager: ProjectManager;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = createMockPlugin();
		manager = new ProjectManager(mockPlugin);
	});

	describe('initialize', () => {
		it('should discover project files by tag', async () => {
			const projectFile = createMockFile('novel/Novel Project.md');
			const normalFile = createMockFile('notes/Regular Note.md');

			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([projectFile, normalFile]);
			mockPlugin.app.metadataCache.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === projectFile.path) {
					return {
						frontmatter: { tags: [PROJECT_TAG], name: 'My Novel' },
						frontmatterPosition: { end: { offset: 50 } },
					};
				}
				return { frontmatter: { tags: ['other-tag'] } };
			});
			mockPlugin.app.vault.read.mockResolvedValue(
				'---\ntags:\n  - gemini-scribe/project\nname: My Novel\n---\n\nInstructions here'
			);

			await manager.initialize();

			const projects = manager.discoverProjects();
			expect(projects).toHaveLength(1);
			expect(projects[0].name).toBe('My Novel');
			expect(projects[0].rootPath).toBe('novel');
		});

		it('should return empty when no projects exist', async () => {
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([]);

			await manager.initialize();

			expect(manager.discoverProjects()).toHaveLength(0);
		});

		it('should handle malformed frontmatter gracefully', async () => {
			const file = createMockFile('bad/Bad.md');
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG] },
			});
			mockPlugin.app.vault.read.mockRejectedValue(new Error('Read failed'));

			await manager.initialize();

			expect(manager.discoverProjects()).toHaveLength(0);
			expect(mockPlugin.logger.warn).toHaveBeenCalled();
		});
	});

	describe('parseProjectFile', () => {
		it('should extract config from frontmatter', async () => {
			const file = createMockFile('project/Config Test.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test Project',
					skills: ['writing-coach', 'continuity-tracker'],
					permissions: { edit_file: 'allow', delete_file: 'deny' },
				},
				frontmatterPosition: { end: { offset: 100 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('x'.repeat(100) + '\n\nProject instructions');

			const project = await manager.parseProjectFile(file);

			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('Test Project');
			expect(project!.config.skills).toEqual(['writing-coach', 'continuity-tracker']);
			expect(project!.config.toolPolicy?.overrides).toEqual({
				edit_file: ToolPermission.APPROVE,
				delete_file: ToolPermission.DENY,
			});
		});

		it('should default name to file basename when not specified', async () => {
			const file = createMockFile('project/My Project.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG] },
				frontmatterPosition: { end: { offset: 30 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('x'.repeat(30) + '\n\nBody');

			const project = await manager.parseProjectFile(file);

			expect(project!.config.name).toBe('My Project');
		});

		it('should default skills to empty array', async () => {
			const file = createMockFile('project/Test.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Test' },
				frontmatterPosition: { end: { offset: 30 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('x'.repeat(30));

			const project = await manager.parseProjectFile(file);

			expect(project!.config.skills).toEqual([]);
		});

		it('should return null for non-project files', async () => {
			const file = createMockFile('notes/Regular.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: ['other-tag'] },
			});

			const project = await manager.parseProjectFile(file);

			expect(project).toBeNull();
		});

		it('should handle tags as string (not array)', async () => {
			const file = createMockFile('project/Single.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: PROJECT_TAG, name: 'Single Tag' },
				frontmatterPosition: { end: { offset: 30 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('x'.repeat(30));

			const project = await manager.parseProjectFile(file);

			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('Single Tag');
		});

		it('should strip dataview/dataviewjs/bases code blocks from instructions', async () => {
			const file = createMockFile('project/Blocks.md');
			const body =
				'Instructions\n\n```dataview\nTABLE file.name\n```\n\nMore text\n\n```dataviewjs\nconst x = 1;\n```\n\n```base\ntable config\n```\n\nFinal text';
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Blocks' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue(body);

			const project = await manager.parseProjectFile(file);

			expect(project!.instructions).not.toContain('dataview');
			expect(project!.instructions).not.toContain('dataviewjs');
			expect(project!.instructions).not.toContain('base');
			expect(project!.instructions).toContain('Instructions');
			expect(project!.instructions).toContain('More text');
			expect(project!.instructions).toContain('Final text');
		});

		it('should preserve non-dataview code blocks', async () => {
			const file = createMockFile('project/Code.md');
			const body = 'Text\n\n```javascript\nconst x = 1;\n```\n\nMore';
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Code' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue(body);

			const project = await manager.parseProjectFile(file);

			expect(project!.instructions).toContain('```javascript');
		});

		it('should resolve wikilinks to context files', async () => {
			const file = createMockFile('project/Links.md');
			const linkedFile = createMockFile('reference/Style Guide.md');

			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Links' },
				frontmatterPosition: { end: { offset: 0 } },
				links: [{ link: 'Style Guide' }],
				embeds: [{ link: 'Magic System' }],
			});
			mockPlugin.app.vault.read.mockResolvedValue('Body with [[Style Guide]] and ![[Magic System]]');
			mockPlugin.app.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) => {
				if (link === 'Style Guide') return linkedFile;
				return null;
			});

			const project = await manager.parseProjectFile(file);

			expect(project!.contextFiles).toHaveLength(1);
			expect(project!.contextFiles[0].path).toBe('reference/Style Guide.md');
			expect(project!.embedFiles).toHaveLength(0); // Magic System didn't resolve
		});

		it('should compute rootPath from file parent', async () => {
			const file = createMockFile('deep/nested/project/Project.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Deep' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.rootPath).toBe('deep/nested/project');
		});
	});

	describe('permission mapping', () => {
		it('should map allow to APPROVE', async () => {
			const file = createMockFile('project/Perms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], permissions: { write_file: 'allow' } },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy!.overrides!.write_file).toBe(ToolPermission.APPROVE);
		});

		it('should map deny to DENY', async () => {
			const file = createMockFile('project/Perms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], permissions: { delete_file: 'deny' } },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy!.overrides!.delete_file).toBe(ToolPermission.DENY);
		});

		it('should map ask to ASK_USER', async () => {
			const file = createMockFile('project/Perms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], permissions: { move_file: 'ask' } },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy!.overrides!.move_file).toBe(ToolPermission.ASK_USER);
		});

		it('should warn and default unknown values to ASK_USER', async () => {
			const file = createMockFile('project/Perms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], permissions: { write_file: 'yolo' } },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy!.overrides!.write_file).toBe(ToolPermission.ASK_USER);
			expect(mockPlugin.logger.warn).toHaveBeenCalled();
		});

		// Regression: an explicit but empty `toolPolicy:` block means "inherit
		// global policy", not "fall back to legacy permissions" — otherwise
		// stale legacy overrides would silently override the user's intent.
		it('treats an explicit empty toolPolicy as inherit-global, ignoring legacy permissions', async () => {
			const file = createMockFile('project/EmptyPolicy.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					toolPolicy: {},
					permissions: { write_file: 'allow' },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy).toBeUndefined();
		});
	});

	describe('getProjectForPath', () => {
		beforeEach(async () => {
			const novelFile = createMockFile('novel/Novel.md');
			const workFile = createMockFile('work/notes/Work.md');

			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([novelFile, workFile]);
			mockPlugin.app.metadataCache.getFileCache.mockImplementation((file: TFile) => ({
				frontmatter: { tags: [PROJECT_TAG], name: file.basename },
				frontmatterPosition: { end: { offset: 0 } },
			}));
			mockPlugin.app.vault.read.mockResolvedValue('');

			await manager.initialize();
		});

		it('should find project for a file inside its root', () => {
			const project = manager.getProjectForPath('novel/chapters/chapter1.md');
			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('Novel');
		});

		it('should return null for paths outside any project', () => {
			const project = manager.getProjectForPath('unrelated/file.md');
			expect(project).toBeNull();
		});

		it('should pick the deepest match for nested projects', () => {
			const project = manager.getProjectForPath('work/notes/meeting.md');
			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('Work');
		});
	});

	describe('registerVaultEvents', () => {
		it('should register create, modify, delete, and rename listeners', () => {
			manager.registerVaultEvents();

			expect(mockPlugin.registerEvent).toHaveBeenCalledTimes(4);
			expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('create', expect.any(Function));
			expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
			expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
			expect(mockPlugin.app.vault.on).toHaveBeenCalledWith('rename', expect.any(Function));
		});
	});
});

// ─────────────────────────────────────────────────────────────────────
// New coverage blocks appended below
// ─────────────────────────────────────────────────────────────────────

describe('ProjectManager – extended coverage', () => {
	let manager: ProjectManager;
	let mockPlugin: any;

	/** Helper: seed a project into the cache via initialize(). */
	async function seedProject(file: TFile, frontmatter: Record<string, any>): Promise<void> {
		mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
		mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
			frontmatter: { tags: [PROJECT_TAG], ...frontmatter },
			frontmatterPosition: { end: { offset: 0 } },
		});
		mockPlugin.app.vault.read.mockResolvedValue('');
		await manager.initialize();
	}

	/** Helper: seed multiple projects via initialize(). */
	async function seedProjects(entries: Array<{ file: TFile; frontmatter: Record<string, any> }>): Promise<void> {
		const files = entries.map((e) => e.file);
		mockPlugin.app.vault.getMarkdownFiles.mockReturnValue(files);
		mockPlugin.app.metadataCache.getFileCache.mockImplementation((f: TFile) => {
			const entry = entries.find((e) => e.file.path === f.path);
			if (!entry) return null;
			return {
				frontmatter: { tags: [PROJECT_TAG], ...entry.frontmatter },
				frontmatterPosition: { end: { offset: 0 } },
			};
		});
		mockPlugin.app.vault.read.mockResolvedValue('');
		await manager.initialize();
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = createMockPlugin();
		manager = new ProjectManager(mockPlugin);
	});

	// ── 1. getProjectForPath advanced matching ──────────────────────────

	describe('getProjectForPath – advanced matching', () => {
		it('breaks ties at the same depth by lexicographically smallest file path', async () => {
			// Two projects whose rootPaths are the same depth → pick smallest file.path
			const fileA = createMockFile('shared/A-Project.md');
			const fileB = createMockFile('shared/B-Project.md');
			await seedProjects([
				{ file: fileB, frontmatter: { name: 'B' } },
				{ file: fileA, frontmatter: { name: 'A' } },
			]);

			const result = manager.getProjectForPath('shared/some-file.md');
			expect(result).not.toBeNull();
			expect(result!.config.name).toBe('A');
		});

		it('root project (rootPath = "") matches everything', async () => {
			const rootFile = createMockFile('Root.md');
			// parent is '' for a vault-root file
			(rootFile as any).parent = { path: '' };
			await seedProject(rootFile, { name: 'Root Project' });

			const result = manager.getProjectForPath('any/deep/nested/file.md');
			expect(result).not.toBeNull();
			expect(result!.config.name).toBe('Root Project');
		});

		it('matches when file path exactly equals rootPath', async () => {
			const projectFile = createMockFile('myproject/Project.md');
			await seedProject(projectFile, { name: 'My Project' });

			// path === rootPath (no trailing /)
			const result = manager.getProjectForPath('myproject');
			expect(result).not.toBeNull();
			expect(result!.config.name).toBe('My Project');
		});

		it('does not match a path that shares a prefix but not a directory boundary', async () => {
			const projectFile = createMockFile('novel/Project.md');
			await seedProject(projectFile, { name: 'Novel' });

			// 'novel-extras/file.md' starts with 'novel' but not 'novel/'
			const result = manager.getProjectForPath('novel-extras/file.md');
			expect(result).toBeNull();
		});
	});

	// ── 2. hasTags edge cases (exercised through parseProjectFile) ──────

	describe('hasTags edge cases (via parseProjectFile)', () => {
		it('returns null when tags is a number', async () => {
			const file = createMockFile('project/Num.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: 42 },
			});

			const project = await manager.parseProjectFile(file);
			expect(project).toBeNull();
		});

		it('returns null when tags is null', async () => {
			const file = createMockFile('project/Null.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: null },
			});

			const project = await manager.parseProjectFile(file);
			expect(project).toBeNull();
		});

		it('ignores non-string entries in a mixed-type tags array', async () => {
			const file = createMockFile('project/Mixed.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [123, PROJECT_TAG, 456] },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			// Should still match because there is a string entry that matches
			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('Mixed');
		});

		it('returns null when tags array has only non-string entries', async () => {
			const file = createMockFile('project/AllNum.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [123, 456] },
			});

			const project = await manager.parseProjectFile(file);
			expect(project).toBeNull();
		});
	});

	// ── 3. parseConfig edge cases ──────────────────────────────────────

	describe('parseConfig edge cases (via parseProjectFile)', () => {
		it('defaults name to file basename when name is a number', async () => {
			const file = createMockFile('project/NumberName.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 42 },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.name).toBe('NumberName');
		});

		it('filters out non-string entries from skills', async () => {
			const file = createMockFile('project/Skills.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Filtered', skills: ['valid-skill', 42, 'another-skill', true] },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.skills).toEqual(['valid-skill', 'another-skill']);
		});

		it('toolPolicy is undefined when no toolPolicy and no permissions', async () => {
			const file = createMockFile('project/NoPolicy.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'No Policy' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy).toBeUndefined();
		});
	});

	// ── 4. parseToolPolicy legacy migration paths ──────────────────────

	describe('parseToolPolicy – legacy migration', () => {
		it('uses parseToolPolicyFrontmatter when toolPolicy key exists, ignoring legacy permissions', async () => {
			const file = createMockFile('project/ToolPolicy.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					toolPolicy: { overrides: { read_file: 'allow' } },
					permissions: { delete_file: 'deny' },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			// Should use toolPolicy, NOT legacy permissions
			expect(project!.config.toolPolicy?.overrides?.read_file).toBe(ToolPermission.APPROVE);
			expect(project!.config.toolPolicy?.overrides?.delete_file).toBeUndefined();
		});

		it('skips non-string permission values in legacy permissions', async () => {
			const file = createMockFile('project/MixedPerms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					permissions: { write_file: 'allow', bad_tool: 123, another: true },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy?.overrides?.write_file).toBe(ToolPermission.APPROVE);
			expect(project!.config.toolPolicy?.overrides?.bad_tool).toBeUndefined();
			expect(project!.config.toolPolicy?.overrides?.another).toBeUndefined();
		});

		it('returns undefined toolPolicy when permissions is null', async () => {
			const file = createMockFile('project/NullPerms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], permissions: null },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy).toBeUndefined();
		});

		it('returns undefined toolPolicy when permissions is a string (non-object)', async () => {
			const file = createMockFile('project/StringPerms.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], permissions: 'invalid' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.config.toolPolicy).toBeUndefined();
		});
	});

	// ── 5. createProject CRUD ──────────────────────────────────────────

	describe('createProject', () => {
		it('creates file with correct path and template content', async () => {
			const createdFile = createMockFile('folder/My Project.md');
			mockPlugin.app.vault.create = vi.fn().mockImplementation(async (_path: string, _content: string) => {
				return createdFile;
			});

			const result = await manager.createProject('folder', 'My Project');

			expect(result).toBe(createdFile);
			expect(mockPlugin.app.vault.create).toHaveBeenCalledWith('folder/My Project.md', expect.any(String));
		});

		it('content includes PROJECT_TAG, name, skills, and toolPolicy', async () => {
			const createdFile = createMockFile('folder/Test.md');
			let capturedContent = '';
			mockPlugin.app.vault.create = vi.fn().mockImplementation(async (_path: string, content: string) => {
				capturedContent = content;
				return createdFile;
			});

			await manager.createProject('folder', 'Test');

			expect(capturedContent).toContain(PROJECT_TAG);
			expect(capturedContent).toContain('name: "Test"');
			expect(capturedContent).toContain('skills: []');
			expect(capturedContent).toContain('toolPolicy: {}');
		});

		it('returns the created TFile', async () => {
			const createdFile = createMockFile('projects/New.md');
			mockPlugin.app.vault.create = vi.fn().mockResolvedValue(createdFile);

			const result = await manager.createProject('projects', 'New');
			expect(result).toBeInstanceOf(TFile);
			expect(result.path).toBe('projects/New.md');
		});
	});

	// ── 6. convertNoteToProject CRUD ───────────────────────────────────

	describe('convertNoteToProject', () => {
		it('adds PROJECT_TAG to existing tags array', async () => {
			const file = createMockFile('notes/Note.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: ['existing-tag'] };
					callback(fm);
					capturedFm = fm;
				});

			await manager.convertNoteToProject(file);

			expect(capturedFm.tags).toContain(PROJECT_TAG);
			expect(capturedFm.tags).toContain('existing-tag');
		});

		it('converts string tag to array and adds PROJECT_TAG', async () => {
			const file = createMockFile('notes/StringTag.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: 'single-tag' };
					callback(fm);
					capturedFm = fm;
				});

			await manager.convertNoteToProject(file);

			expect(Array.isArray(capturedFm.tags)).toBe(true);
			expect(capturedFm.tags).toContain('single-tag');
			expect(capturedFm.tags).toContain(PROJECT_TAG);
		});

		it('handles missing tags by creating array with PROJECT_TAG', async () => {
			const file = createMockFile('notes/NoTags.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFm = fm;
				});

			await manager.convertNoteToProject(file);

			expect(capturedFm.tags).toEqual([PROJECT_TAG]);
		});

		it('does not duplicate if PROJECT_TAG is already present', async () => {
			const file = createMockFile('notes/AlreadyProject.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: [PROJECT_TAG, 'other'] };
					callback(fm);
					capturedFm = fm;
				});

			await manager.convertNoteToProject(file);

			const tagCount = capturedFm.tags.filter((t: string) => t === PROJECT_TAG).length;
			expect(tagCount).toBe(1);
		});

		it('sets name to basename if no name exists', async () => {
			const file = createMockFile('notes/MyNote.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = {};
					callback(fm);
					capturedFm = fm;
				});

			await manager.convertNoteToProject(file);

			expect(capturedFm.name).toBe('MyNote');
		});

		it('preserves existing name', async () => {
			const file = createMockFile('notes/MyNote.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { name: 'Custom Name' };
					callback(fm);
					capturedFm = fm;
				});

			await manager.convertNoteToProject(file);

			expect(capturedFm.name).toBe('Custom Name');
		});
	});

	// ── 7. removeProject CRUD ──────────────────────────────────────────

	describe('removeProject', () => {
		it('removes PROJECT_TAG from tags array', async () => {
			const file = createMockFile('project/Remove.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: [PROJECT_TAG, 'keep-me'] };
					callback(fm);
					capturedFm = fm;
				});

			await manager.removeProject(file);

			expect(capturedFm.tags).toEqual(['keep-me']);
		});

		it('deletes tags key if array becomes empty', async () => {
			const file = createMockFile('project/OnlyTag.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: [PROJECT_TAG] };
					callback(fm);
					capturedFm = fm;
				});

			await manager.removeProject(file);

			expect(capturedFm.tags).toBeUndefined();
		});

		it('removes from projectCache', async () => {
			const file = createMockFile('project/Cached.md');
			// First seed the project so it's in cache
			await seedProject(file, { name: 'Cached' });
			expect(manager.discoverProjects()).toHaveLength(1);

			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: [PROJECT_TAG] };
					callback(fm);
				});

			await manager.removeProject(file);

			expect(manager.discoverProjects()).toHaveLength(0);
		});

		it('handles string tag removal', async () => {
			const file = createMockFile('project/StringRemove.md');
			let capturedFm: any = {};
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { tags: PROJECT_TAG };
					callback(fm);
					capturedFm = fm;
				});

			await manager.removeProject(file);

			expect(capturedFm.tags).toBeUndefined();
		});
	});

	// ── 8. getProject on-demand ────────────────────────────────────────

	describe('getProject – on-demand loading', () => {
		it('returns cached project directly', async () => {
			const file = createMockFile('project/Cached.md');
			await seedProject(file, { name: 'Cached' });

			const result = await manager.getProject('project/Cached.md');
			expect(result).not.toBeNull();
			expect(result!.config.name).toBe('Cached');
		});

		it('parses and caches file not yet in cache', async () => {
			const file = createMockFile('project/OnDemand.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'On Demand' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const result = await manager.getProject('project/OnDemand.md');
			expect(result).not.toBeNull();
			expect(result!.config.name).toBe('On Demand');

			// Second call should return from cache (no additional vault calls)
			const callCount = mockPlugin.app.vault.read.mock.calls.length;
			const cached = await manager.getProject('project/OnDemand.md');
			expect(cached).toBe(result);
			expect(mockPlugin.app.vault.read.mock.calls.length).toBe(callCount);
		});

		it('returns null when path does not resolve to TFile', async () => {
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

			const result = await manager.getProject('nonexistent.md');
			expect(result).toBeNull();
		});

		it('returns null and logs warning when parse fails', async () => {
			const file = createMockFile('project/Bad.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Bad' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockRejectedValue(new Error('Disk error'));

			const result = await manager.getProject('project/Bad.md');
			expect(result).toBeNull();
			expect(mockPlugin.logger.warn).toHaveBeenCalled();
		});
	});

	// ── 9. parseProjectFile – legacy migration rewrite ─────────────────

	describe('parseProjectFile – legacy permission migration', () => {
		it('calls processFrontMatter to migrate permissions to toolPolicy', async () => {
			const file = createMockFile('project/Migrate.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					permissions: { write_file: 'allow' },
					// no toolPolicy key
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			mockPlugin.app.fileManager.processFrontMatter = vi
				.fn()
				.mockImplementation(async (_file: TFile, callback: (fm: any) => void) => {
					const fm: any = { permissions: { write_file: 'allow' } };
					callback(fm);
				});

			const project = await manager.parseProjectFile(file);

			expect(project).not.toBeNull();
			expect(mockPlugin.app.fileManager.processFrontMatter).toHaveBeenCalled();
		});

		it('logs warning but still returns project when migration fails', async () => {
			const file = createMockFile('project/MigrateFail.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					permissions: { write_file: 'allow' },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			mockPlugin.app.fileManager.processFrontMatter = vi.fn().mockRejectedValue(new Error('Write locked'));

			const project = await manager.parseProjectFile(file);

			expect(project).not.toBeNull();
			expect(project!.config.toolPolicy?.overrides?.write_file).toBe(ToolPermission.APPROVE);
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('legacy permissions migration failed'),
				expect.any(Error)
			);
		});
	});

	// ── 10. discoverProjects shape ─────────────────────────────────────

	describe('discoverProjects – output shape', () => {
		it('returns array with name, filePath, and rootPath', async () => {
			const file = createMockFile('myproject/Project.md');
			await seedProject(file, { name: 'Shaped' });

			const summaries = manager.discoverProjects();
			expect(summaries).toHaveLength(1);
			expect(summaries[0]).toEqual({
				name: 'Shaped',
				filePath: 'myproject/Project.md',
				rootPath: 'myproject',
			});
		});
	});

	// ── 11. destroy ────────────────────────────────────────────────────

	describe('destroy', () => {
		it('clears pending timers', () => {
			// Access the private pendingTimers map via any cast
			const mgr = manager as any;
			mgr.pendingTimers.set('a', 100);
			mgr.pendingTimers.set('b', 200);

			const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

			manager.destroy();

			expect(clearTimeoutSpy.calls?.length ?? clearTimeoutSpy.mock.calls.length).toBe(2);
			expect(mgr.pendingTimers.size).toBe(0);

			clearTimeoutSpy.mockRestore();
		});
	});

	// ── 12. parseProjectFile rootPath edge cases ───────────────────────

	describe('parseProjectFile – rootPath edge cases', () => {
		it('file at vault root (parent path "") yields rootPath ""', async () => {
			const file = createMockFile('RootProject.md');
			(file as any).parent = { path: '' };
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Root' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.rootPath).toBe('');
		});

		it('file with parent path "/" yields rootPath ""', async () => {
			const file = createMockFile('RootProject.md');
			(file as any).parent = { path: '/' };
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Root' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.rootPath).toBe('');
		});

		it('file with null parent yields rootPath ""', async () => {
			const file = createMockFile('Orphan.md');
			(file as any).parent = null;
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Orphan' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);
			expect(project!.rootPath).toBe('');
		});
	});
});

// ─────────────────────────────────────────────────────────────────────
// Targeted coverage: specific uncovered lines
// ─────────────────────────────────────────────────────────────────────

describe('ProjectManager – uncovered line coverage', () => {
	let manager: ProjectManager;
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockPlugin = createMockPlugin();
		manager = new ProjectManager(mockPlugin);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ── Lines 297-301: Body text extraction from frontmatterPosition offset ──

	describe('parseProjectFile – body text extraction (lines 297-301)', () => {
		it('strips frontmatter from body content using frontmatterPosition offset', async () => {
			const file = createMockFile('project/Body.md');
			const rawContent = '---\ntags: project\nname: Test\n---\nThis is the body';
			const frontmatterEnd = rawContent.indexOf('---\nThis is the body') + 4; // offset after closing ---
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: PROJECT_TAG, name: 'Test' },
				frontmatterPosition: { end: { offset: frontmatterEnd } },
			});
			mockPlugin.app.vault.read.mockResolvedValue(rawContent);

			const result = await manager.parseProjectFile(file);

			expect(result).not.toBeNull();
			expect(result!.instructions).toBe('This is the body');
		});

		it('strips unsupported code blocks from body after frontmatter extraction', async () => {
			const file = createMockFile('project/CodeBlocks.md');
			const frontmatter = '---\ntags: project\nname: Test\n---\n';
			const body =
				'Intro\n\n```dataview\nTABLE file.name\n```\n\nMiddle\n\n```dataviewjs\nconst x = 1;\n```\n\n```bases\ntable config\n```\n\nEnd';
			const rawContent = frontmatter + body;
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Test' },
				frontmatterPosition: { end: { offset: frontmatter.length } },
			});
			mockPlugin.app.vault.read.mockResolvedValue(rawContent);

			const result = await manager.parseProjectFile(file);

			expect(result!.instructions).toContain('Intro');
			expect(result!.instructions).toContain('Middle');
			expect(result!.instructions).toContain('End');
			expect(result!.instructions).not.toContain('dataview');
			expect(result!.instructions).not.toContain('dataviewjs');
			expect(result!.instructions).not.toContain('bases');
		});

		it('uses full content as body when frontmatterPosition is absent', async () => {
			const file = createMockFile('project/NoPosition.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Test' },
				// no frontmatterPosition
			});
			mockPlugin.app.vault.read.mockResolvedValue('Just body content');

			const result = await manager.parseProjectFile(file);

			expect(result!.instructions).toBe('Just body content');
		});
	});

	// ── Line 375: parseToolPolicy when toolPolicy key exists ──────────────

	describe('parseToolPolicy – toolPolicy key path (line 375)', () => {
		it('delegates to parseToolPolicyFrontmatter when toolPolicy key is present', async () => {
			const file = createMockFile('project/PolicyKey.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test',
					toolPolicy: { overrides: { read_file: 'allow', write_file: 'deny' } },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.config.toolPolicy).toBeDefined();
			expect(project!.config.toolPolicy!.overrides!.read_file).toBe(ToolPermission.APPROVE);
			expect(project!.config.toolPolicy!.overrides!.write_file).toBe(ToolPermission.DENY);
		});

		it('returns correct policy when toolPolicy has a preset', async () => {
			const file = createMockFile('project/PresetPolicy.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test',
					toolPolicy: { preset: 'read_only' },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.config.toolPolicy).toBeDefined();
			expect(project!.config.toolPolicy!.preset).toBe('read_only');
		});

		it('returns undefined toolPolicy when toolPolicy key is null', async () => {
			const file = createMockFile('project/NullPolicy.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test',
					toolPolicy: null,
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.config.toolPolicy).toBeUndefined();
		});
	});

	// ── Lines 379-392: Legacy permissions loop – non-string filter, unknown mapping ──

	describe('parseToolPolicy – legacy permissions loop (lines 379-392)', () => {
		it('filters out non-string values and maps valid strings', async () => {
			const file = createMockFile('project/LegacyMix.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test',
					permissions: { write_file: 'allow', delete_file: 'deny', search: 123, flag: true, obj: {} },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.config.toolPolicy).toBeDefined();
			expect(project!.config.toolPolicy!.overrides!.write_file).toBe(ToolPermission.APPROVE);
			expect(project!.config.toolPolicy!.overrides!.delete_file).toBe(ToolPermission.DENY);
			// Non-string values should be skipped
			expect(project!.config.toolPolicy!.overrides!.search).toBeUndefined();
			expect(project!.config.toolPolicy!.overrides!.flag).toBeUndefined();
			expect(project!.config.toolPolicy!.overrides!.obj).toBeUndefined();
		});

		it('maps unknown permission string to ASK_USER and logs warning', async () => {
			const file = createMockFile('project/UnknownPerm.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test',
					permissions: { tool_a: 'something_weird', tool_b: 'nope' },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.config.toolPolicy!.overrides!.tool_a).toBe(ToolPermission.ASK_USER);
			expect(project!.config.toolPolicy!.overrides!.tool_b).toBe(ToolPermission.ASK_USER);
			expect(mockPlugin.logger.warn).toHaveBeenCalledTimes(2);
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Unknown permission value 'something_weird' for tool 'tool_a'")
			);
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Unknown permission value 'nope' for tool 'tool_b'")
			);
		});

		it('returns undefined toolPolicy when all legacy permission values are non-string', async () => {
			const file = createMockFile('project/AllNonString.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					tags: [PROJECT_TAG],
					name: 'Test',
					permissions: { a: 123, b: true, c: null },
				},
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			// overrides would be empty → returns undefined
			expect(project!.config.toolPolicy).toBeUndefined();
		});
	});

	// ── Lines 396-397, 405: resolveLinks – undefined links and non-TFile ──

	describe('parseProjectFile – resolveLinks (lines 396-397, 405)', () => {
		it('returns empty contextFiles and embedFiles when links and embeds are undefined', async () => {
			const file = createMockFile('project/NoLinks.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Test' },
				frontmatterPosition: { end: { offset: 0 } },
				// no links, no embeds
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const project = await manager.parseProjectFile(file);

			expect(project!.contextFiles).toEqual([]);
			expect(project!.embedFiles).toEqual([]);
		});

		it('skips links that resolve to non-TFile (e.g., folders)', async () => {
			const file = createMockFile('project/MixedLinks.md');
			const validFile = createMockFile('notes/Valid.md');
			// Non-TFile result: just a plain object (not instanceof TFile)
			const folderLike = { path: 'some-folder', name: 'some-folder', children: [] };

			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Test' },
				frontmatterPosition: { end: { offset: 0 } },
				links: [{ link: 'Valid' }, { link: 'some-folder' }, { link: 'missing' }],
				embeds: [{ link: 'also-folder' }],
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			mockPlugin.app.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) => {
				if (link === 'Valid') return validFile;
				if (link === 'some-folder') return folderLike; // not TFile
				if (link === 'also-folder') return folderLike; // not TFile
				return null; // missing
			});

			const project = await manager.parseProjectFile(file);

			expect(project!.contextFiles).toHaveLength(1);
			expect(project!.contextFiles[0].path).toBe('notes/Valid.md');
			expect(project!.embedFiles).toHaveLength(0);
		});

		it('resolves both links and embeds to separate arrays', async () => {
			const file = createMockFile('project/BothLinks.md');
			const linkedFile = createMockFile('ref/Linked.md');
			const embeddedFile = createMockFile('ref/Embedded.md');

			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Test' },
				frontmatterPosition: { end: { offset: 0 } },
				links: [{ link: 'Linked' }],
				embeds: [{ link: 'Embedded' }],
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			mockPlugin.app.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) => {
				if (link === 'Linked') return linkedFile;
				if (link === 'Embedded') return embeddedFile;
				return null;
			});

			const project = await manager.parseProjectFile(file);

			expect(project!.contextFiles).toHaveLength(1);
			expect(project!.contextFiles[0].path).toBe('ref/Linked.md');
			expect(project!.embedFiles).toHaveLength(1);
			expect(project!.embedFiles[0].path).toBe('ref/Embedded.md');
		});
	});

	// ── Lines 410-424: onFileCreateOrModify – project caching and eviction ──

	describe('onFileCreateOrModify via vault events (lines 410-424)', () => {
		it('caches a new project file when created', async () => {
			// Capture the 'create' callback registered via vault.on
			let createCallback: ((file: TFile) => void) | null = null;
			mockPlugin.app.vault.on.mockImplementation((event: string, cb: (...args: any[]) => any) => {
				if (event === 'create') createCallback = cb as any;
				return { id: `mock-${event}` };
			});

			manager.registerVaultEvents();
			expect(createCallback).not.toBeNull();

			// Set up a project file that will be discovered
			const file = createMockFile('newproject/Project.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'New Project' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('New project body');

			// Fire the create event
			createCallback!(file);

			// Advance past the 500ms debounce
			await vi.advanceTimersByTimeAsync(600);

			// Should now be in cache
			const project = manager.getProjectForPath('newproject/somefile.md');
			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('New Project');
		});

		it('evicts a cached project when its tag is removed (modify event)', async () => {
			// First seed a project
			const file = createMockFile('project/Evict.md');
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Evictable' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			await manager.initialize();

			expect(manager.discoverProjects()).toHaveLength(1);

			// Capture the 'modify' callback
			let modifyCallback: ((file: TFile) => void) | null = null;
			mockPlugin.app.vault.on.mockImplementation((event: string, cb: (...args: any[]) => any) => {
				if (event === 'modify') modifyCallback = cb as any;
				return { id: `mock-${event}` };
			});

			manager.registerVaultEvents();

			// Now simulate the file losing its project tag
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: ['other-tag'] },
			});

			// Fire the modify event
			modifyCallback!(file);

			// Advance past the 500ms debounce
			await vi.advanceTimersByTimeAsync(600);

			// Should have been evicted
			expect(manager.discoverProjects()).toHaveLength(0);
		});

		it('updates the cache when a project file is modified', async () => {
			// Seed initial project
			const file = createMockFile('project/Update.md');
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([file]);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Original' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			await manager.initialize();

			expect(manager.discoverProjects()[0].name).toBe('Original');

			// Capture the 'modify' callback
			let modifyCallback: ((file: TFile) => void) | null = null;
			mockPlugin.app.vault.on.mockImplementation((event: string, cb: (...args: any[]) => any) => {
				if (event === 'modify') modifyCallback = cb as any;
				return { id: `mock-${event}` };
			});

			manager.registerVaultEvents();

			// Simulate modified frontmatter
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Updated' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('Updated body');

			// Fire modify event
			modifyCallback!(file);
			await vi.advanceTimersByTimeAsync(600);

			const projects = manager.discoverProjects();
			expect(projects).toHaveLength(1);
			expect(projects[0].name).toBe('Updated');
		});

		it('handles parse failure in onFileCreateOrModify gracefully', async () => {
			let createCallback: ((file: TFile) => void) | null = null;
			mockPlugin.app.vault.on.mockImplementation((event: string, cb: (...args: any[]) => any) => {
				if (event === 'create') createCallback = cb as any;
				return { id: `mock-${event}` };
			});

			manager.registerVaultEvents();

			const file = createMockFile('project/Failing.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Failing' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockRejectedValue(new Error('Disk read error'));

			createCallback!(file);
			await vi.advanceTimersByTimeAsync(600);

			// Should not be cached, and should have logged a warning
			expect(manager.discoverProjects()).toHaveLength(0);
			expect(mockPlugin.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to parse project'),
				expect.any(Error)
			);
		});
	});

	// ── Lines 239-243: rename event handler ────────────────────────────────

	describe('rename vault event (lines 239-243)', () => {
		it('evicts old path and re-caches under new path on rename', async () => {
			// Seed a project at the old path
			const oldFile = createMockFile('old/Project.md');
			mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([oldFile]);
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Renamed' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');
			await manager.initialize();

			expect(manager.discoverProjects()).toHaveLength(1);

			// Capture the 'rename' callback
			let renameCallback: ((file: TFile, oldPath: string) => void) | null = null;
			mockPlugin.app.vault.on.mockImplementation((event: string, cb: (...args: any[]) => any) => {
				if (event === 'rename') renameCallback = cb as any;
				return { id: `mock-${event}` };
			});

			manager.registerVaultEvents();

			// Create a new file representing the renamed location
			const newFile = createMockFile('new/Project.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Renamed' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('Renamed body');

			// Fire the rename event
			renameCallback!(newFile, 'old/Project.md');

			// Advance past debounce
			await vi.advanceTimersByTimeAsync(600);

			// Old path should be gone, new path should be cached
			expect(manager.getProjectForPath('old/somefile.md')).toBeNull();
			const project = manager.getProjectForPath('new/somefile.md');
			expect(project).not.toBeNull();
			expect(project!.config.name).toBe('Renamed');
		});
	});

	// ── Lines 332-333: cancelPendingRefresh when timer exists ──────────────

	describe('cancelPendingRefresh with existing timer (lines 332-333)', () => {
		it('cancels a pending timer when a second event arrives for the same file', async () => {
			// Capture the 'modify' callback
			let modifyCallback: ((file: TFile) => void) | null = null;
			mockPlugin.app.vault.on.mockImplementation((event: string, cb: (...args: any[]) => any) => {
				if (event === 'modify') modifyCallback = cb as any;
				return { id: `mock-${event}` };
			});

			manager.registerVaultEvents();

			const file = createMockFile('project/Debounce.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: { tags: [PROJECT_TAG], name: 'Debounced' },
				frontmatterPosition: { end: { offset: 0 } },
			});
			mockPlugin.app.vault.read.mockResolvedValue('');

			const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

			// Fire modify twice rapidly — second should cancel the first timer
			modifyCallback!(file);
			modifyCallback!(file);

			// clearTimeout should have been called for the first timer
			expect(clearTimeoutSpy).toHaveBeenCalled();

			// Advance past debounce — only one parse should happen
			await vi.advanceTimersByTimeAsync(600);

			// Should still cache the project (the second timer completed)
			const project = manager.getProjectForPath('project/somefile.md');
			expect(project).not.toBeNull();

			clearTimeoutSpy.mockRestore();
		});
	});
});
