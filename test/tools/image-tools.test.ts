import { GenerateImageTool, getImageTools } from '../../src/tools/image-tools';
import { ToolExecutionContext } from '../../src/tools/types';

// Mock the image generation service
const mockImageGeneration = {
	generateImage: vi.fn(),
	resolveOutputPath: vi.fn(),
};

const mockBackgroundTaskManager = {
	submit: vi.fn().mockReturnValue('bg-task-1'),
};

const mockPlugin = {
	imageGeneration: mockImageGeneration,
	backgroundTaskManager: mockBackgroundTaskManager,
	settings: {
		historyFolder: 'test-history-folder',
	},
	app: {
		workspace: {
			getActiveFile: vi.fn().mockReturnValue({ path: 'active-note.md' }),
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
		vi.clearAllMocks();
	});

	describe('GenerateImageTool', () => {
		let tool: GenerateImageTool;

		beforeEach(() => {
			tool = new GenerateImageTool();
		});

		it('should generate image and return wikilink', async () => {
			const imagePath = 'gemini-scribe/Background-Tasks/generated-image-123.png';
			mockImageGeneration.generateImage.mockResolvedValue(imagePath);

			const result = await tool.execute({ prompt: 'a loaf of bread' }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual({
				path: imagePath,
				prompt: 'a loaf of bread',
				wikilink: `![[${imagePath}]]`,
			});
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith('a loaf of bread', undefined);
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
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith('a mountain', 'attachments/my-custom-image.png');
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
			vi.clearAllMocks();
			// Default: the resolver echoes back the explicit output_path (or a generic
			// Background-Tasks default if not provided). Individual tests override as needed.
			mockImageGeneration.resolveOutputPath.mockImplementation(
				async (_prompt: string, explicit?: string) => explicit ?? 'gemini-scribe/Background-Tasks/default.png'
			);
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

		it('pre-resolves output_path via the Background-Tasks default when none provided', async () => {
			mockImageGeneration.resolveOutputPath.mockResolvedValue(
				'gemini-scribe/Background-Tasks/generated-a-dog-12345.png'
			);

			const result = await tool.execute({ prompt: 'a dog', background: true }, mockContext);

			expect(result.success).toBe(true);
			expect(result.data.output_path).toBe('gemini-scribe/Background-Tasks/generated-a-dog-12345.png');
			expect(mockImageGeneration.resolveOutputPath).toHaveBeenCalledWith('a dog', undefined);
		});

		it('routes explicit output_path through the service resolver so validation applies', async () => {
			// The service normalises .jpg → .png when validating — caller and resolver see
			// the same final path so the agent isn't lied to.
			mockImageGeneration.resolveOutputPath.mockResolvedValue('pictures/dog.png');

			const result = await tool.execute(
				{ prompt: 'a dog', background: true, output_path: 'pictures/dog.jpg' },
				mockContext
			);

			expect(result.success).toBe(true);
			expect(result.data.output_path).toBe('pictures/dog.png');
			expect(mockImageGeneration.resolveOutputPath).toHaveBeenCalledWith('a dog', 'pictures/dog.jpg');
		});

		it('returns a tool error synchronously when the resolver throws (invalid path or no reference)', async () => {
			mockImageGeneration.resolveOutputPath.mockRejectedValue(
				new Error('Output path cannot be inside the plugin state folder')
			);

			const result = await tool.execute(
				{ prompt: 'a cat', background: true, output_path: 'gemini-scribe/bad.png' },
				mockContext
			);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to resolve image output path');
			expect(result.error).toContain('plugin state folder');
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
			mockImageGeneration.resolveOutputPath.mockResolvedValue('gemini-scribe/Background-Tasks/result.png');
			mockImageGeneration.generateImage.mockResolvedValue('gemini-scribe/Background-Tasks/result.png');

			await tool.execute({ prompt: 'a sunset', background: true }, mockContext);

			const callback = mockBackgroundTaskManager.submit.mock.calls[0][2];
			const returnedPath = await callback(() => false);

			// The resolved path is passed through as the explicit outputPath so the
			// task writes exactly where we told the agent it would land.
			expect(mockImageGeneration.generateImage).toHaveBeenCalledWith(
				'a sunset',
				'gemini-scribe/Background-Tasks/result.png'
			);
			expect(returnedPath).toBe('gemini-scribe/Background-Tasks/result.png');
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
