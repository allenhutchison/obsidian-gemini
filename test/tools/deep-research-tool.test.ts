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
	}
}));

// Mock DeepResearchService
const mockDeepResearch = {
	conductResearch: jest.fn()
};

const mockPlugin = {
	deepResearch: mockDeepResearch
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
			expect(tool.description).toContain('multi-phase');
		});

		it('should have confirmation message function', () => {
			const message = tool.confirmationMessage!({ topic: 'AI Ethics' });
			expect(message).toContain('Conduct deep research on: "AI Ethics"');
			expect(message).toContain('3 search iterations');
		});

		it('should include custom depth in confirmation message', () => {
			const message = tool.confirmationMessage!({ topic: 'Test', depth: 5 });
			expect(message).toContain('5 search iterations');
		});

		it('should have correct parameter schema', () => {
			expect(tool.parameters.type).toBe('object');
			expect(tool.parameters.properties).toHaveProperty('topic');
			expect(tool.parameters.properties).toHaveProperty('depth');
			expect(tool.parameters.properties).toHaveProperty('outputFile');
			expect(tool.parameters.required).toContain('topic');
		});

		it('should define topic as required string parameter', () => {
			expect(tool.parameters.properties.topic.type).toBe('string');
			expect(tool.parameters.properties.topic.description).toBeTruthy();
		});

		it('should define depth as optional number parameter', () => {
			expect(tool.parameters.properties.depth.type).toBe('number');
			expect(tool.parameters.required).not.toContain('depth');
		});

		it('should define outputFile as optional string parameter', () => {
			expect(tool.parameters.properties.outputFile.type).toBe('string');
			expect(tool.parameters.required).not.toContain('outputFile');
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
				session: mockContext.session
			};

			const result = await tool.execute({ topic: 'Test' }, contextWithoutService);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Deep research service not available');
		});

		it('should conduct research successfully', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'AI Ethics',
				report: '# AI Ethics\n\nResearch report...',
				searchCount: 5,
				sourceCount: 10,
				sectionCount: 3
			});

			const result = await tool.execute({ topic: 'AI Ethics' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				topic: 'AI Ethics',
				report: expect.any(String),
				searches: 5,
				sources: 10,
				sections: 3,
				outputFile: undefined
			});
			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'AI Ethics',
				depth: undefined,
				outputFile: undefined
			});
		});

		it('should pass depth parameter to service', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				searchCount: 3,
				sourceCount: 5,
				sectionCount: 2
			});

			await tool.execute({ topic: 'Test', depth: 5 }, mockContext);

			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'Test',
				depth: 5,
				outputFile: undefined
			});
		});

		it('should pass outputFile parameter to service', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				searchCount: 3,
				sourceCount: 5,
				sectionCount: 2
			});

			await tool.execute({ topic: 'Test', outputFile: 'research.md' }, mockContext);

			expect(mockDeepResearch.conductResearch).toHaveBeenCalledWith({
				topic: 'Test',
				depth: undefined,
				outputFile: 'research.md'
			});
		});

		it('should add output file to session context if created', async () => {
			const mockFile = new TFile();
			mockFile.path = 'research-report.md';

			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				searchCount: 3,
				sourceCount: 5,
				sectionCount: 2,
				outputFile: mockFile
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
				searchCount: 3,
				sourceCount: 5,
				sectionCount: 2,
				outputFile: mockFile
			});

			const contextWithoutSession = {
				plugin: mockPlugin,
				session: null
			} as any;

			const result = await tool.execute({ topic: 'Test', outputFile: 'research-report' }, contextWithoutSession);

			expect(result.success).toBe(true);
			// Should not throw error
		});

		it('should not add to context if no output file', async () => {
			mockDeepResearch.conductResearch.mockResolvedValue({
				topic: 'Test',
				report: 'Report',
				searchCount: 3,
				sourceCount: 5,
				sectionCount: 2
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
