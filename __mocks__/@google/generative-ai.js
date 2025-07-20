// Mock for @google/generative-ai

const GoogleGenerativeAI = jest.fn().mockImplementation(() => ({
	getGenerativeModel: jest.fn().mockReturnValue({
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
	})
}));

module.exports = {
	GoogleGenerativeAI
};