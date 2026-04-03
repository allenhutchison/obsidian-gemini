import { ActivateSkillTool, CreateSkillTool, EditSkillTool, getSkillTools } from '../../src/tools/skill-tools';
import { ToolExecutionContext } from '../../src/tools/types';
import { ToolCategory } from '../../src/types/agent';

// Mock SkillManager
const mockSkillManager = {
	loadSkill: jest.fn(),
	readSkillResource: jest.fn(),
	listSkillResources: jest.fn(),
	getSkillSummaries: jest.fn(),
	createSkill: jest.fn(),
	updateSkill: jest.fn(),
	validateSkillName: jest.fn(),
};

const mockPlugin = {
	skillManager: mockSkillManager,
} as any;

const mockContext: ToolExecutionContext = {
	plugin: mockPlugin,
	session: {
		id: 'test-session',
		type: 'agent-session',
		context: {
			contextFiles: [],
			contextDepth: 2,
			enabledTools: [],
			requireConfirmation: [],
		},
	},
} as any;

describe('Skill Tools', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('ActivateSkillTool', () => {
		let tool: ActivateSkillTool;

		beforeEach(() => {
			tool = new ActivateSkillTool();
		});

		it('should have correct properties', () => {
			expect(tool.name).toBe('activate_skill');
			expect(tool.displayName).toBe('Activate Skill');
			expect(tool.category).toBe(ToolCategory.SKILLS);
			expect(tool.description).toContain('skill');
		});

		it('should have correct parameter schema', () => {
			expect(tool.parameters.type).toBe('object');
			expect(tool.parameters.properties).toHaveProperty('name');
			expect(tool.parameters.properties).toHaveProperty('resource_path');
			expect(tool.parameters.required).toContain('name');
			expect(tool.parameters.required).not.toContain('resource_path');
		});

		it('should load full skill content when called with name only', async () => {
			mockSkillManager.loadSkill.mockResolvedValue('# Code Review Skill\n\nStep 1: Read the PR...');
			mockSkillManager.listSkillResources.mockResolvedValue(['references/REFERENCE.md']);

			const result = await tool.execute({ name: 'code-review' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.skillName).toBe('code-review');
			expect(result.data.content).toContain('Code Review Skill');
			expect(result.data.availableResources).toEqual(['references/REFERENCE.md']);
			expect(mockSkillManager.loadSkill).toHaveBeenCalledWith('code-review');
		});

		it('should load a specific resource when resource_path is provided', async () => {
			mockSkillManager.readSkillResource.mockResolvedValue('Reference content here');

			const result = await tool.execute({ name: 'code-review', resource_path: 'references/REFERENCE.md' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.skillName).toBe('code-review');
			expect(result.data.resourcePath).toBe('references/REFERENCE.md');
			expect(result.data.content).toBe('Reference content here');
			expect(mockSkillManager.readSkillResource).toHaveBeenCalledWith('code-review', 'references/REFERENCE.md');
		});

		it('should return error when skill is not found', async () => {
			mockSkillManager.loadSkill.mockResolvedValue(null);
			mockSkillManager.getSkillSummaries.mockResolvedValue([{ name: 'code-review', description: 'Reviews code' }]);

			const result = await tool.execute({ name: 'nonexistent' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
			expect(result.data.availableSkills).toContain('code-review');
		});

		it('should return error when resource is not found', async () => {
			mockSkillManager.readSkillResource.mockResolvedValue(null);
			mockSkillManager.listSkillResources.mockResolvedValue(['assets/template.hbs']);

			const result = await tool.execute({ name: 'code-review', resource_path: 'bad/path.md' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
			expect(result.data.availableResources).toEqual(['assets/template.hbs']);
		});

		it('should return error when name is missing', async () => {
			const result = await tool.execute({ name: '' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill name is required');
		});

		it('should return error when skill manager is not available', async () => {
			const contextWithoutSkills = {
				plugin: { skillManager: null } as any,
				session: mockContext.session,
			};

			const result = await tool.execute({ name: 'test' }, contextWithoutSkills);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill manager service not available');
		});

		it('should omit availableResources when skill has none', async () => {
			mockSkillManager.loadSkill.mockResolvedValue('Minimal skill content');
			mockSkillManager.listSkillResources.mockResolvedValue([]);

			const result = await tool.execute({ name: 'minimal-skill' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.availableResources).toBeUndefined();
		});

		it('should generate progress description', () => {
			expect(tool.getProgressDescription({ name: 'code-review' })).toContain('code-review');
			expect(tool.getProgressDescription({ name: 'code-review', resource_path: 'ref.md' })).toContain('ref.md');
		});
	});

	describe('CreateSkillTool', () => {
		let tool: CreateSkillTool;

		beforeEach(() => {
			tool = new CreateSkillTool();
		});

		it('should have correct properties', () => {
			expect(tool.name).toBe('create_skill');
			expect(tool.displayName).toBe('Create Skill');
			expect(tool.category).toBe(ToolCategory.SKILLS);
			expect(tool.requiresConfirmation).toBe(true);
		});

		it('should have correct parameter schema', () => {
			expect(tool.parameters.type).toBe('object');
			expect(tool.parameters.properties).toHaveProperty('name');
			expect(tool.parameters.properties).toHaveProperty('description');
			expect(tool.parameters.properties).toHaveProperty('content');
			expect(tool.parameters.required).toEqual(['name', 'description', 'content']);
		});

		it('should create skill successfully', async () => {
			mockSkillManager.createSkill.mockResolvedValue('gemini-scribe/Skills/my-skill/SKILL.md');

			const result = await tool.execute(
				{
					name: 'my-skill',
					description: 'A test skill',
					content: '# My Skill\n\nInstructions here...',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.name).toBe('my-skill');
			expect(result.data.path).toContain('SKILL.md');
			expect(mockSkillManager.createSkill).toHaveBeenCalledWith(
				'my-skill',
				'A test skill',
				'# My Skill\n\nInstructions here...'
			);
		});

		it('should return error for empty name', async () => {
			const result = await tool.execute({ name: '', description: 'desc', content: 'content' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill name is required');
			expect(mockSkillManager.createSkill).not.toHaveBeenCalled();
		});

		it('should return error for empty description', async () => {
			const result = await tool.execute({ name: 'my-skill', description: '', content: 'content' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill description is required');
		});

		it('should return error for empty content', async () => {
			const result = await tool.execute({ name: 'my-skill', description: 'desc', content: '' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill content is required');
		});

		it('should return error when skill manager is not available', async () => {
			const contextWithoutSkills = {
				plugin: { skillManager: null } as any,
				session: mockContext.session,
			};

			const result = await tool.execute(
				{ name: 'test', description: 'desc', content: 'content' },
				contextWithoutSkills
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill manager service not available');
		});

		it('should handle creation errors', async () => {
			mockSkillManager.createSkill.mockRejectedValue(new Error('Skill "duplicate" already exists'));

			const result = await tool.execute({ name: 'duplicate', description: 'desc', content: 'content' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('already exists');
		});

		it('should have confirmation message function', () => {
			const message = tool.confirmationMessage!({ name: 'code-review', description: 'Reviews code quality' });
			expect(message).toContain('code-review');
			expect(message).toContain('Reviews code quality');
		});

		it('should truncate long descriptions in confirmation', () => {
			const longDesc = 'a'.repeat(300);
			const message = tool.confirmationMessage!({ name: 'test', description: longDesc });
			expect(message).toContain('...');
		});

		it('should trim input values', async () => {
			mockSkillManager.createSkill.mockResolvedValue('path/SKILL.md');

			await tool.execute({ name: '  my-skill  ', description: '  desc  ', content: '  content  ' }, mockContext);

			expect(mockSkillManager.createSkill).toHaveBeenCalledWith('my-skill', 'desc', 'content');
		});
	});

	describe('EditSkillTool', () => {
		let tool: EditSkillTool;

		beforeEach(() => {
			tool = new EditSkillTool();
		});

		it('should have correct properties', () => {
			expect(tool.name).toBe('edit_skill');
			expect(tool.displayName).toBe('Edit Skill');
			expect(tool.category).toBe(ToolCategory.SKILLS);
			expect(tool.requiresConfirmation).toBe(true);
		});

		it('should have correct parameter schema', () => {
			expect(tool.parameters.type).toBe('object');
			expect(tool.parameters.properties).toHaveProperty('name');
			expect(tool.parameters.properties).toHaveProperty('description');
			expect(tool.parameters.properties).toHaveProperty('content');
			expect(tool.parameters.required).toEqual(['name']);
		});

		it('should update skill content successfully', async () => {
			mockSkillManager.updateSkill.mockResolvedValue('gemini-scribe/Skills/my-skill/SKILL.md');

			const result = await tool.execute(
				{
					name: 'my-skill',
					content: '# Updated Instructions\n\nNew content here...',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.name).toBe('my-skill');
			expect(result.data.path).toContain('SKILL.md');
			expect(result.data.updatedFields).toEqual(['content']);
			expect(mockSkillManager.updateSkill).toHaveBeenCalledWith(
				'my-skill',
				undefined,
				'# Updated Instructions\n\nNew content here...'
			);
		});

		it('should update skill description successfully', async () => {
			mockSkillManager.updateSkill.mockResolvedValue('gemini-scribe/Skills/my-skill/SKILL.md');

			const result = await tool.execute(
				{
					name: 'my-skill',
					description: 'Updated description',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.updatedFields).toEqual(['description']);
			expect(mockSkillManager.updateSkill).toHaveBeenCalledWith('my-skill', 'Updated description', undefined);
		});

		it('should update both description and content', async () => {
			mockSkillManager.updateSkill.mockResolvedValue('gemini-scribe/Skills/my-skill/SKILL.md');

			const result = await tool.execute(
				{
					name: 'my-skill',
					description: 'New desc',
					content: 'New content',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.updatedFields).toEqual(['description', 'content']);
			expect(mockSkillManager.updateSkill).toHaveBeenCalledWith('my-skill', 'New desc', 'New content');
		});

		it('should return error for empty name', async () => {
			const result = await tool.execute({ name: '', content: 'content' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill name is required');
			expect(mockSkillManager.updateSkill).not.toHaveBeenCalled();
		});

		it('should return error when neither description nor content provided', async () => {
			const result = await tool.execute({ name: 'my-skill' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('At least one of description or content must be provided');
			expect(mockSkillManager.updateSkill).not.toHaveBeenCalled();
		});

		it('should return error when skill manager is not available', async () => {
			const contextWithoutSkills = {
				plugin: { skillManager: null } as any,
				session: mockContext.session,
			};

			const result = await tool.execute({ name: 'test', content: 'content' }, contextWithoutSkills);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Skill manager service not available');
		});

		it('should handle update errors', async () => {
			mockSkillManager.updateSkill.mockRejectedValue(new Error('Skill "nonexistent" not found'));

			const result = await tool.execute({ name: 'nonexistent', content: 'content' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('not found');
		});

		it('should have confirmation message function', () => {
			const message = tool.confirmationMessage!({ name: 'code-review', content: 'new content' });
			expect(message).toContain('code-review');
			expect(message).toContain('content');
		});

		it('should show both fields in confirmation when updating both', () => {
			const message = tool.confirmationMessage!({
				name: 'code-review',
				description: 'new desc',
				content: 'new content',
			});
			expect(message).toContain('description and content');
		});

		it('should trim input values', async () => {
			mockSkillManager.updateSkill.mockResolvedValue('path/SKILL.md');

			await tool.execute({ name: '  my-skill  ', description: '  desc  ', content: '  content  ' }, mockContext);

			expect(mockSkillManager.updateSkill).toHaveBeenCalledWith('my-skill', 'desc', 'content');
		});

		it('should generate progress description', () => {
			expect(tool.getProgressDescription({ name: 'code-review' })).toContain('code-review');
		});

		it('should treat whitespace-only description as empty in confirmation', () => {
			const message = tool.confirmationMessage!({ name: 'test', description: '   ', content: 'real content' });
			expect(message).not.toContain('description');
			expect(message).toContain('content');
		});

		it('should treat whitespace-only content as empty in confirmation', () => {
			const message = tool.confirmationMessage!({ name: 'test', description: 'real desc', content: '   ' });
			expect(message).toContain('description');
			expect(message).not.toContain('content');
		});

		it('should show no valid fields message in confirmation when both are whitespace', () => {
			const message = tool.confirmationMessage!({ name: 'test', description: '   ', content: '   ' });
			expect(message).toContain('no valid fields provided');
		});

		it('should reject whitespace-only description and content in execute', async () => {
			const result = await tool.execute({ name: 'my-skill', description: '   ', content: '   ' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('At least one of description or content must be provided');
			expect(mockSkillManager.updateSkill).not.toHaveBeenCalled();
		});
	});

	describe('getSkillTools', () => {
		it('should return all skill tools', () => {
			const tools = getSkillTools();

			expect(tools).toHaveLength(3);
			expect(tools[0]).toBeInstanceOf(ActivateSkillTool);
			expect(tools[1]).toBeInstanceOf(CreateSkillTool);
			expect(tools[2]).toBeInstanceOf(EditSkillTool);
		});

		it('should return tools with correct names', () => {
			const tools = getSkillTools();

			const toolNames = tools.map((t) => t.name);
			expect(toolNames).toContain('activate_skill');
			expect(toolNames).toContain('create_skill');
			expect(toolNames).toContain('edit_skill');
		});
	});
});
