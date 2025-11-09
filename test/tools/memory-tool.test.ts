import { UpdateMemoryTool, ReadMemoryTool, getMemoryTools } from '../../src/tools/memory-tool';
import { ToolExecutionContext } from '../../src/tools/types';
import { ToolCategory } from '../../src/types/agent';

// Mock AgentsMemory
const mockAgentsMemory = {
	read: jest.fn(),
	append: jest.fn(),
	getMemoryFilePath: jest.fn()
};

const mockPlugin = {
	agentsMemory: mockAgentsMemory
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
			requireConfirmation: []
		}
	}
} as any;

describe('Memory Tools', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('UpdateMemoryTool', () => {
		let tool: UpdateMemoryTool;

		beforeEach(() => {
			tool = new UpdateMemoryTool();
		});

		it('should have correct properties', () => {
			expect(tool.name).toBe('update_memory');
			expect(tool.displayName).toBe('Update Memory');
			expect(tool.category).toBe(ToolCategory.VAULT_OPERATIONS);
			expect(tool.requiresConfirmation).toBe(true);
			expect(tool.description).toContain('AGENTS.md');
		});

		it('should have confirmation message function', () => {
			const message = tool.confirmationMessage!({ content: 'Test content for memory' });
			expect(message).toContain('Add the following to AGENTS.md memory');
			expect(message).toContain('Test content for memory');
		});

		it('should truncate long content in confirmation message', () => {
			const longContent = 'a'.repeat(300);
			const message = tool.confirmationMessage!({ content: longContent });
			expect(message).toContain('...');
			expect(message.length).toBeLessThan(300);
		});

		it('should update memory successfully', async () => {
			mockAgentsMemory.append.mockResolvedValue(undefined);
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			const result = await tool.execute({ content: 'New memory content' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: 'test-folder/AGENTS.md',
				message: 'Memory updated successfully'
			});
			expect(mockAgentsMemory.append).toHaveBeenCalledWith('New memory content');
		});

		it('should trim content before updating', async () => {
			mockAgentsMemory.append.mockResolvedValue(undefined);
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			await tool.execute({ content: '  \n  Memory with whitespace  \n  ' }, mockContext);

			expect(mockAgentsMemory.append).toHaveBeenCalledWith('Memory with whitespace');
		});

		it('should return error for empty content', async () => {
			const result = await tool.execute({ content: '' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Content is required');
			expect(mockAgentsMemory.append).not.toHaveBeenCalled();
		});

		it('should return error for whitespace-only content', async () => {
			const result = await tool.execute({ content: '   \n   ' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Content is required');
			expect(mockAgentsMemory.append).not.toHaveBeenCalled();
		});

		it('should return error for non-string content', async () => {
			const result = await tool.execute({ content: 123 as any }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Content is required');
		});

		it('should return error for null content', async () => {
			const result = await tool.execute({ content: null as any }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Content is required');
		});

		it('should return error if agents memory service is not available', async () => {
			const contextWithoutMemory = {
				plugin: { agentsMemory: null } as any,
				session: mockContext.session
			};

			const result = await tool.execute({ content: 'Test' }, contextWithoutMemory);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Agents memory service not available');
		});

		it('should handle append errors gracefully', async () => {
			mockAgentsMemory.append.mockRejectedValue(new Error('Append failed'));

			const result = await tool.execute({ content: 'Test content' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to update memory: Append failed');
		});

		it('should handle unknown errors', async () => {
			mockAgentsMemory.append.mockRejectedValue('Unknown error');

			const result = await tool.execute({ content: 'Test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to update memory');
		});
	});

	describe('ReadMemoryTool', () => {
		let tool: ReadMemoryTool;

		beforeEach(() => {
			tool = new ReadMemoryTool();
		});

		it('should have correct properties', () => {
			expect(tool.name).toBe('read_memory');
			expect(tool.displayName).toBe('Read Memory');
			expect(tool.category).toBe(ToolCategory.READ_ONLY);
			expect(tool.description).toContain('AGENTS.md');
			expect(tool.description).toContain('vault structure');
		});

		it('should not require confirmation', () => {
			expect((tool as any).requiresConfirmation).toBeUndefined();
		});

		it('should read memory successfully', async () => {
			mockAgentsMemory.read.mockResolvedValue('# AGENTS.md\n\nVault memory content');
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			const result = await tool.execute({}, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: 'test-folder/AGENTS.md',
				content: '# AGENTS.md\n\nVault memory content',
				exists: true
			});
			expect(mockAgentsMemory.read).toHaveBeenCalled();
		});

		it('should handle non-existent file', async () => {
			mockAgentsMemory.read.mockResolvedValue(null);
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			const result = await tool.execute({}, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				content: '',
				exists: false,
				message: 'AGENTS.md does not exist yet. Use update_memory to create it.'
			});
		});

		it('should handle empty file content', async () => {
			mockAgentsMemory.read.mockResolvedValue('');
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			const result = await tool.execute({}, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.exists).toBe(false);
			expect(result.data.message).toContain('does not exist yet');
		});

		it('should return error if agents memory service is not available', async () => {
			const contextWithoutMemory = {
				plugin: { agentsMemory: null } as any,
				session: mockContext.session
			};

			const result = await tool.execute({}, contextWithoutMemory);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Agents memory service not available');
		});

		it('should handle read errors gracefully', async () => {
			mockAgentsMemory.read.mockRejectedValue(new Error('Read failed'));

			const result = await tool.execute({}, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to read memory: Read failed');
		});

		it('should handle unknown errors', async () => {
			mockAgentsMemory.read.mockRejectedValue('Unknown error');

			const result = await tool.execute({}, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to read memory');
		});

		it('should accept empty parameters', async () => {
			mockAgentsMemory.read.mockResolvedValue('Content');
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			// Should work with no parameters
			const result = await tool.execute({}, mockContext);

			expect(result.success).toBe(true);
		});

		it('should ignore extra parameters', async () => {
			mockAgentsMemory.read.mockResolvedValue('Content');
			mockAgentsMemory.getMemoryFilePath.mockReturnValue('test-folder/AGENTS.md');

			// Should ignore extra params
			const result = await tool.execute({ extraParam: 'ignored' } as any, mockContext);

			expect(result.success).toBe(true);
		});
	});

	describe('getMemoryTools', () => {
		it('should return both memory tools', () => {
			const tools = getMemoryTools();

			expect(tools).toHaveLength(2);
			expect(tools[0]).toBeInstanceOf(UpdateMemoryTool);
			expect(tools[1]).toBeInstanceOf(ReadMemoryTool);
		});

		it('should return tools with correct names', () => {
			const tools = getMemoryTools();

			const toolNames = tools.map(t => t.name);
			expect(toolNames).toContain('update_memory');
			expect(toolNames).toContain('read_memory');
		});

		it('should return tools in consistent order', () => {
			const tools1 = getMemoryTools();
			const tools2 = getMemoryTools();

			expect(tools1[0].name).toBe(tools2[0].name);
			expect(tools1[1].name).toBe(tools2[1].name);
		});
	});

	describe('Tool Parameters Schema', () => {
		describe('UpdateMemoryTool parameters', () => {
			let tool: UpdateMemoryTool;

			beforeEach(() => {
				tool = new UpdateMemoryTool();
			});

			it('should have correct parameter schema', () => {
				expect(tool.parameters.type).toBe('object');
				expect(tool.parameters.properties).toHaveProperty('content');
				expect(tool.parameters.required).toContain('content');
			});

			it('should define content as string parameter', () => {
				expect(tool.parameters.properties.content.type).toBe('string');
				expect(tool.parameters.properties.content.description).toBeTruthy();
			});
		});

		describe('ReadMemoryTool parameters', () => {
			let tool: ReadMemoryTool;

			beforeEach(() => {
				tool = new ReadMemoryTool();
			});

			it('should have correct parameter schema', () => {
				expect(tool.parameters.type).toBe('object');
				expect(tool.parameters.properties).toEqual({});
				expect(tool.parameters.required).toEqual([]);
			});
		});
	});
});
