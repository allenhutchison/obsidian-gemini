import { SkillManager } from '../../src/services/skill-manager';

// Mock obsidian module using factory functions - jest.mock is hoisted so we
// can't reference variables declared later. We use inline classes instead.
jest.mock('obsidian', () => {
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
	};
});

// Import after mock so instanceof checks work
const { TFile, TFolder } = jest.requireMock('obsidian');

// Mock plugin with vault and metadataCache
const mockVault = {
	getAbstractFileByPath: jest.fn(),
	createFolder: jest.fn(),
	create: jest.fn(),
	read: jest.fn(),
	getMarkdownFiles: jest.fn(),
};

const mockMetadataCache = {
	getFileCache: jest.fn(),
};

const mockFileManager = {
	processFrontMatter: jest.fn(),
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
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
		info: jest.fn(),
	},
} as any;

describe('SkillManager', () => {
	let manager: SkillManager;

	beforeEach(() => {
		jest.clearAllMocks();
		manager = new SkillManager(mockPlugin);
	});

	describe('getSkillsFolderPath', () => {
		it('should return the correct skills folder path', () => {
			expect(manager.getSkillsFolderPath()).toBe('gemini-scribe/skills');
		});
	});

	describe('ensureSkillsDirectory', () => {
		it('should create skills directory if it does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockResolvedValue(undefined);

			await manager.ensureSkillsDirectory();

			expect(mockVault.createFolder).toHaveBeenCalledWith('gemini-scribe/skills');
		});

		it('should not recreate skills directory if it exists', async () => {
			const folder = new TFolder('gemini-scribe/skills');
			mockVault.getAbstractFileByPath.mockReturnValue(folder);
			mockVault.createFolder.mockResolvedValue(undefined);

			await manager.ensureSkillsDirectory();

			// Should only have been called for the base historyFolder, not skills
			expect(mockVault.createFolder).toHaveBeenCalledTimes(1);
		});
	});

	describe('discoverSkills', () => {
		it('should discover skills from subdirectories with SKILL.md', async () => {
			const skillFile = new TFile('gemini-scribe/skills/code-review/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/skills/code-review', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/skills') return skillsRoot;
				if (path === 'gemini-scribe/skills/code-review/SKILL.md') return skillFile;
				return null;
			});

			mockMetadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					name: 'code-review',
					description: 'Reviews code for quality and correctness',
				},
			});

			const skills = await manager.discoverSkills();

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe('code-review');
			expect(skills[0].description).toBe('Reviews code for quality and correctness');
		});

		it('should return empty array when skills directory does not exist', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);

			const skills = await manager.discoverSkills();

			expect(skills).toEqual([]);
		});

		it('should skip directories without SKILL.md', async () => {
			const emptyFolder = new TFolder('gemini-scribe/skills/empty-skill', []);
			const skillsRoot = new TFolder('gemini-scribe/skills', [emptyFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/skills') return skillsRoot;
				return null;
			});

			const skills = await manager.discoverSkills();

			expect(skills).toEqual([]);
		});

		it('should skip skills with missing frontmatter', async () => {
			const skillFile = new TFile('gemini-scribe/skills/bad-skill/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/skills/bad-skill', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/skills') return skillsRoot;
				if (path === 'gemini-scribe/skills/bad-skill/SKILL.md') return skillFile;
				return null;
			});

			mockMetadataCache.getFileCache.mockReturnValue({ frontmatter: null });

			const skills = await manager.discoverSkills();

			expect(skills).toEqual([]);
			expect(mockPlugin.logger.warn).toHaveBeenCalled();
		});
	});

	describe('loadSkill', () => {
		it('should return skill body content without frontmatter', async () => {
			const file = new TFile('gemini-scribe/skills/my-skill/SKILL.md');
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
			const file = new TFile('gemini-scribe/skills/simple/SKILL.md');
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
			const file = new TFile('gemini-scribe/skills/my-skill/references/ref.md');
			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue('Reference content');

			const content = await manager.readSkillResource('my-skill', 'references/ref.md');

			expect(content).toBe('Reference content');
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('gemini-scribe/skills/my-skill/references/ref.md');
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
	});

	describe('getSkillSummaries', () => {
		it('should return name and description only', async () => {
			const skillFile = new TFile('gemini-scribe/skills/test-skill/SKILL.md');
			const skillFolder = new TFolder('gemini-scribe/skills/test-skill', [skillFile]);
			const skillsRoot = new TFolder('gemini-scribe/skills', [skillFolder]);

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/skills') return skillsRoot;
				if (path === 'gemini-scribe/skills/test-skill/SKILL.md') return skillFile;
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

			expect(summaries).toHaveLength(1);
			expect(summaries[0]).toEqual({
				name: 'test-skill',
				description: 'A test skill',
			});
			// Should NOT include license or metadata
			expect((summaries[0] as any).license).toBeUndefined();
		});
	});

	describe('createSkill', () => {
		it('should create a skill directory and SKILL.md using processFrontMatter', async () => {
			const createdFile = new TFile('gemini-scribe/skills/new-skill/SKILL.md');
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockResolvedValue(undefined);
			mockVault.create.mockResolvedValue(createdFile);
			mockFileManager.processFrontMatter.mockImplementation(async (_file: any, callback: (fm: any) => void) => {
				const fm: Record<string, any> = {};
				callback(fm);
				// Verify frontmatter was set correctly
				expect(fm.name).toBe('new-skill');
				expect(fm.description).toBe('A new skill');
			});

			const path = await manager.createSkill('new-skill', 'A new skill', '# Instructions\n\nDo stuff');

			expect(mockVault.createFolder).toHaveBeenCalledWith('gemini-scribe/skills/new-skill');
			expect(mockVault.create).toHaveBeenCalledWith(
				'gemini-scribe/skills/new-skill/SKILL.md',
				expect.stringContaining('# Instructions')
			);
			expect(mockFileManager.processFrontMatter).toHaveBeenCalledWith(createdFile, expect.any(Function));
			expect(path).toBe('gemini-scribe/skills/new-skill/SKILL.md');
		});

		it('should throw error for duplicate skill', async () => {
			const existingFolder = new TFolder('gemini-scribe/skills/existing');
			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'gemini-scribe/skills/existing') return existingFolder;
				if (path === 'gemini-scribe/skills') return null; // for ensureSkillsDirectory
				return null;
			});
			mockVault.createFolder.mockResolvedValue(undefined);

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
});
