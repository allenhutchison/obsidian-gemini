import { SkillManager } from '../../src/services/skill-manager';
import { TFile, TFolder, Vault, Plugin } from 'obsidian';
import { DEFAULT_SKILL_STRUCTURES } from '../../src/services/default-skills';

// Mock logger
const mockLogger = {
	log: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
};

// Mock dependencies
const createMockVault = () => ({
	on: jest.fn(),
	getAbstractFileByPath: jest.fn(),
	read: jest.fn(),
	create: jest.fn(),
	createFolder: jest.fn(),
});

const createMockPlugin = (vault: any) => ({
	app: {
		vault,
		workspace: {
			on: jest.fn(),
		},
	},
	settings: {
		skillsFolder: 'Gemini/Skills',
	},
	saveSettings: jest.fn(),
	registerEvent: jest.fn(),
	logger: mockLogger,
});

// Mock obsidian module partially
jest.mock('obsidian', () => ({
	parseYaml: jest.fn((yaml: string) => {
		// Basic parser for test strings
		const result: any = {};
		const lines = yaml.split('\n');
		for (const line of lines) {
			const [key, val] = line.split(':');
			if (key && val) {
				const cleanVal = val.trim();
				if (cleanVal.startsWith('[') && cleanVal.endsWith(']')) {
					result[key.trim()] = cleanVal
						.slice(1, -1)
						.split(',')
						.map((s) => s.trim());
				} else {
					result[key.trim()] = cleanVal;
				}
			}
		}
		return result;
	}),
	Notice: jest.fn(),
	TFile: class {
		path: string;
		constructor(path: string) {
			this.path = path;
		}
	},
	TFolder: class {
		path: string;
		children: any[];
		constructor(path: string) {
			this.path = path;
			this.children = [];
		}
	},
	Vault: class {},
	normalizePath: jest.fn((path: string) => path),
}));

