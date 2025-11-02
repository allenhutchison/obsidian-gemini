import { GenerateImageTool, getImageTools } from './image-tools';
import { ToolExecutionContext } from './types';

// Mock the image generation service
const mockImageGeneration = {
	generateImage: jest.fn()
};

const mockPlugin = {
	imageGeneration: mockImageGeneration,
	settings: {
		historyFolder: 'test-history-folder'
	}
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

describe('ImageTools', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('GenerateImageTool', () => {
		let tool: GenerateImageTool;

		beforeEach(() => {
			tool = new GenerateImageTool();
		});

		it('should generate image and return wikilink', async () => {
			const imagePath = 'attachments/generated-image-123.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			const result = await tool.execute(
				{ prompt: 'a loaf of bread' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: imagePath,
				prompt: 'a loaf of bread',
				wikilink: `![[${imagePath}]]`
			});
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith(
				'a loaf of bread',
				undefined
			);
		});

		it('should pass target_note parameter when provided', async () => {
			const imagePath = 'attachments/generated-image-456.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			const result = await tool.execute(
				{
					prompt: 'a sunset',
					target_note: 'my-note.md'
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith(
				'a sunset',
				'my-note.md'
			);
		});

		it('should return error when image generation service is not available', async () => {
			const contextNoService = {
				...mockContext,
				plugin: {
					...mockPlugin,
					imageGeneration: null
				}
			};

			const result = await tool.execute(
				{ prompt: 'test' },
				contextNoService
			);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Image generation service not available');
		});

		it('should return error when prompt is empty', async () => {
			const result = await tool.execute(
				{ prompt: '' },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Prompt is required and must be a non-empty string');
		});

		it('should return error when prompt is not a string', async () => {
			const result = await tool.execute(
				{ prompt: 123 as any },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Prompt is required and must be a non-empty string');
		});

		it('should handle image generation errors', async () => {
			mockImageGeneration.generateImage.mockRejectedValue(
				new Error('API error')
			);

			const result = await tool.execute(
				{ prompt: 'test' },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Failed to generate image: API error');
		});

		it('should have requiresConfirmation set to true', () => {
			expect(tool.requiresConfirmation).toBe(true);
		});

		it('should have confirmation message', () => {
			const message = tool.confirmationMessage!({ prompt: 'a beautiful sunset' });
			expect(message).toContain('Generate an image with prompt');
			expect(message).toContain('a beautiful sunset');
		});

		it('should have correct tool metadata', () => {
			expect(tool.name).toBe('generate_image');
			expect(tool.displayName).toBe('Generate Image');
			expect(tool.description).toContain('Generate an image from a text prompt');
			expect(tool.description).toContain('does NOT insert the image into any note');
		});
	});

	describe('getImageTools', () => {
		it('should return all image tools', () => {
			const tools = getImageTools();

			expect(tools).toHaveLength(1);
			expect(tools[0].name).toBe('generate_image');
		});
	});
});
