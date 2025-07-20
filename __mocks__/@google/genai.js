// Mock for @google/genai

const GoogleGenAI = jest.fn().mockImplementation(() => ({
	models: {
		generateContent: jest.fn().mockResolvedValue({
			response: {
				text: () => 'Mock response text',
				candidates: [{
					groundingMetadata: {
						webSearchQueries: ['test query'],
						groundingAttributions: [{
							uri: 'https://example.com',
							content: 'Mock content'
						}]
					}
				}]
			}
		})
	}
}));

module.exports = {
	GoogleGenAI
};