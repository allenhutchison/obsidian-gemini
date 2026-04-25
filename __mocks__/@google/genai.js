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
	};
});
