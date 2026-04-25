// Mock for @google/generative-ai
import { vi } from 'vitest';

export const GoogleGenerativeAI = vi.fn().mockImplementation(function () {
	return {
		getGenerativeModel: vi.fn().mockReturnValue({
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
		}),
	};
});