describe('SkillManager', () => {
	let mockVault: any;
	let mockPlugin: any;
	let skillManager: SkillManager;

	beforeEach(() => {
		jest.clearAllMocks();
		mockVault = createMockVault();
		mockPlugin = createMockPlugin(mockVault);
		skillManager = new SkillManager(mockPlugin as any);
	});

	describe('parseSkillContent', () => {
		it('should extract metadata from valid frontmatter and IGNORE instructions', () => {
			const content = `---
name: test-skill
description: A test skill
tools: [read_file]
---
# Instructions
Do something cool.
`;
			const result = skillManager.parseSkillContent(content, 'test/path.md');

			expect(result.success).toBe(true);
			expect(result.skill).toBeDefined();
			expect(result.skill?.name).toBe('test-skill');
			expect(result.skill?.description).toBe('A test skill');
			expect(result.skill?.tools).toEqual(['read_file']);

			// Critical check: instructions should NOT be present on the skill object
			expect((result.skill as any).instructions).toBeUndefined();
		});

		it('should return error if frontmatter is missing', () => {
			const content = `# Just markdown
No frontmatter here.
`;
			const result = skillManager.parseSkillContent(content, 'test/path.md');

			expect(result.success).toBe(false);
			expect(result.error).toContain('Missing YAML frontmatter');
		});

		it('should return error if content is empty', () => {
			const result = skillManager.parseSkillContent('', 'test/path.md');
			expect(result.success).toBe(false);
			expect(result.error).toBe('Empty file');
		});
	});

	describe('getSkillsPromptXML', () => {
		it('should generate valid XML for available skills', () => {
			// Inject mock skills directly into the map for testing
			(skillManager as any).skills.set('skill1', {
				name: 'skill1',
				description: 'Description 1',
				tools: ['tool1'],
				sourcePath: 'path/to/skill1.md',
			});

			(skillManager as any).skills.set('skill2', {
				name: 'skill2',
				description: 'Description 2',
				tools: [],
				sourcePath: 'path/to/skill2.md',
			});

			const xml = skillManager.getSkillsPromptXML();

			expect(xml).toContain('<available_skills>');
			expect(xml).toContain('<skill>');
			expect(xml).toContain('<name>skill1</name>');
			expect(xml).toContain('<description>Description 1</description>');
			expect(xml).toContain('<location>path/to/skill1.md</location>');
			expect(xml).toContain('<tools>tool1</tools>');

			expect(xml).toContain('<name>skill2</name>');
			expect(xml).toContain('<description>Description 2</description>');
			// skill2 has no tools, check if <tools> tag is omitted or empty based on implementation
			// Implementation: const toolsList = skill.tools.length > 0 ? ... : '';
			expect(xml).not.toContain('<tools></tools>');
		});

		it('should return null if no skills available', () => {
			(skillManager as any).skills.clear();
			const xml = skillManager.getSkillsPromptXML();
			expect(xml).toBeNull();
		});
	});

	describe('ensureFolderExists (via ensureDefaultSkills)', () => {
		it('should create skill folders when they do not exist', async () => {
			// Simulate no folders exist
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockResolvedValue(undefined);
			mockVault.create.mockResolvedValue(undefined);

			await (skillManager as any).ensureDefaultSkills();

			// Should create root skills folder + 3 skill folders + 3 references folders = 7 folders
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills/obsidian-markdown');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills/obsidian-markdown/references');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills/obsidian-bases');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills/obsidian-bases/references');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills/json-canvas');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Gemini/Skills/json-canvas/references');
		});

		it('should not create folders if they already exist', async () => {
			// Simulate all folders exist
			mockVault.getAbstractFileByPath.mockReturnValue({ path: 'exists' });

			await (skillManager as any).ensureDefaultSkills();

			// createFolder should not be called if folders exist
			expect(mockVault.createFolder).not.toHaveBeenCalled();
		});
	});

	describe('createFileIfNotExists (via ensureDefaultSkills)', () => {
		it('should create SKILL.md files for each default skill', async () => {
			// Simulate no files exist
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);
			mockVault.createFolder.mockResolvedValue(undefined);

			await (skillManager as any).ensureDefaultSkills();

			// Should create SKILL.md for each skill
			expect(mockVault.create).toHaveBeenCalledWith('Gemini/Skills/obsidian-markdown/SKILL.md', expect.any(String));
			expect(mockVault.create).toHaveBeenCalledWith('Gemini/Skills/obsidian-bases/SKILL.md', expect.any(String));
			expect(mockVault.create).toHaveBeenCalledWith('Gemini/Skills/json-canvas/SKILL.md', expect.any(String));
		});

		it('should create reference files for each skill', async () => {
			// Simulate no files exist
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(undefined);
			mockVault.createFolder.mockResolvedValue(undefined);

			await (skillManager as any).ensureDefaultSkills();

			// Check obsidian-markdown references (5 files)
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-markdown/references/callouts.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-markdown/references/properties.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-markdown/references/mermaid.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-markdown/references/math.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-markdown/references/embeds.md',
				expect.any(String)
			);

			// Check obsidian-bases references (3 files)
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-bases/references/filters.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-bases/references/formulas.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/obsidian-bases/references/view-types.md',
				expect.any(String)
			);

			// Check json-canvas references (2 files)
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/json-canvas/references/nodes.md',
				expect.any(String)
			);
			expect(mockVault.create).toHaveBeenCalledWith(
				'Gemini/Skills/json-canvas/references/edges.md',
				expect.any(String)
			);
		});

		it('should not create files if they already exist', async () => {
			// Simulate all files exist
			mockVault.getAbstractFileByPath.mockReturnValue({ path: 'exists' });

			await (skillManager as any).ensureDefaultSkills();

			// create should not be called if files exist
			expect(mockVault.create).not.toHaveBeenCalled();
		});

		it('should handle file creation errors gracefully', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.createFolder.mockResolvedValue(undefined);
			mockVault.create.mockRejectedValue(new Error('Write error'));

			// Should not throw
			await expect((skillManager as any).ensureDefaultSkills()).resolves.not.toThrow();

			// Should log warning
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	describe('loadSkills', () => {
		// Get the mocked classes to create proper instances that pass instanceof checks
		const { TFile: MockTFile, TFolder: MockTFolder } = jest.requireMock('obsidian');

		it('should load skills from folder structure', async () => {
			// Create mock folder structure using mocked classes
			const mockSkillFile = new MockTFile('Gemini/Skills/test-skill/SKILL.md');
			mockSkillFile.extension = 'md';

			const mockSkillFolder = new MockTFolder('Gemini/Skills/test-skill');
			mockSkillFolder.children = [mockSkillFile];

			const mockRootFolder = new MockTFolder('Gemini/Skills');
			mockRootFolder.children = [mockSkillFolder];

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'Gemini/Skills') return mockRootFolder;
				if (path === 'Gemini/Skills/test-skill/SKILL.md') return mockSkillFile;
				return null;
			});

			mockVault.read.mockResolvedValue(`---
name: test-skill
description: A test skill
---
# Instructions
Do something.
`);

			await skillManager.loadSkills();

			// Verify skill was loaded
			const skills = skillManager.getAvailableSkills();
			expect(skills.length).toBe(1);
			expect(skills[0].name).toBe('test-skill');
		});

		it('should skip non-folder entries in skills directory', async () => {
			// Create a non-folder file in the root using mocked class
			const mockReadmeFile = new MockTFile('Gemini/Skills/README.md');
			mockReadmeFile.extension = 'md';

			const mockRootFolder = new MockTFolder('Gemini/Skills');
			mockRootFolder.children = [mockReadmeFile]; // Contains a file, not a folder

			mockVault.getAbstractFileByPath.mockImplementation((path: string) => {
				if (path === 'Gemini/Skills') return mockRootFolder;
				return null;
			});

			await skillManager.loadSkills();

			// Should have no skills because README.md is not a folder
			const skills = skillManager.getAvailableSkills();
			expect(skills.length).toBe(0);
		});

		it('should clear existing skills before loading', async () => {
			// Pre-populate with a skill
			(skillManager as any).skills.set('old-skill', {
				name: 'old-skill',
				description: 'Old skill',
				tools: [],
				sourcePath: 'old/path.md',
			});

			mockVault.getAbstractFileByPath.mockReturnValue(null);

			await skillManager.loadSkills();

			// Old skill should be cleared
			const skills = skillManager.getAvailableSkills();
			expect(skills.length).toBe(0);
		});
	});

	describe('DEFAULT_SKILL_STRUCTURES', () => {
		it('should have 3 default skills defined', () => {
			expect(DEFAULT_SKILL_STRUCTURES.length).toBe(3);
		});

		it('should have obsidian-markdown with 5 reference files', () => {
			const mdSkill = DEFAULT_SKILL_STRUCTURES.find((s) => s.skillName === 'obsidian-markdown');
			expect(mdSkill).toBeDefined();
			expect(Object.keys(mdSkill!.references).length).toBe(5);
			expect(mdSkill!.references['callouts.md']).toBeDefined();
			expect(mdSkill!.references['properties.md']).toBeDefined();
			expect(mdSkill!.references['mermaid.md']).toBeDefined();
			expect(mdSkill!.references['math.md']).toBeDefined();
			expect(mdSkill!.references['embeds.md']).toBeDefined();
		});

		it('should have obsidian-bases with 3 reference files', () => {
			const basesSkill = DEFAULT_SKILL_STRUCTURES.find((s) => s.skillName === 'obsidian-bases');
			expect(basesSkill).toBeDefined();
			expect(Object.keys(basesSkill!.references).length).toBe(3);
			expect(basesSkill!.references['filters.md']).toBeDefined();
			expect(basesSkill!.references['formulas.md']).toBeDefined();
			expect(basesSkill!.references['view-types.md']).toBeDefined();
		});

		it('should have json-canvas with 2 reference files', () => {
			const canvasSkill = DEFAULT_SKILL_STRUCTURES.find((s) => s.skillName === 'json-canvas');
			expect(canvasSkill).toBeDefined();
			expect(Object.keys(canvasSkill!.references).length).toBe(2);
			expect(canvasSkill!.references['nodes.md']).toBeDefined();
			expect(canvasSkill!.references['edges.md']).toBeDefined();
		});

		it('should have SKILL.md content under 500 lines per Anthropic guidelines', () => {
			for (const skill of DEFAULT_SKILL_STRUCTURES) {
				const lines = skill.skillMd.split('\n').length;
				expect(lines).toBeLessThan(500);
			}
		});
	});
});
