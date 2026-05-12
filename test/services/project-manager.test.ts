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
