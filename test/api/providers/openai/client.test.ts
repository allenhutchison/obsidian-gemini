import { describe, it, expect, vi } from 'vitest';
import { OpenAiClient } from '../../../../src/api/providers/openai/client';
import { requestUrl } from 'obsidian';

describe('OpenAiClient', () => {
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
});
