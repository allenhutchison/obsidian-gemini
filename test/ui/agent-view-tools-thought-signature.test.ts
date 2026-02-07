/**
 * Unit tests for thought signature handling in AgentViewTools
 * Tests the conditional inclusion of thoughtSignature property when building conversation history
 */

// Make this file a module for TypeScript
export {};

describe('AgentViewTools - Thought Signature Handling', () => {
	/**
	 * Helper function to simulate the parts building logic from handleToolCalls
	 * This mirrors the actual implementation in agent-view-tools.ts:165-171
	 */
	function buildPartsFromToolCalls(toolCalls: any[]): any[] {
		return toolCalls.map((tc) => ({
			functionCall: {
				name: tc.name,
				args: tc.arguments || {},
			},
			...(tc.thoughtSignature && { thoughtSignature: tc.thoughtSignature }),
		}));
	}

	describe('Single tool call scenarios', () => {
		test('should include thoughtSignature when present', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'test' },
					thoughtSignature: 'encrypted_signature_abc123',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0]).toHaveProperty('thoughtSignature', 'encrypted_signature_abc123');
			expect(parts[0].functionCall.name).toBe('google_search');
			expect(parts[0].functionCall.args).toEqual({ query: 'test' });
		});

		test('should omit thoughtSignature property when undefined', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'test' },
					thoughtSignature: undefined,
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0]).not.toHaveProperty('thoughtSignature');
			expect(parts[0].functionCall.name).toBe('google_search');
			expect(parts[0].functionCall.args).toEqual({ query: 'test' });
		});

		test('should omit thoughtSignature property when null', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'test' },
					thoughtSignature: null,
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0]).not.toHaveProperty('thoughtSignature');
			expect(parts[0].functionCall.name).toBe('google_search');
		});

		test('should omit thoughtSignature property when empty string', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'test' },
					thoughtSignature: '',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0]).not.toHaveProperty('thoughtSignature');
			expect(parts[0].functionCall.name).toBe('google_search');
		});

		test('should omit thoughtSignature property when not provided at all', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'test' },
					// no thoughtSignature property
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0]).not.toHaveProperty('thoughtSignature');
		});
	});

	describe('Multiple tool call scenarios', () => {
		test('should handle multiple calls with all having signatures', () => {
			const toolCalls = [
				{
					name: 'read_file',
					arguments: { path: 'file1.md' },
					thoughtSignature: 'signature_1',
				},
				{
					name: 'read_file',
					arguments: { path: 'file2.md' },
					thoughtSignature: 'signature_2',
				},
				{
					name: 'google_search',
					arguments: { query: 'test' },
					thoughtSignature: 'signature_3',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(3);
			expect(parts[0]).toHaveProperty('thoughtSignature', 'signature_1');
			expect(parts[1]).toHaveProperty('thoughtSignature', 'signature_2');
			expect(parts[2]).toHaveProperty('thoughtSignature', 'signature_3');
		});

		test('should handle multiple calls with none having signatures', () => {
			const toolCalls = [
				{
					name: 'read_file',
					arguments: { path: 'file1.md' },
					thoughtSignature: undefined,
				},
				{
					name: 'write_file',
					arguments: { path: 'file2.md', content: 'test' },
					thoughtSignature: undefined,
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(2);
			expect(parts[0]).not.toHaveProperty('thoughtSignature');
			expect(parts[1]).not.toHaveProperty('thoughtSignature');
		});

		test('should handle mixed scenario - first with signature, others without', () => {
			// This simulates Gemini 3 behavior where only first parallel call has signature
			const toolCalls = [
				{
					name: 'read_file',
					arguments: { path: 'file1.md' },
					thoughtSignature: 'main_signature',
				},
				{
					name: 'read_file',
					arguments: { path: 'file2.md' },
					thoughtSignature: undefined,
				},
				{
					name: 'read_file',
					arguments: { path: 'file3.md' },
					thoughtSignature: undefined,
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(3);
			expect(parts[0]).toHaveProperty('thoughtSignature', 'main_signature');
			expect(parts[1]).not.toHaveProperty('thoughtSignature');
			expect(parts[2]).not.toHaveProperty('thoughtSignature');
		});

		test('should handle mixed scenario - some with signatures, some without', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'AI' },
					thoughtSignature: 'sig_1',
				},
				{
					name: 'read_file',
					arguments: { path: 'notes.md' },
					thoughtSignature: undefined,
				},
				{
					name: 'fetch_url',
					arguments: { url: 'https://example.com' },
					thoughtSignature: 'sig_2',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(3);
			expect(parts[0]).toHaveProperty('thoughtSignature', 'sig_1');
			expect(parts[1]).not.toHaveProperty('thoughtSignature');
			expect(parts[2]).toHaveProperty('thoughtSignature', 'sig_2');
		});
	});

	describe('Edge cases', () => {
		test('should handle empty tool calls array', () => {
			const toolCalls: any[] = [];
			const parts = buildPartsFromToolCalls(toolCalls);
			expect(parts).toHaveLength(0);
		});

		test('should handle tool call with no arguments', () => {
			const toolCalls = [
				{
					name: 'list_files',
					thoughtSignature: 'signature_xyz',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0].functionCall.args).toEqual({});
			expect(parts[0]).toHaveProperty('thoughtSignature', 'signature_xyz');
		});

		test('should handle tool call with empty arguments object', () => {
			const toolCalls = [
				{
					name: 'list_files',
					arguments: {},
					thoughtSignature: 'signature_xyz',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0].functionCall.args).toEqual({});
			expect(parts[0]).toHaveProperty('thoughtSignature', 'signature_xyz');
		});

		test('should handle tool call with complex arguments', () => {
			const toolCalls = [
				{
					name: 'complex_tool',
					arguments: {
						nested: { key: 'value' },
						array: [1, 2, 3],
						boolean: true,
						number: 42,
					},
					thoughtSignature: 'complex_sig',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);

			expect(parts).toHaveLength(1);
			expect(parts[0].functionCall.args).toEqual({
				nested: { key: 'value' },
				array: [1, 2, 3],
				boolean: true,
				number: 42,
			});
			expect(parts[0]).toHaveProperty('thoughtSignature', 'complex_sig');
		});
	});

	describe('JSON serialization behavior', () => {
		test('serialized JSON should not contain thoughtSignature when undefined', () => {
			const toolCalls = [
				{
					name: 'test_tool',
					arguments: { test: 'value' },
					thoughtSignature: undefined,
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);
			const serialized = JSON.stringify(parts);

			// Verify thoughtSignature is not in the serialized output
			expect(serialized).not.toContain('thoughtSignature');
			expect(serialized).toContain('test_tool');
		});

		test('serialized JSON should contain thoughtSignature when present', () => {
			const toolCalls = [
				{
					name: 'test_tool',
					arguments: { test: 'value' },
					thoughtSignature: 'my_signature',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);
			const serialized = JSON.stringify(parts);

			// Verify thoughtSignature IS in the serialized output
			expect(serialized).toContain('thoughtSignature');
			expect(serialized).toContain('my_signature');
		});

		test('should match expected API format for Gemini 3', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'quantum physics' },
					thoughtSignature: 'encrypted_thoughts_xyz',
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);
			const expected = [
				{
					functionCall: {
						name: 'google_search',
						args: { query: 'quantum physics' },
					},
					thoughtSignature: 'encrypted_thoughts_xyz',
				},
			];

			expect(parts).toEqual(expected);
		});

		test('should match expected API format for Gemini 2.5 (no signature)', () => {
			const toolCalls = [
				{
					name: 'google_search',
					arguments: { query: 'quantum physics' },
					thoughtSignature: undefined,
				},
			];

			const parts = buildPartsFromToolCalls(toolCalls);
			const expected = [
				{
					functionCall: {
						name: 'google_search',
						args: { query: 'quantum physics' },
					},
					// no thoughtSignature property
				},
			];

			expect(parts).toEqual(expected);
		});
	});

	describe('Real-world scenario simulation', () => {
		test('should handle typical Gemini 3 multi-turn conversation flow', () => {
			// Simulates: User asks question -> Model calls tools -> Tools execute -> Send back with signatures

			// Turn 1: Model calls 3 tools (first has signature per Gemini 3 docs)
			const turn1ToolCalls = [
				{
					name: 'read_file',
					arguments: { path: 'research.md' },
					thoughtSignature: 'turn1_sig', // Only first has signature
				},
				{
					name: 'read_file',
					arguments: { path: 'notes.md' },
					thoughtSignature: undefined,
				},
				{
					name: 'google_search',
					arguments: { query: 'latest findings' },
					thoughtSignature: undefined,
				},
			];

			const turn1Parts = buildPartsFromToolCalls(turn1ToolCalls);

			// Verify structure for Turn 1
			expect(turn1Parts[0]).toHaveProperty('thoughtSignature', 'turn1_sig');
			expect(turn1Parts[1]).not.toHaveProperty('thoughtSignature');
			expect(turn1Parts[2]).not.toHaveProperty('thoughtSignature');

			// Turn 2: Model calls 2 more tools
			const turn2ToolCalls = [
				{
					name: 'write_file',
					arguments: { path: 'summary.md', content: 'findings' },
					thoughtSignature: 'turn2_sig',
				},
				{
					name: 'list_files',
					arguments: { path: '/' },
					thoughtSignature: undefined,
				},
			];

			const turn2Parts = buildPartsFromToolCalls(turn2ToolCalls);

			// Verify structure for Turn 2
			expect(turn2Parts[0]).toHaveProperty('thoughtSignature', 'turn2_sig');
			expect(turn2Parts[1]).not.toHaveProperty('thoughtSignature');

			// Both turns should maintain proper structure
			expect(turn1Parts).toHaveLength(3);
			expect(turn2Parts).toHaveLength(2);
		});
	});
});
