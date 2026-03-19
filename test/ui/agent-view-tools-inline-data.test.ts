/**
 * Unit tests for inlineData injection in AgentViewTools
 * Tests the tool results → conversation parts building logic
 */

export {};

describe('AgentViewTools - InlineData Injection', () => {
	/**
	 * Helper function that mirrors the flatMap logic in handleToolCalls
	 * for building tool result parts with inlineData injection.
	 */
	function buildToolResultParts(toolResults: any[]): any[] {
		return toolResults.flatMap((tr) => {
			const { inlineData, ...resultWithoutInlineData } = tr.result;
			const parts: any[] = [
				{
					functionResponse: {
						name: tr.toolName,
						response: resultWithoutInlineData,
					},
				},
			];
			if (inlineData && Array.isArray(inlineData)) {
				for (const attachment of inlineData) {
					parts.push({
						inlineData: { mimeType: attachment.mimeType, data: attachment.base64 },
					});
				}
			}
			return parts;
		});
	}

	describe('Tool results without inlineData', () => {
		test('should pass through a simple text tool result unchanged', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'note.md', type: 'file', content: 'hello' },
					},
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(1);
			expect(parts[0].functionResponse.name).toBe('read_file');
			expect(parts[0].functionResponse.response).toEqual({
				success: true,
				data: { path: 'note.md', type: 'file', content: 'hello' },
			});
		});

		test('should handle multiple text tool results', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: { success: true, data: { path: 'a.md' } },
				},
				{
					toolName: 'list_files',
					result: { success: true, data: { files: [] } },
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(2);
			expect(parts[0].functionResponse.name).toBe('read_file');
			expect(parts[1].functionResponse.name).toBe('list_files');
		});

		test('should handle failed tool results', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: { success: false, error: 'File not found' },
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(1);
			expect(parts[0].functionResponse.response).toEqual({
				success: false,
				error: 'File not found',
			});
		});
	});

	describe('Tool results with inlineData', () => {
		test('should inject inlineData as separate parts after functionResponse', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'photo.png', type: 'binary_file', mimeType: 'image/png', size: 1024 },
						inlineData: [{ base64: 'iVBORw0KGgo=', mimeType: 'image/png' }],
					},
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(2);
			// First part: functionResponse (without inlineData)
			expect(parts[0].functionResponse.name).toBe('read_file');
			expect(parts[0].functionResponse.response).toEqual({
				success: true,
				data: { path: 'photo.png', type: 'binary_file', mimeType: 'image/png', size: 1024 },
			});
			expect(parts[0].functionResponse.response).not.toHaveProperty('inlineData');
			// Second part: inlineData
			expect(parts[1].inlineData).toEqual({
				mimeType: 'image/png',
				data: 'iVBORw0KGgo=',
			});
		});

		test('should strip inlineData from functionResponse.response', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'doc.pdf' },
						inlineData: [{ base64: 'JVBERi0=', mimeType: 'application/pdf' }],
					},
				},
			];

			const parts = buildToolResultParts(toolResults);

			// inlineData should NOT appear in the functionResponse
			expect(parts[0].functionResponse.response).not.toHaveProperty('inlineData');
		});

		test('should handle multiple inlineData attachments from one tool', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'multi.pdf' },
						inlineData: [
							{ base64: 'page1data', mimeType: 'application/pdf' },
							{ base64: 'page2data', mimeType: 'application/pdf' },
						],
					},
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(3); // 1 functionResponse + 2 inlineData
			expect(parts[1].inlineData.mimeType).toBe('application/pdf');
			expect(parts[2].inlineData.data).toBe('page2data');
		});

		test('should handle mix of text and binary tool results', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'note.md', content: 'text' },
					},
				},
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'image.png', type: 'binary_file' },
						inlineData: [{ base64: 'imgdata', mimeType: 'image/png' }],
					},
				},
				{
					toolName: 'list_files',
					result: {
						success: true,
						data: { files: ['a.md', 'b.png'] },
					},
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(4); // 3 functionResponses + 1 inlineData
			expect(parts[0].functionResponse.name).toBe('read_file');
			expect(parts[0].functionResponse.response.data.content).toBe('text');
			expect(parts[1].functionResponse.name).toBe('read_file');
			expect(parts[2].inlineData.mimeType).toBe('image/png');
			expect(parts[3].functionResponse.name).toBe('list_files');
		});
	});

	describe('Edge cases', () => {
		test('should handle empty inlineData array', () => {
			const toolResults = [
				{
					toolName: 'read_file',
					result: {
						success: true,
						data: { path: 'file.md' },
						inlineData: [],
					},
				},
			];

			const parts = buildToolResultParts(toolResults);

			expect(parts).toHaveLength(1);
			expect(parts[0].functionResponse).toBeDefined();
		});

		test('should handle empty tool results', () => {
			const parts = buildToolResultParts([]);
			expect(parts).toHaveLength(0);
		});
	});
});
