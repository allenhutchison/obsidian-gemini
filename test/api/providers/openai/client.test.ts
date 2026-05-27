import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAiClient } from '../../../../src/api/providers/openai/client';
import { requestUrl } from 'obsidian';

describe('OpenAiClient', () => {
	beforeEach(() => {
		vi.mocked(requestUrl).mockReset();
	});

	it('generates non-streaming response', async () => {
		const mockResponse = {
			status: 200,
			json: {
				choices: [{ message: { content: 'Hello!' } }],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			},
		};
		vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

		const client = new OpenAiClient({
			baseUrl: 'https://api.example.com/v1',
			apiKey: 'test-key',
			model: 'gpt-4',
		});

		const result = await client.generateModelResponse({ prompt: 'Hi' });
		expect(result.markdown).toBe('Hello!');
		expect(result.usageMetadata?.promptTokenCount).toBe(10);
	});

	it('throws on HTTP error', async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 401, text: 'Unauthorized' } as any);

		const client = new OpenAiClient({
			baseUrl: 'https://api.example.com/v1',
			apiKey: 'bad-key',
			model: 'gpt-4',
		});

		await expect(client.generateModelResponse({ prompt: 'Hi' })).rejects.toThrow('401');
	});

	it('generates streaming response', async () => {
		const streamText = `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n`;
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: streamText,
		} as any);

		const client = new OpenAiClient({
			baseUrl: 'https://api.example.com/v1',
			apiKey: 'test-key',
			model: 'gpt-4',
		});

		const chunks: string[] = [];
		const stream = client.generateStreamingResponse({ prompt: 'Hi' }, (chunk) => {
			chunks.push(chunk.text);
		});

		const result = await stream.complete;
		expect(result.markdown).toBe('Hello!');
		expect(chunks).toEqual(['Hello', '!']);
	});

	it('handles ExtendedModelRequest with tools', async () => {
		const mockResponse = {
			status: 200,
			json: {
				choices: [{
					message: {
						content: 'I will help',
						tool_calls: [{
							id: 'call_1',
							function: { name: 'read_file', arguments: '{"path":"test.md"}' },
						}],
					},
				}],
				usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
			},
		};
		vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

		const client = new OpenAiClient({
			baseUrl: 'https://api.example.com/v1',
			apiKey: 'test-key',
			model: 'gpt-4',
		});

		const result = await client.generateModelResponse({
			userMessage: 'Read test.md',
			conversationHistory: [],
			availableTools: [{
				name: 'read_file',
				description: 'Read a file',
				parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
			}],
		} as any);

		expect(result.markdown).toBe('I will help');
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls![0].name).toBe('read_file');
	});
});
