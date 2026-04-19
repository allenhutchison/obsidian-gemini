import { GenerateImageTool, getImageTools } from '../../src/tools/image-tools';
import { ToolExecutionContext } from '../../src/tools/types';

// Mock the image generation service
const mockImageGeneration = {
	generateImage: jest.fn(),
	resolveDefaultOutputPath: jest.fn(),
};

const mockBackgroundTaskManager = {
	submit: jest.fn().mockReturnValue('bg-task-1'),
};

const mockPlugin = {
	imageGeneration: mockImageGeneration,
	backgroundTaskManager: mockBackgroundTaskManager,
	settings: {
		historyFolder: 'test-history-folder',
	},
	app: {
		workspace: {
			getActiveFile: jest.fn().mockReturnValue({ path: 'active-note.md' }),
		},
	},
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

			const result = await tool.execute({ prompt: 'a loaf of bread' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: imagePath,
				prompt: 'a loaf of bread',
				wikilink: `![[${imagePath}]]`,
			});
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith('a loaf of bread', undefined, undefined);
		});

		it('should pass target_note parameter when provided', async () => {
			const imagePath = 'attachments/generated-image-456.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			const result = await tool.execute(
				{
					prompt: 'a sunset',
					target_note: 'my-note.md',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith('a sunset', 'my-note.md', undefined);
		});

		it('should pass output_path parameter when provided', async () => {
			const imagePath = 'attachments/my-custom-image.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			const result = await tool.execute(
				{
					prompt: 'a mountain',
					output_path: 'attachments/my-custom-image.png',
				},
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: imagePath,
				prompt: 'a mountain',
				wikilink: `![[${imagePath}]]`,
			});
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith(
				'a mountain',
				undefined,
				'attachments/my-custom-image.png'
			);
		});

		it('should prefer output_path over target_note when both are provided', async () => {
			const imagePath = 'custom/path/image.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			await tool.execute(
				{
					prompt: 'test',
					target_note: 'some-note.md',
					output_path: 'custom/path/image.png',
				},
				mockContext
			);

			// output_path and target_note are both forwarded; resolution priority is in the service
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith('test', 'some-note.md', 'custom/path/image.png');
		});

		it('should return error when image generation service is not available', async () => {
			const contextNoService = {
				...mockContext,
				plugin: {
					...mockPlugin,
					imageGeneration: null,
				},
			};

			const result = await tool.execute({ prompt: 'test' }, contextNoService);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Image generation service not available');
		});

		it('should return error when prompt is empty', async () => {
			const result = await tool.execute({ prompt: '' }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Prompt is required and must be a non-empty string');
		});

		it('should return error when prompt is not a string', async () => {
			const result = await tool.execute({ prompt: 123 as any }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toBe('Prompt is required and must be a non-empty string');
		});

		it('should handle image generation errors', async () => {
			mockImageGeneration.generateImage.mockRejectedValue(new Error('API error'));

			const result = await tool.execute({ prompt: 'test' }, mockContext);

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

	describe('background mode', () => {
		let tool: GenerateImageTool;

		beforeEach(() => {
			tool = new GenerateImageTool();
			jest.clearAllMocks();
		});

		it('returns taskId and output_path immediately without calling generateImage', async () => {
			const result = await tool.execute(
				{ prompt: 'a cat', background: true, output_path: 'attachments/cat.png' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.taskId).toBe('bg-task-1');
			expect(result.data.output_path).toBe('attachments/cat.png');
			expect(mockImageGeneration.generateImage).not.toHaveBeenCalled();
		});

		it('submits to BackgroundTaskManager with correct type and label', async () => {
			await tool.execute({ prompt: 'a mountain at sunrise', background: true }, mockContext);

			expect(mockBackgroundTaskManager.submit).toHaveBeenCalledWith(
				'image-generation',
				'a mountain at sunrise',
				expect.any(Function)
			);
		});

		it('truncates long prompt in BackgroundTaskManager label', async () => {
			const longPrompt = 'P'.repeat(50);
			await tool.execute({ prompt: longPrompt, background: true }, mockContext);

			const label = mockBackgroundTaskManager.submit.mock.calls[0][1] as string;
			expect(label.length).toBeLessThanOrEqual(40);
			expect(label.endsWith('…')).toBe(true);
		});

		it('pre-resolves output_path via attachment folder when none provided', async () => {
			mockImageGeneration.resolveDefaultOutputPath.mockResolvedValue('attachments/generated-a-dog-12345.png');

			const result = await tool.execute({ prompt: 'a dog', background: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.output_path).toBe('attachments/generated-a-dog-12345.png');
			// Resolution uses the prompt and the active file as the attachment-folder reference
			expect(mockImageGeneration.resolveDefaultOutputPath).toHaveBeenCalledWith('a dog', 'active-note.md');
		});

		it('uses explicit output_path without consulting resolveDefaultOutputPath', async () => {
			const result = await tool.execute(
				{ prompt: 'a dog', background: true, output_path: 'pictures/dog.png' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.output_path).toBe('pictures/dog.png');
			expect(mockImageGeneration.resolveDefaultOutputPath).not.toHaveBeenCalled();
		});

		it('returns a tool error when path resolution fails (no active file, no target_note)', async () => {
			mockImageGeneration.resolveDefaultOutputPath.mockRejectedValue(
				new Error('No active file and no target note path provided')
			);

			const result = await tool.execute({ prompt: 'a cat', background: true }, mockContext);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to resolve image output path');
			expect(result.error).toContain('No active file');
			expect(mockBackgroundTaskManager.submit).not.toHaveBeenCalled();
		});

		it('returns error when BackgroundTaskManager is unavailable', async () => {
			const contextNoManager = {
				...mockContext,
				plugin: { ...mockPlugin, backgroundTaskManager: null },
			} as any;

			const result = await tool.execute({ prompt: 'test', background: true }, contextNoManager);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Background task manager not available');
		});

		it('callback invokes generateImage with the pre-resolved output_path', async () => {
			mockImageGeneration.resolveDefaultOutputPath.mockResolvedValue('attachments/result.png');
			mockImageGeneration.generateImage.mockResolvedValue('attachments/result.png');

			await tool.execute({ prompt: 'a sunset', background: true }, mockContext);

			const callback = mockBackgroundTaskManager.submit.mock.calls[0][2];
			const returnedPath = await callback(() => false);

			// The resolved path is passed through as the explicit outputPath so the
			// task writes exactly where we told the agent it would land.
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith(
				'a sunset',
				'active-note.md',
				'attachments/result.png'
			);
			expect(returnedPath).toBe('attachments/result.png');
		});

		it('callback uses explicit target_note over captured active file', async () => {
			mockImageGeneration.resolveDefaultOutputPath.mockResolvedValue('my-folder/result.png');
			mockImageGeneration.generateImage.mockResolvedValue('my-folder/result.png');

			await tool.execute({ prompt: 'a fox', background: true, target_note: 'my-note.md' }, mockContext);

			const callback = mockBackgroundTaskManager.submit.mock.calls[0][2];
			await callback(() => false);

			expect(mockImageGeneration.resolveDefaultOutputPath).toHaveBeenCalledWith('a fox', 'my-note.md');
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith('a fox', 'my-note.md', 'my-folder/result.png');
		});

		it('callback returns undefined when cancelled', async () => {
			await tool.execute({ prompt: 'test', background: true }, mockContext);

			const callback = mockBackgroundTaskManager.submit.mock.calls[0][2];
			const result = await callback(() => true);

			expect(result).toBeUndefined();
			expect(mockImageGeneration.generateImage).not.toHaveBeenCalled();
		});

		it('background: false behaves as foreground', async () => {
			const imagePath = 'attachments/test.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			const result = await tool.execute({ prompt: 'test', background: false }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty('wikilink');
			expect(mockBackgroundTaskManager.submit).not.toHaveBeenCalled();
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
