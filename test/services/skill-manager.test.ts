import { SkillManager, findFrontmatterEndOffset } from '../../src/services/skill-manager';
// The mocked TFile/TFolder below take constructor args (path/children), unlike
// Obsidian's real types — cast to `any` so TS lets us pass them through.
import { TFile as TFileBase, TFolder as TFolderBase } from 'obsidian';
const TFile: any = TFileBase;
const TFolder: any = TFolderBase;

// Mock BundledSkillRegistry
vi.mock('../../src/services/bundled-skills', () => ({
	BundledSkillRegistry: {
		getSummaries: vi.fn().mockReturnValue([
			{ name: 'gemini-scribe-help', description: 'Help with plugin features' },
			{ name: 'obsidian-bases', description: 'Create Obsidian Bases' },
		]),
		loadSkill: vi.fn().mockImplementation((name: string) => {
			if (name === 'gemini-scribe-help') return '# Help\n\nState folder: <!-- STATE_FOLDER -->\n\nInstructions';
			if (name === 'obsidian-bases') return '# Bases\n\nSyntax guide';
			return null;
		}),
		readResource: vi.fn().mockImplementation((name: string, path: string) => {
			if (name === 'gemini-scribe-help' && path === 'references/agent-mode.md') return 'Agent mode docs';
			return null;
		}),
		listResources: vi.fn().mockImplementation((name: string) => {
			if (name === 'gemini-scribe-help') return ['references/agent-mode.md', 'references/settings.md'];
			return [];
		}),
		has: vi.fn().mockImplementation((name: string) => {
			return name === 'gemini-scribe-help' || name === 'obsidian-bases';
		}),
	},
}));

// Mock obsidian module using factory functions - vi.mock is hoisted so we
// can't reference variables declared later. We use inline classes instead.
vi.mock('obsidian', () => {
	class TFile {
		path: string;
		parent: { path: string } | null;
		basename: string;

		constructor(path: string) {
			this.path = path;
			this.parent = { path: path.substring(0, path.lastIndexOf('/')) };
			this.basename = path.split('/').pop()?.replace('.md', '') || '';
		}
	}

	class TFolder {
		path: string;
		name: string;
		children: any[];

		constructor(path: string, children: any[] = []) {
			this.path = path;
			this.name = path.split('/').pop() || '';
			this.children = children;
		}
	}

	return {
		TFile,
		TFolder,
		normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/'),
		Notice: vi.fn(),
	};
});

// Mock plugin with vault and metadataCache
const mockVault = {
	getAbstractFileByPath: vi.fn(),
	createFolder: vi.fn(),
	create: vi.fn(),
	read: vi.fn(),
	modify: vi.fn(),
	getMarkdownFiles: vi.fn(),
	adapter: {
		exists: vi.fn().mockResolvedValue(false),
		read: vi.fn().mockResolvedValue(''),
	},
};

const mockMetadataCache = {
	getFileCache: vi.fn(),
};

const mockFileManager = {
	processFrontMatter: vi.fn(),
};

const mockPlugin = {
	settings: {
		historyFolder: 'gemini-scribe',
	},
	app: {
		vault: mockVault,
		metadataCache: mockMetadataCache,
		fileManager: mockFileManager,
	},
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
} as any;

