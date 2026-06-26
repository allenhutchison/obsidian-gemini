// Mock for @google/genai
import { vi } from 'vitest';

export const GoogleGenAI = vi.fn().mockImplementation(function () {
	return {
		models: {
			generateContent: vi.fn().mockResolvedValue({
				response: {
					text: () => 'Mock response text',
					candidates: [
						{
							groundingMetadata: {
								webSearchQueries: ['test query'],
								groundingAttributions: [
									{
										uri: 'https://example.com',
										content: 'Mock content',
									},
								],
							},
						},
					],
				},
			}),
		},
		interactions: {
			create: vi.fn().mockResolvedValue({
				id: 'int_mock',
				status: 'completed',
				output_text: 'Mock interaction text',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Mock interaction text' }] }],
				usage: { total_input_tokens: 1, total_output_tokens: 1, total_tokens: 2 },
			}),
		},
	};
});
