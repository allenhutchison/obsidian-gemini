import { DeepResearchTool, getDeepResearchTool } from '../../src/tools/deep-research-tool';
import { ToolExecutionContext } from '../../src/tools/types';
import { ToolCategory } from '../../src/types/agent';
import { TFile } from 'obsidian';

// Mock TFile
jest.mock('obsidian', () => ({
	...jest.requireActual('../../__mocks__/obsidian.js'),
	TFile: class TFile {
		path: string = '';
		name: string = '';
	},
}));

// Mock DeepResearchService
const mockDeepResearch = {
	conductResearch: jest.fn(),
};

const mockPlugin = {
	deepResearch: mockDeepResearch,
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

describe('DeepResearchTool', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('Tool Properties', () => {
		let tool: DeepResearchTool;

		beforeEach(() => {
			tool = new DeepResearchTool();
		});

		it('should have correct properties', () => {
			expect(tool.name).toBe('deep_research');
			expect(tool.displayName).toBe('Deep Research');
			expect(tool.category).toBe(ToolCategory.READ_ONLY);
			expect(tool.requiresConfirmation).toBe(true);
			expect(tool.description).toContain('comprehensive');
			expect(tool.description).toContain('Deep Research model');
		});

		it('should have confirmation message function', () => {
			const message = tool.confirmationMessage!({ topic: 'AI Ethics' });
			expect(message).toContain('Conduct deep research on: "AI Ethics"');
			expect(message).toContain('using vault and web');
		});

		it('should include scope in confirmation message', () => {
			const messageVault = tool.confirmationMessage!({ topic: 'Test', scope: 'vault_only' });
			expect(messageVault).toContain('using vault notes only');

			const messageWeb = tool.confirmationMessage!({ topic: 'Test', scope: 'web_only' });
			expect(messageWeb).toContain('using web search only');

			const messageBoth = tool.confirmationMessage!({ topic: 'Test', scope: 'both' });
			expect(messageBoth).toContain('using vault and web');
		});

		it('should have correct parameter schema', () => {
			expect(tool.parameters.type).toBe('object');
			expect(tool.parameters.properties).toHaveProperty('topic');
			expect(tool.parameters.properties).toHaveProperty('scope');
			expect(tool.parameters.properties).toHaveProperty('outputFile');
			expect(tool.parameters.required).toContain('topic');
			expect(tool.parameters.required).not.toContain('scope');
		});

		it('should define topic as required string parameter', () => {
			expect(tool.parameters.properties.topic.type).toBe('string');
			expect(tool.parameters.properties.topic.description).toBeTruthy();
		});

		it('should define scope as optional enum parameter', () => {
			expect(tool.parameters.properties.scope.type).toBe('string');
			expect(tool.parameters.properties.scope.enum).toEqual(['vault_only', 'web_only', 'both']);
			expect(tool.parameters.required).not.toContain('scope');
		});

		it('should define outputFile as optional string parameter', () => {
			expect(tool.parameters.properties.outputFile.type).toBe('string');
			expect(tool.parameters.required).not.toContain('outputFile');
		});
	});

	describe('getProgressDescription', () => {
		let tool: DeepResearchTool;

		beforeEach(() => {
			tool = new DeepResearchTool();
		});

		it('should return topic in progress description', () => {
			const desc = tool.getProgressDescription!({ topic: 'AI Ethics' });
			expect(desc).toBe('Researching "AI Ethics"');
		});

		it('should truncate long topics', () => {
			const desc = tool.getProgressDescription!({ topic: 'This is a very long research topic' });
			expect(desc).toBe('Researching "This is a very long re..."');
		});

		it('should include scope in progress description', () => {
			const descVault = tool.getProgressDescription!({ topic: 'Test', scope: 'vault_only' });
			expect(descVault).toBe('Researching "Test" (vault)');

			const descWeb = tool.getProgressDescription!({ topic: 'Test', scope: 'web_only' });
			expect(descWeb).toBe('Researching "Test" (web)');

			const descBoth = tool.getProgressDescription!({ topic: 'Test', scope: 'both' });
			expect(descBoth).toBe('Researching "Test"');
		});

		it('should return default message when no topic', () => {
			const desc = tool.getProgressDescription!({ topic: '' });
			expect(desc).toBe('Conducting research');
		});
	});

	describe('execute', () => {
		let tool: DeepResearchTool;

		beforeEach(() => {
			tool = new DeepResearchTool();
		});

		it('should return error for empty topic', async () => {
			const result = await tool.execute({ topic: '' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Topic is required');
			expect(mockDeepResearch.conductResearch).not.toHaveBeenCalled();
		});

		it('should return error for whitespace-only topic', async () => {
			const result = await tool.execute({ topic: '   \n   ' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Topic is required');
		});

		it('should return error for non-string topic', async () => {
			const result = await tool.execute({ topic: 123 as any }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Topic is required');
		});

		it('should return error for null topic', async () => {
			const result = await tool.execute({ topic: null as any }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Topic is required');
		});

		it('should return error if deep research service is not available', async () => {
			const contextWithoutService = {
				plugin: { deepResearch: null } as any,
				session: mockContext.session,
			};

			const result = await tool.execute({ topic: 'Test' }, contextWithoutService);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Deep research service not available');
		});

		it('should conduct research successfully', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'AI Ethics',
				report: '# AI Ethics\n\nResearch report...',
				sourceCount: 10,
			});

			const result = await tool.execute({ topic: 'AI Ethics' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				topic: 'AI Ethics',
				report: expect.any(String),
				sources: 10,
				outputFile: undefined,
			});
			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'AI Ethics',
				scope: undefined,
				outputFile: undefined,
			});
		});

		it('should pass scope parameter to service', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				sourceCount: 5,
			});

			await tool.execute({ topic: 'Test', scope: 'vault_only' }, mockContext);

			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'Test',
				scope: 'vault_only',
				outputFile: undefined,
			});
		});

		it('should pass outputFile parameter to service with .md extension', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				sourceCount: 5,
			});

			await tool.execute({ topic: 'Test', outputFile: 'research.md' }, mockContext);

			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'Test',
				scope: undefined,
				outputFile: 'research.md',
			});
		});

		it('should add .md extension if not present in outputFile', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				sourceCount: 5,
			});

			await tool.execute({ topic: 'Test', outputFile: 'research' }, mockContext);

			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'Test',
				scope: undefined,
				outputFile: 'research.md',
			});
		});

		it('should add output file to session context if created', async () => {
			const mockFile = new TFile();
			mockFile.path = 'research-report.md';

			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				sourceCount: 5,
				outputFile: mockFile,
			});

			const result = await tool.execute({ topic: 'Test', outputFile: 'research-report' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.outputFile).toBe('research-report.md');
			expect(mockContext.session!.context.contextFiles).toContain(mockFile);
		});

		it('should not add to context if no session', async () => {
			const mockFile = new TFile();
			mockFile.path = 'research-report.md';

			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				sourceCount: 5,
				outputFile: mockFile,
			});

			const contextWithoutSession = {
				plugin: mockPlugin,
				session: null,
			} as any;

			const result = await tool.execute({ topic: 'Test', outputFile: 'research-report' }, contextWithoutSession);

			expect(result.success).toBe(true);
			// Should not throw error
		});

		it('should not add to context if no output file', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				sourceCount: 5,
			});

			const initialFiles = mockContext.session!.context.contextFiles.length;

			await tool.execute({ topic: 'Test' }, mockContext);

			expect(mockContext.session!.context.contextFiles.length).toBe(initialFiles);
		});

		it('should handle service errors gracefully', async () => {
			mockDeepResearch.conductResearch.mockRejectedValue(new Error('API rate limit exceeded'));

			const result = await tool.execute({ topic: 'Test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Deep research failed: API rate limit exceeded');
		});

		it('should handle unknown errors', async () => {
			mockDeepResearch.conductResearch.mockRejectedValue('Unknown error');

			const result = await tool.execute({ topic: 'Test' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Deep research failed: Unknown error');
		});

		it('should handle vault_only scope error gracefully', async () => {
			mockDeepResearch.conductResearch.mockRejectedValue(
				new Error('Vault-only research requires RAG indexing to be enabled and configured')
			);

			const result = await tool.execute({ topic: 'Test', scope: 'vault_only' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Vault-only research requires RAG indexing');
		});
	});

	describe('getDeepResearchTool', () => {
		it('should return DeepResearchTool instance', () => {
			const tool = getDeepResearchTool();

			expect(tool).toBeInstanceOf(DeepResearchTool);
			expect(tool.name).toBe('deep_research');
		});

		it('should return a new instance each time', () => {
			const tool1 = getDeepResearchTool();
			const tool2 = getDeepResearchTool();

			expect(tool1).not.toBe(tool2);
			expect(tool1.name).toBe(tool2.name);
		});
	});
});