describe('SkillManager', () => {
	let manager: SkillManager;

	beforeEach(() => {
		vi.clearAllMocks();
		// clearAllMocks resets call history but keeps any custom implementations
		// from prior tests, so re-pin adapter defaults explicitly.
		mockVault.adapter.exists.mockReset().mockResolvedValue(false);
		mockVault.adapter.read.mockReset().mockResolvedValue('');
		mockPlugin.settings.fileLogging = false;
		// Pin the default state folder so tests that mutate it don't leak.
		mockPlugin.settings.historyFolder = 'gemini-scribe';
		manager = new SkillManager(mockPlugin);
	});

	describe('getSkillsFolderPath', () => {
		it('should return the correct skills folder path', () => {
			expect(manager.getSkillsFolderPath()).toBe('gemini-scribe/Skills');
		});
	});

	describe('discoverSkills', () => {
		it('should discover skills from subdirectories with SKILL.md', async () => {
			const skillFile = new TFile('gemini-scribe/Skills/code-review/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/Skills/code-review', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/Skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Skills') return skillsRoot;
				if (path === 'gemini-scribe/Skills/code-review/SKILL.md') return skillFile;
				return null;
			});

			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					name: 'code-review',
					description: 'Reviews code for quality and correctness',
				},
			});

			const skills = await manager.discoverSkills();

			// Vault skill + 2 bundled skills
			const vaultSkill = skills.find((s) => s.name === 'code-review');
			expect(vaultSkill).toBeDefined();
			expect(vaultSkill!.description).toBe('Reviews code for quality and correctness');
		});

		it('should return only bundled skills when skills directory does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const skills = await manager.discoverSkills();

			// Only bundled skills, no vault skills
			expect(skills.every((s) => s.path === 'bundled')).toBe(true);
			expect(skills.length).toBeGreaterThan(0);
		});

		it('should skip directories without SKILL.md', async () => {
			const emptyFolder = new TFolder('gemini-scribe/Skills/empty-skill', []);
			const skillsRoot = new TFolder('gemini-scribe/Skills', [emptyFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Skills') return skillsRoot;
				return null;
			});

			const skills = await manager.discoverSkills();

			// No vault skills found, only bundled skills
			expect(skills.find((s) => s.name === 'empty-skill')).toBeUndefined();
		});

		it('should skip skills with missing frontmatter', async () => {
			const skillFile = new TFile('gemini-scribe/Skills/bad-skill/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/Skills/bad-skill', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/Skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Skills') return skillsRoot;
				if (path === 'gemini-scribe/Skills/bad-skill/SKILL.md') return skillFile;
				return null;
			});

			mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: null });

			const skills = await manager.discoverSkills();

			// bad-skill should not be present, only bundled skills
			expect(skills.find((s) => s.name === 'bad-skill')).toBeUndefined();
			expect(mockPlugin.logger.warn).toHaveBeenCalled();
		});
	});

	describe('loadSkill', () => {
		it('should return skill body content without frontmatter', async () => {
			const file = new TFile('gemini-scribe/Skills/my-skill/SKILL.md');
			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue(
				'---\nname: my-skill\ndescription: test\n---\n\n# My Skill\n\nInstructions here'
			);
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatterPosition: { end: { offset: 42 } },
			});

			const content = await manager.loadSkill('my-skill');

			expect(content).toBe('# My Skill\n\nInstructions here');
		});

		it('should return null for non-existent skill', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const content = await manager.loadSkill('nonexistent');

			expect(content).toBeNull();
		});

		it('should return full content if no frontmatter position', async () => {
			const file = new TFile('gemini-scribe/Skills/simple/SKILL.md');
			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue('No frontmatter content');
			mockMetadataCache.getFileCache.mockReturnValue({});

			const content = await manager.loadSkill('simple');

			expect(content).toBe('No frontmatter content');
		});

		it('should return null for path traversal attempts', async () => {
			const content = await manager.loadSkill('../../../secret');
			expect(content).toBeNull();
		});

		it('should return null for invalid skill names', async () => {
			const content = await manager.loadSkill('Invalid Name');
			expect(content).toBeNull();
		});
	});

	describe('readSkillResource', () => {
		it('should read a resource file from skill directory', async () => {
			const file = new TFile('gemini-scribe/Skills/my-skill/references/ref.md');
			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue('Reference content');

			const content = await manager.readSkillResource('my-skill', 'references/ref.md');

			expect(content).toBe('Reference content');
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('gemini-scribe/Skills/my-skill/references/ref.md');
		});

		it('should return null for non-existent resource', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const content = await manager.readSkillResource('my-skill', 'bad/path.md');

			expect(content).toBeNull();
		});

		it('should return null for path traversal in skill name', async () => {
			const content = await manager.readSkillResource('../../../etc', 'passwd');
			expect(content).toBeNull();
		});

		it('should return null for path traversal in resource path', async () => {
			const content = await manager.readSkillResource('my-skill', '../../secret.md');
			expect(content).toBeNull();
		});

		it('should return null for absolute resource paths', async () => {
			const content = await manager.readSkillResource('my-skill', '/etc/passwd');
			expect(content).toBeNull();
		});

		describe('help skill debug log virtual resources', () => {
			beforeEach(() => {
				// readHelpDebugLog goes through vault.adapter, not getAbstractFileByPath.
				mockVault.getAbstractFileByPath.mockReturnValue(null);
			});

			it('should read debug.log via the help skill when fileLogging is on', async () => {
				mockPlugin.settings.fileLogging = true;
				mockVault.adapter.exists.mockImplementation(async (path: string) => path === 'gemini-scribe/debug.log');
				mockVault.adapter.read.mockResolvedValue('[2026-04-25T10:00:00] [ERROR] [Gemini Scribe] boom');

				const content = await manager.readSkillResource('gemini-scribe-help', 'debug.log');

				expect(content).toBe('[2026-04-25T10:00:00] [ERROR] [Gemini Scribe] boom');
				expect(mockVault.adapter.read).toHaveBeenCalledWith('gemini-scribe/debug.log');
			});

			it('should read debug.log.old when present', async () => {
				mockPlugin.settings.fileLogging = true;
				mockVault.adapter.exists.mockImplementation(async (path: string) => path === 'gemini-scribe/debug.log.old');
				mockVault.adapter.read.mockResolvedValue('rotated content');

				const content = await manager.readSkillResource('gemini-scribe-help', 'debug.log.old');

				expect(content).toBe('rotated content');
				expect(mockVault.adapter.read).toHaveBeenCalledWith('gemini-scribe/debug.log.old');
			});

			it('should return null when fileLogging is disabled', async () => {
				mockPlugin.settings.fileLogging = false;
				mockVault.adapter.exists.mockResolvedValue(true);

				const content = await manager.readSkillResource('gemini-scribe-help', 'debug.log');

				expect(content).toBeNull();
				// Must not even probe disk when the user has opted out.
				expect(mockVault.adapter.exists).not.toHaveBeenCalled();
				expect(mockVault.adapter.read).not.toHaveBeenCalled();
			});

			it('should return null when log file does not exist', async () => {
				mockPlugin.settings.fileLogging = true;
				mockVault.adapter.exists.mockResolvedValue(false);

				const content = await manager.readSkillResource('gemini-scribe-help', 'debug.log');

				expect(content).toBeNull();
				expect(mockVault.adapter.read).not.toHaveBeenCalled();
			});

			it('should not expose debug.log on other skills', async () => {
				mockPlugin.settings.fileLogging = true;
				mockVault.adapter.exists.mockResolvedValue(true);
				mockVault.adapter.read.mockResolvedValue('should not be returned');

				const content = await manager.readSkillResource('gemini-scribe', 'debug.log');

				expect(content).toBeNull();
				expect(mockVault.adapter.read).not.toHaveBeenCalled();
			});

			it('should still reject path traversal even for the help skill', async () => {
				mockPlugin.settings.fileLogging = true;
				const content = await manager.readSkillResource('gemini-scribe-help', '../debug.log');
				expect(content).toBeNull();
			});
		});
	});

	describe('listSkillResources', () => {
		beforeEach(() => {
			// Default: no vault skill dir, no debug log files.
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.adapter.exists.mockResolvedValue(false);
		});

		it('should fall through to bundled resources when no vault folder', async () => {
			const resources = await manager.listSkillResources('gemini-scribe-help');
			expect(resources).toEqual(expect.arrayContaining(['references/agent-mode.md', 'references/settings.md']));
		});

		it('should append debug.log resources for the help skill when fileLogging is on and files exist', async () => {
			mockPlugin.settings.fileLogging = true;
			mockVault.adapter.exists.mockImplementation(
				async (path: string) => path === 'gemini-scribe/debug.log' || path === 'gemini-scribe/debug.log.old'
			);

			const resources = await manager.listSkillResources('gemini-scribe-help');

			expect(resources).toEqual(expect.arrayContaining(['debug.log', 'debug.log.old']));
		});

		it('should only include logs that exist on disk', async () => {
			mockPlugin.settings.fileLogging = true;
			mockVault.adapter.exists.mockImplementation(async (path: string) => path === 'gemini-scribe/debug.log');

			const resources = await manager.listSkillResources('gemini-scribe-help');

			expect(resources).toContain('debug.log');
			expect(resources).not.toContain('debug.log.old');
		});

		it('should omit debug logs when fileLogging is disabled', async () => {
			mockPlugin.settings.fileLogging = false;
			mockVault.adapter.exists.mockResolvedValue(true);

			const resources = await manager.listSkillResources('gemini-scribe-help');

			expect(resources).not.toContain('debug.log');
			expect(resources).not.toContain('debug.log.old');
		});

		it('should not add debug logs to other skills', async () => {
			mockPlugin.settings.fileLogging = true;
			mockVault.adapter.exists.mockResolvedValue(true);

			const resources = await manager.listSkillResources('obsidian-bases');

			expect(resources).not.toContain('debug.log');
			expect(resources).not.toContain('debug.log.old');
		});
	});

	describe('getSkillSummaries', () => {
		it('should return name and description only', async () => {
			const skillFile = new TFile('gemini-scribe/Skills/test-skill/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/Skills/test-skill', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/Skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Skills') return skillsRoot;
				if (path === 'gemini-scribe/Skills/test-skill/SKILL.md') return skillFile;
				return null;
			});

			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					name: 'test-skill',
					description: 'A test skill',
					license: 'MIT',
					metadata: { author: 'test' },
				},
			});

			const summaries = await manager.getSkillSummaries();

			// Vault skill + bundled skills
			const testSkill = summaries.find((s) => s.name === 'test-skill');
			expect(testSkill).toBeDefined();
			expect(testSkill).toEqual({
				name: 'test-skill',
				description: 'A test skill',
			});
			// Should NOT include license or metadata
			expect((testSkill as any).license).toBeUndefined();
		});
	});

	describe('createSkill', () => {
		it('should create a skill directory and SKILL.md using processFrontMatter', async () => {
			const createdFile = new TFile('gemini-scribe/Skills/new-skill/SKILL.md');
			// createSkill flow: duplicate check + ensureFolderExists (skill dir)
			const folderResponses: Record<string, InstanceType<typeof TFolder> | null> = {};
			mockVault.createFolder.mockImplementation(async (path: string) => {
				// After createFolder, mark the folder as existing
				folderResponses[path] = new TFolder(path);
			});
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				// Return TFolder if it was "created", null otherwise
				return folderResponses[path] || null;
			});
			mockVault.create.mockResolvedValue(createdFile);
			mockFileManager.processFrontMatter.mockImplementation(async (_file: any, callback: (fm: any) => void) => {
				const fm: Record<string, any> = {};
				callback(fm);
				// Verify frontmatter was set correctly
				expect(fm.name).toBe('new-skill');
				expect(fm.description).toBe('A new skill');
			});

			const path = await manager.createSkill('new-skill', 'A new skill', '# Instructions\n\nDo stuff');

			expect(mockVault.createFolder).toHaveBeenCalledWith('gemini-scribe/Skills/new-skill');
			expect(mockVault.create).toHaveBeenCalledWith(
				'gemini-scribe/Skills/new-skill/SKILL.md',
				expect.stringContaining('# Instructions')
			);
			expect(mockFileManager.processFrontMatter).toHaveBeenCalledWith(createdFile, expect.any(Function));
			expect(path).toBe('gemini-scribe/Skills/new-skill/SKILL.md');
		});

		it('should throw error for duplicate skill', async () => {
			const existingFolder = new TFolder('gemini-scribe/Skills/existing');
			// createSkill checks if skill dir already exists
			const folderResponses: Record<string, any> = {
				'gemini-scribe/Skills/existing': existingFolder,
			};
			mockVault.createFolder.mockImplementation(async (path: string) => {
				folderResponses[path] = new TFolder(path);
			});
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				return folderResponses[path] || null;
			});

			await expect(manager.createSkill('existing', 'desc', 'content')).rejects.toThrow('already exists');
		});

		it('should throw error for invalid skill name', async () => {
			await expect(manager.createSkill('Invalid Name', 'desc', 'content')).rejects.toThrow();
		});
	});

	describe('validateSkillName', () => {
		it('should accept valid names', () => {
			expect(manager.validateSkillName('code-review').valid).toBe(true);
			expect(manager.validateSkillName('my-skill').valid).toBe(true);
			expect(manager.validateSkillName('a').valid).toBe(true);
			expect(manager.validateSkillName('abc123').valid).toBe(true);
			expect(manager.validateSkillName('skill-v2').valid).toBe(true);
		});

		it('should reject empty names', () => {
			expect(manager.validateSkillName('').valid).toBe(false);
			expect(manager.validateSkillName(null as any).valid).toBe(false);
			expect(manager.validateSkillName(undefined as any).valid).toBe(false);
		});

		it('should reject names with uppercase', () => {
			expect(manager.validateSkillName('CodeReview').valid).toBe(false);
		});

		it('should reject names starting with hyphen', () => {
			expect(manager.validateSkillName('-skill').valid).toBe(false);
		});

		it('should reject names ending with hyphen', () => {
			expect(manager.validateSkillName('skill-').valid).toBe(false);
		});

		it('should reject names with consecutive hyphens', () => {
			const result = manager.validateSkillName('code--review');
			expect(result.valid).toBe(false);
			expect(result.error).toContain('consecutive hyphens');
		});

		it('should reject names exceeding max length', () => {
			const longName = 'a'.repeat(65);
			expect(manager.validateSkillName(longName).valid).toBe(false);
		});

		it('should reject names with special characters', () => {
			expect(manager.validateSkillName('skill_name').valid).toBe(false);
			expect(manager.validateSkillName('skill.name').valid).toBe(false);
			expect(manager.validateSkillName('skill name').valid).toBe(false);
		});
	});

	describe('bundled skill integration', () => {
		describe('discoverSkills', () => {
			it('should include bundled skills when no vault skills exist', async () => {
				mockVault.getAbstractFileByPath.mockReturnValue(null);

				const skills = await manager.discoverSkills();

				expect(skills).toHaveLength(2);
				expect(skills.map((s) => s.name)).toContain('gemini-scribe-help');
				expect(skills.map((s) => s.name)).toContain('obsidian-bases');
			});

			it('should let vault skills override bundled skills with same name', async () => {
				const skillFile = new TFile('gemini-scribe/Skills/gemini-scribe-help/SKILL.md');
				const skillFolder = new TFolder('gemini-scribe/Skills/gemini-scribe-help', [skillFile]);
				const skillsRoot = new TFolder('gemini-scribe/Skills', [skillFolder]);

				mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
					if (path === 'gemini-scribe/Skills') return skillsRoot;
					if (path === 'gemini-scribe/Skills/gemini-scribe-help/SKILL.md') return skillFile;
					return null;
				});

				mockMetadataCache.getFileCache.mockReturnValue({
					frontmatter: {
						name: 'gemini-scribe-help',
						description: 'My custom help',
					},
				});

				const skills = await manager.discoverSkills();

				const helpSkill = skills.find((s) => s.name === 'gemini-scribe-help');
				expect(helpSkill).toBeDefined();
				expect(helpSkill!.description).toBe('My custom help');

				// obsidian-bases should still come from bundled
				expect(skills.map((s) => s.name)).toContain('obsidian-bases');
			});
		});

		describe('loadSkill', () => {
			it('should fall back to bundled skill when vault skill not found', async () => {
				mockVault.getAbstractFileByPath.mockReturnValue(null);

				const content = await manager.loadSkill('gemini-scribe-help');

				// The help skill's <!-- STATE_FOLDER --> placeholder resolves to the
				// configured state folder (default 'gemini-scribe').
				expect(content).toBe('# Help\n\nState folder: gemini-scribe\n\nInstructions');
				expect(content).not.toContain('<!-- STATE_FOLDER -->');
			});

			it('should resolve the help skill STATE_FOLDER placeholder to a custom state folder', async () => {
				mockVault.getAbstractFileByPath.mockReturnValue(null);
				mockPlugin.settings.historyFolder = 'Resources';

				const content = await manager.loadSkill('gemini-scribe-help');

				expect(content).toBe('# Help\n\nState folder: Resources\n\nInstructions');
				expect(content).not.toContain('<!-- STATE_FOLDER -->');
			});

			it('should prefer vault skill over bundled skill', async () => {
				const rawContent = '---\nname: gemini-scribe-help\n---\n\n# Custom Help';
				const file = new TFile('gemini-scribe/Skills/gemini-scribe-help/SKILL.md');
				mockVault.getAbstractFileByPath.mockReturnValue(file);
				mockVault.read.mockResolvedValue(rawContent);
				mockMetadataCache.getFileCache.mockReturnValue({
					frontmatterPosition: { end: { offset: rawContent.indexOf('---\n\n') + 4 } },
				});

				const content = await manager.loadSkill('gemini-scribe-help');

				expect(content).toBe('# Custom Help');
			});
		});

		describe('readSkillResource', () => {
			it('should fall back to bundled resource when vault resource not found', async () => {
				mockVault.getAbstractFileByPath.mockReturnValue(null);

				const content = await manager.readSkillResource('gemini-scribe-help', 'references/agent-mode.md');

				expect(content).toBe('Agent mode docs');
			});
		});

		describe('listSkillResources', () => {
			it('should fall back to bundled resources when vault skill not found', async () => {
				mockVault.getAbstractFileByPath.mockReturnValue(null);

				const resources = await manager.listSkillResources('gemini-scribe-help');

				expect(resources).toContain('references/agent-mode.md');
				expect(resources).toContain('references/settings.md');
			});
		});
	});

	describe('updateSkill', () => {
		it('should update only the body content while preserving frontmatter', async () => {
			const file = new TFile('gemini-scribe/Skills/my-skill/SKILL.md');
			const originalContent = '---\nname: my-skill\ndescription: Original desc\n---\n\n# Old Instructions';

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue(originalContent);
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatterPosition: { end: { offset: originalContent.indexOf('---\n\n') + 3 } },
			});
			const path = await manager.updateSkill('my-skill', undefined, '# New Instructions');

			expect(mockVault.modify).toHaveBeenCalledWith(
				file,
				expect.stringContaining('---\nname: my-skill\ndescription: Original desc\n---')
			);
			expect(mockVault.modify).toHaveBeenCalledWith(file, expect.stringContaining('# New Instructions'));
			expect(mockFileManager.processFrontMatter).not.toHaveBeenCalled();
			expect(path).toBe('gemini-scribe/Skills/my-skill/SKILL.md');
		});

		it('should update only the description via processFrontMatter', async () => {
			const file = new TFile('gemini-scribe/Skills/my-skill/SKILL.md');
			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockFileManager.processFrontMatter.mockImplementation(async (_file: any, callback: (fm: any) => void) => {
				const fm: Record<string, any> = {};
				callback(fm);
				expect(fm.description).toBe('Updated desc');
			});

			const path = await manager.updateSkill('my-skill', 'Updated desc');

			expect(mockFileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
			expect(path).toBe('gemini-scribe/Skills/my-skill/SKILL.md');
		});

		it('should throw when neither description nor content is provided', async () => {
			await expect(manager.updateSkill('my-skill', undefined, undefined)).rejects.toThrow(
				'At least one of description or content must be provided'
			);
		});

		it('should throw when skill does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			await expect(manager.updateSkill('nonexistent', 'desc')).rejects.toThrow('not found');
		});

		it('should throw for invalid skill name', async () => {
			await expect(manager.updateSkill('Invalid Name', 'desc')).rejects.toThrow();
		});

		it('should update both description and content when both are provided', async () => {
			const file = new TFile('gemini-scribe/Skills/my-skill/SKILL.md');
			const originalContent = '---\nname: my-skill\ndescription: Old\n---\n\nOld body';

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue(originalContent);
			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatterPosition: { end: { offset: originalContent.indexOf('---\n\n') + 3 } },
			});
			mockFileManager.processFrontMatter.mockImplementation(async (_file: any, callback: (fm: any) => void) => {
				const fm: Record<string, any> = {};
				callback(fm);
			});

			await manager.updateSkill('my-skill', 'New desc', 'New body');

			expect(mockVault.modify).toHaveBeenCalled();
			expect(mockFileManager.processFrontMatter).toHaveBeenCalled();
		});

		it('should use findFrontmatterEndOffset fallback when metadata cache has no position', async () => {
			const file = new TFile('gemini-scribe/Skills/my-skill/SKILL.md');
			const originalContent = '---\nname: my-skill\n---\nOld body';

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue(originalContent);
			mockMetadataCache.getFileCache.mockReturnValue({});
			await manager.updateSkill('my-skill', undefined, 'Replaced body');

			expect(mockVault.modify).toHaveBeenCalledWith(file, expect.stringContaining('Replaced body'));
		});
	});

	describe('listSkillResources with vault folder', () => {
		it('should list files recursively and exclude SKILL.md', async () => {
			const skillMd = new TFile('gemini-scribe/Skills/my-skill/SKILL.md');
			const ref1 = new TFile('gemini-scribe/Skills/my-skill/references/ref1.md');
			const ref2 = new TFile('gemini-scribe/Skills/my-skill/references/ref2.md');
			const refsFolder = new TFolder('gemini-scribe/Skills/my-skill/references', [ref1, ref2]);
			const skillFolder = new TFolder('gemini-scribe/Skills/my-skill', [skillMd, refsFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/Skills/my-skill') return skillFolder;
				return null;
			});

			const resources = await manager.listSkillResources('my-skill');

			expect(resources).toContain('references/ref1.md');
			expect(resources).toContain('references/ref2.md');
			expect(resources).not.toContain('SKILL.md');
		});

		it('should return empty array for invalid skill name', async () => {
			const resources = await manager.listSkillResources('Invalid Name');
			expect(resources).toEqual([]);
		});
	});

	describe('validateSkillName edge cases', () => {
		it('should accept a name at exactly max length (64 chars)', () => {
			const name64 = 'a'.repeat(64);
			expect(manager.validateSkillName(name64).valid).toBe(true);
		});

		it('should reject a name at max length + 1 (65 chars)', () => {
			const name65 = 'a'.repeat(65);
			const result = manager.validateSkillName(name65);
			expect(result.valid).toBe(false);
			expect(result.error).toContain('64 characters');
		});

		it('should accept a name with digits only', () => {
			// Single digit fails the regex (must start with lowercase alpha)
			expect(manager.validateSkillName('1').valid).toBe(false);
			// But alphanumeric with leading letter is fine
			expect(manager.validateSkillName('a1').valid).toBe(true);
		});

		it('should accept a single character name', () => {
			expect(manager.validateSkillName('a').valid).toBe(true);
			expect(manager.validateSkillName('z').valid).toBe(true);
		});

		it('should reject names with path separators', () => {
			expect(manager.validateSkillName('my/skill').valid).toBe(false);
			expect(manager.validateSkillName('my\\skill').valid).toBe(false);
		});
	});
});

