import { GeminiApiNew } from './gemini-api-new';
import { GoogleGenAI } from '@google/genai'; // Ensure this is imported for mocking
import ObsidianGemini from '../../../main'; // Adjust path as necessary
import { BaseModelRequest, StreamCallback, StreamingModelResponse } from '../interfaces/model-api'; // Adjust path as necessary

// Mock @google/genai
jest.mock('@google/genai', () => {
	const mockGenerateContent = jest.fn();
	const mockGenerateContentStream = jest.fn();
	return {
		GoogleGenAI: jest.fn().mockImplementation(() => ({
			models: {
				// Using 'models' as per the subtask's example
				generateContent: mockGenerateContent,
				generateContentStream: mockGenerateContentStream,
			},
		})),
		mockGenerateContent, // Export for test manipulation
		mockGenerateContentStream, // Export for streaming tests
	};
});

// Mock ObsidianGemini plugin
jest.mock('../../../main', () => {
	return jest.fn().mockImplementation(() => ({
		settings: {
			apiKey: 'test-api-key',
			chatModelName: 'gemini-pro', // chatModelName is used by GeminiApiNew
			debugMode: false,
			userName: 'TestUser',
			// ... other settings
		},
		prompts: {
			systemPrompt: jest.fn().mockReturnValue('System Instruction Text'),
		},
		gfile: {
			getCurrentFileContent: jest.fn().mockResolvedValue(null),
		},
	}));
});

