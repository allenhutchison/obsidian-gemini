import { SkillManager } from '../../src/services/skill-manager';
import { TFile, Vault, Plugin } from 'obsidian';

// Mock dependencies
const mockVault = {
	on: jest.fn(),
	getAbstractFileByPath: jest.fn(),
	read: jest.fn(),
	create: jest.fn(),
	createFolder: jest.fn(),
} as unknown as Vault;

const mockPlugin = {
	app: {
		vault: mockVault,
		workspace: {
			on: jest.fn(),
		},
	},
	settings: {
		skillsFolder: 'Gemini/Skills',
	},
	saveSettings: jest.fn(),
} as unknown as Plugin; // Cast to Plugin but it's mocked

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
	TFile: class {},
	TFolder: class {},
	Vault: class {},
}));

describe('SkillManager', () => {
	let skillManager: SkillManager;

	beforeEach(() => {
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
});