describe('findFrontmatterEndOffset', () => {
	it('returns the closing --- offset for a standard LF frontmatter block', () => {
		const content = '---\nname: foo\ndescription: bar\n---\nBody text\n';
		const end = findFrontmatterEndOffset(content);
		expect(end).toBeDefined();
		// Slicing up to `end` should give the full frontmatter including the closing ---
		expect(content.slice(0, end!)).toBe('---\nname: foo\ndescription: bar\n---');
	});

	it('handles CRLF line endings', () => {
		const content = '---\r\nname: foo\r\ndescription: bar\r\n---\r\nBody\r\n';
		const end = findFrontmatterEndOffset(content);
		expect(end).toBeDefined();
		expect(content.slice(0, end!)).toBe('---\r\nname: foo\r\ndescription: bar\r\n---');
	});

	it('does not terminate on --- that appears inside a multi-line YAML string value', () => {
		// The non-greedy regex `---[\s\S]*?---` would erroneously terminate at the
		// `---` embedded in the description block, truncating real frontmatter.
		const content = '---\nname: foo\ndescription: |\n  line one\n  ---\n  still in description\n---\nActual body\n';
		const end = findFrontmatterEndOffset(content);
		expect(end).toBeDefined();
		// The only valid closing marker is the `---` at column 0 on its own line before "Actual body".
		expect(content.slice(end!).replace(/^\n/, '')).toBe('Actual body\n');
	});

	it('returns undefined when the content does not start with ---', () => {
		expect(findFrontmatterEndOffset('no frontmatter here\n')).toBeUndefined();
		expect(findFrontmatterEndOffset('# Just a heading\n---\nbody\n')).toBeUndefined();
	});

	it('returns undefined when the frontmatter is never closed', () => {
		expect(findFrontmatterEndOffset('---\nname: foo\ndescription: bar\nbody without close\n')).toBeUndefined();
	});

	it('accepts the alternative `...` YAML closing marker', () => {
		const content = '---\nname: foo\n...\nBody\n';
		const end = findFrontmatterEndOffset(content);
		expect(end).toBeDefined();
		expect(content.slice(0, end!)).toBe('---\nname: foo\n...');
	});
});