describe('GeminiApiNew', () => {
	let geminiApiNew: GeminiApiNew;
	let mockPluginInstance: InstanceType<typeof ObsidianGemini>;
	// Get the mock functions from the mocked @google/genai
	const { mockGenerateContent, mockGenerateContentStream } = require('@google/genai');

	beforeEach(() => {
		mockPluginInstance = new (ObsidianGemini as any)();
		// When GeminiApiNew is instantiated, it will try to get the generative model.
		// The mock for GoogleGenAI needs to correctly provide 'models.generateContent' if that's what GeminiApiNew expects,
		// or 'getGenerativeModel().generateContent' if it expects that.
		// The actual code in gemini-api-new.ts uses:
		// const genAI = new GoogleGenAI(this.plugin.settings.apiKey);
		// this.model = genAI.getGenerativeModel({ model: chatModelName });
		// So, the GoogleGenAI mock should be:
		// getGenerativeModel: jest.fn().mockImplementation(() => ({ generateContent: mockGenerateContent }))
		// However, the subtask strictly provides the 'models.generateContent' structure.
		// For this step, I will adhere to the subtask's provided mock structure.
		// This might mean the test won't pass if GeminiApiNew isn't aligned with this mock.
		geminiApiNew = new GeminiApiNew(mockPluginInstance);
		mockGenerateContent.mockClear();
		mockGenerateContentStream.mockClear();
	});

	describe('generateModelResponse and parseModelResult', () => {
		it('should correctly decode HTML entities in the markdown response', async () => {
			// mockApiResponse structure as per the subtask's example (direct text method on the object returned by generateContent)
			const mockApiResponse = {
				// This mock structure implies that the object returned by `generateContent`
				// (which is `result` in `gemini-api-new.ts`) has a `text()` method directly.
				// The actual `gemini-api-new.ts` uses `result.response.text()`.
				// Adhering to the subtask's example for `mockApiResponse` for now.
				text: () => 'This is a &quot;test&quot; with an apostrophe &#x27;s and another &amp;amp; entity.',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);

			const request: BaseModelRequest = {
				prompt: 'Tell me about quotes.',
			};

			const response = await geminiApiNew.generateModelResponse(request);

			expect(response.markdown).toBe('This is a "test" with an apostrophe \'s and another &amp; entity.');
		});

		it('should handle responses with no HTML entities', async () => {
			const mockApiResponse = {
				text: () => 'This is a plain sentence.',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);

			const request: BaseModelRequest = { prompt: 'A plain prompt.' };
			const response = await geminiApiNew.generateModelResponse(request);
			expect(response.markdown).toBe('This is a plain sentence.');
		});

		it('should correctly decode mixed content with HTML entities', async () => {
			const mockApiResponse = {
				text: () => 'Text &quot;One&quot; and text &#x27;Two&#x27; plus &lt;tag&gt;.',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);
			const request: BaseModelRequest = { prompt: 'Test mixed content' };
			const response = await geminiApiNew.generateModelResponse(request);
			expect(response.markdown).toBe('Text "One" and text \'Two\' plus <tag>.');
		});

		it('should return empty string for markdown if text is not present in response', async () => {
			// This mock implies that the object returned by generateContent might not have a text() method,
			// or text() might return undefined/null.
			const mockApiResponse = {
				// no text field or text() method.
				// parseModelResult in GeminiApiNew should handle this.
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);
			const request: BaseModelRequest = { prompt: 'Test no text' };
			const response = await geminiApiNew.generateModelResponse(request);
			expect(response.markdown).toBe('');
		});
	});

	describe('generateStreamingResponse', () => {
		it('should handle streaming response with multiple chunks', async () => {
			// Create an async generator that yields chunks
			const mockChunks = [{ text: 'Hello ' }, { text: 'world!' }, { text: ' How are you?' }];

			async function* mockAsyncGenerator() {
				for (const chunk of mockChunks) {
					yield chunk;
				}
			}

			mockGenerateContentStream.mockResolvedValue(mockAsyncGenerator());

			const request: BaseModelRequest = {
				prompt: 'Say hello',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const streamResponse: StreamingModelResponse = geminiApiNew.generateStreamingResponse!(request, onChunk);
			const response = await streamResponse.complete;

			expect(receivedChunks).toEqual(['Hello ', 'world!', ' How are you?']);
			expect(response.markdown).toBe('Hello world! How are you?');
		});

		it('should decode HTML entities in streaming chunks', async () => {
			const mockChunks = [{ text: 'This is &quot;quoted&quot; ' }, { text: 'and &#x27;apostrophed&#x27;.' }];

			async function* mockAsyncGenerator() {
				for (const chunk of mockChunks) {
					yield chunk;
				}
			}

			mockGenerateContentStream.mockResolvedValue(mockAsyncGenerator());

			const request: BaseModelRequest = {
				prompt: 'Test entities',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const streamResponse: StreamingModelResponse = geminiApiNew.generateStreamingResponse!(request, onChunk);
			const response = await streamResponse.complete;

			expect(receivedChunks).toEqual(['This is "quoted" ', "and 'apostrophed'."]);
			expect(response.markdown).toBe('This is "quoted" and \'apostrophed\'.');
		});

		it('should handle streaming cancellation', async () => {
			// Create a long-running async generator
			async function* mockAsyncGenerator() {
				yield { text: 'First chunk' };
				// Simulate delay between chunks
				await new Promise((resolve) => setTimeout(resolve, 100));
				yield { text: 'Second chunk' };
				await new Promise((resolve) => setTimeout(resolve, 100));
				yield { text: 'Third chunk' };
			}

			mockGenerateContentStream.mockResolvedValue(mockAsyncGenerator());

			const request: BaseModelRequest = {
				prompt: 'Long response',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const streamResponse: StreamingModelResponse = geminiApiNew.generateStreamingResponse!(request, onChunk);

			// Cancel after receiving first chunk
			setTimeout(() => {
				streamResponse.cancel();
			}, 50);

			const response = await streamResponse.complete;

			// Should only receive the first chunk before cancellation
			expect(receivedChunks.length).toBeLessThanOrEqual(2);
			expect(receivedChunks[0]).toBe('First chunk');
		});

		it('should handle empty chunks in streaming', async () => {
			const mockChunks = [
				{ text: 'Hello' },
				{ text: '' }, // Empty chunk
				{ text: ' world' },
				{}, // Chunk without text property
				{ text: '!' },
			];

			async function* mockAsyncGenerator() {
				for (const chunk of mockChunks) {
					yield chunk;
				}
			}

			mockGenerateContentStream.mockResolvedValue(mockAsyncGenerator());

			const request: BaseModelRequest = {
				prompt: 'Test empty chunks',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const streamResponse: StreamingModelResponse = geminiApiNew.generateStreamingResponse!(request, onChunk);
			const response = await streamResponse.complete;

			// Should only receive non-empty chunks
			expect(receivedChunks).toEqual(['Hello', ' world', '!']);
			expect(response.markdown).toBe('Hello world!');
		});

		it('should handle streaming errors gracefully', async () => {
			async function* mockAsyncGenerator() {
				yield { text: 'First chunk' };
				throw new Error('Stream error');
			}

			mockGenerateContentStream.mockResolvedValue(mockAsyncGenerator());

			const request: BaseModelRequest = {
				prompt: 'Error test',
			};

			const receivedChunks: string[] = [];
			const onChunk: StreamCallback = (chunk: string) => {
				receivedChunks.push(chunk);
			};

			const streamResponse: StreamingModelResponse = geminiApiNew.generateStreamingResponse!(request, onChunk);

			await expect(streamResponse.complete).rejects.toThrow('Stream error');
			expect(receivedChunks).toEqual(['First chunk']);
		});
	});

	describe('temperature and topP parameters', () => {
		it('should use temperature from request if provided', async () => {
			const mockApiResponse = {
				text: () => 'Test response',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
				temperature: 0.3,
			};

			await geminiApiNew.generateModelResponse(request);

			// Check that generateContent was called with the correct temperature
			expect(mockGenerateContent).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						temperature: 0.3,
					}),
				})
			);
		});

		it('should use topP from request if provided', async () => {
			const mockApiResponse = {
				text: () => 'Test response',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
				topP: 0.8,
			};

			await geminiApiNew.generateModelResponse(request);

			// Check that generateContent was called with the correct topP
			expect(mockGenerateContent).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						topP: 0.8,
					}),
				})
			);
		});

		it('should use default temperature from settings if not provided in request', async () => {
			const mockApiResponse = {
				text: () => 'Test response',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);

			// Update mock settings to include temperature and topP
			mockPluginInstance.settings.temperature = 0.7;
			mockPluginInstance.settings.topP = 1;

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
			};

			await geminiApiNew.generateModelResponse(request);

			// Check that generateContent was called with the default temperature
			expect(mockGenerateContent).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						temperature: 0.7,
						topP: 1,
					}),
				})
			);
		});

		it('should handle both temperature and topP together', async () => {
			const mockApiResponse = {
				text: () => 'Test response',
			};
			mockGenerateContent.mockResolvedValue(mockApiResponse);

			const request: BaseModelRequest = {
				prompt: 'Test prompt',
				temperature: 0.5,
				topP: 0.9,
			};

			await geminiApiNew.generateModelResponse(request);

			// Check that generateContent was called with both parameters
			expect(mockGenerateContent).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						temperature: 0.5,
						topP: 0.9,
					}),
				})
			);
		});
	});
});
