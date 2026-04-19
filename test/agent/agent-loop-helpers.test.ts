import {
	sortToolCallsByPriority,
	buildFunctionCallParts,
	buildFunctionResponseParts,
	buildToolHistoryTurns,
	ToolCallResultPair,
} from '../../src/agent/agent-loop-helpers';
import type { ToolCall } from '../../src/api/interfaces/model-api';

describe('sortToolCallsByPriority', () => {
	test('orders reads before writes and deletes', () => {
		const calls = [{ name: 'delete_file' }, { name: 'write_file' }, { name: 'read_file' }, { name: 'list_files' }];

		const sorted = sortToolCallsByPriority(calls);

		expect(sorted.map((c) => c.name)).toEqual(['read_file', 'list_files', 'write_file', 'delete_file']);
	});

	test('unknown tools sort after all known reads but before any known write/destructive', () => {
		const calls = [
			{ name: 'delete_file' },
			{ name: 'write_file' },
			{ name: 'mystery_tool' },
			{ name: 'read_file' },
			{ name: 'another_unknown' },
		];

		const sorted = sortToolCallsByPriority(calls);

		// Reads first, then unknowns (stable order between them), then writes, then destructive
		expect(sorted.map((c) => c.name)).toEqual([
			'read_file',
			'mystery_tool',
			'another_unknown',
			'write_file',
			'delete_file',
		]);
	});

	test('all known READ-classified tools sort before any write/destructive (regression for missing custom reads)', () => {
		const reads = [
			'read_file',
			'list_files',
			'find_files_by_name',
			'find_files_by_content',
			'get_workspace_state',
			'read_memory',
			'recall_sessions',
			'vault_semantic_search',
			'activate_skill',
		];
		const writes = ['write_file', 'create_folder', 'update_frontmatter', 'append_content', 'update_memory'];
		const destructive = ['move_file', 'delete_file'];

		// Interleave: every read alternated with a delete — sort must still pull all reads first
		const interleaved = reads.flatMap((r) => [{ name: 'delete_file' }, { name: r }]);
		const sorted = sortToolCallsByPriority(interleaved);

		// First N positions must all be the reads (any order); after that, no read may appear.
		const firstN = sorted.slice(0, reads.length).map((c) => c.name);
		const restNames = sorted.slice(reads.length).map((c) => c.name);
		for (const r of reads) {
			expect(firstN).toContain(r);
		}
		for (const w of [...writes, ...destructive]) {
			expect(firstN).not.toContain(w);
		}
		// And no read sneaks into the trailing block
		expect(restNames.some((n) => reads.includes(n))).toBe(false);
	});

	test('preserves relative order for equal-priority calls', () => {
		const calls = [
			{ name: 'read_file', tag: 'a' },
			{ name: 'read_file', tag: 'b' },
			{ name: 'read_file', tag: 'c' },
		];

		const sorted = sortToolCallsByPriority(calls);

		expect(sorted.map((c) => c.tag)).toEqual(['a', 'b', 'c']);
	});

	test('does not mutate the input array', () => {
		const calls = [{ name: 'delete_file' }, { name: 'read_file' }];
		const original = [...calls];

		sortToolCallsByPriority(calls);

		expect(calls).toEqual(original);
	});

	test('handles empty array', () => {
		expect(sortToolCallsByPriority([])).toEqual([]);
	});
});

describe('buildFunctionCallParts', () => {
	test('omits thoughtSignature when not present', () => {
		const calls: ToolCall[] = [{ name: 'read_file', arguments: { path: 'note.md' } }];

		const parts = buildFunctionCallParts(calls);

		expect(parts).toEqual([{ functionCall: { name: 'read_file', args: { path: 'note.md' } } }]);
		expect(parts[0]).not.toHaveProperty('thoughtSignature');
	});

	test('includes thoughtSignature as a sibling of functionCall', () => {
		const calls: ToolCall[] = [{ name: 'google_search', arguments: { query: 'gemini' }, thoughtSignature: 'sig_abc' }];

		const parts = buildFunctionCallParts(calls);

		expect(parts[0]).toEqual({
			functionCall: { name: 'google_search', args: { query: 'gemini' } },
			thoughtSignature: 'sig_abc',
		});
		// thoughtSignature must NOT be nested inside functionCall — Gemini 3 spec
		expect(parts[0].functionCall).not.toHaveProperty('thoughtSignature');
	});

	test('omits empty-string and null and undefined thoughtSignature', () => {
		const calls: ToolCall[] = [
			{ name: 'a', arguments: {}, thoughtSignature: '' },
			{ name: 'b', arguments: {}, thoughtSignature: undefined },
			{ name: 'c', arguments: {}, thoughtSignature: null as any },
		];

		const parts = buildFunctionCallParts(calls);

		for (const p of parts) {
			expect(p).not.toHaveProperty('thoughtSignature');
		}
		// And not in serialized form either
		expect(JSON.stringify(parts)).not.toContain('thoughtSignature');
	});

	test('includes id when present, omits when absent', () => {
		const calls: ToolCall[] = [
			{ name: 'a', arguments: {}, id: 'call_1' },
			{ name: 'b', arguments: {} },
		];

		const parts = buildFunctionCallParts(calls);

		expect(parts[0].functionCall).toEqual({ name: 'a', args: {}, id: 'call_1' });
		expect(parts[1].functionCall).toEqual({ name: 'b', args: {} });
		expect(parts[1].functionCall).not.toHaveProperty('id');
	});

	test('defaults missing arguments to empty object', () => {
		const calls: any[] = [{ name: 'list_files' }];

		const parts = buildFunctionCallParts(calls);

		expect(parts[0].functionCall.args).toEqual({});
	});

	test('handles the Gemini 3 mixed-signature case (only first parallel call has signature)', () => {
		const calls: ToolCall[] = [
			{ name: 'read_file', arguments: { path: 'a.md' }, thoughtSignature: 'main_sig' },
			{ name: 'read_file', arguments: { path: 'b.md' } },
			{ name: 'read_file', arguments: { path: 'c.md' } },
		];

		const parts = buildFunctionCallParts(calls);

		expect(parts[0]).toHaveProperty('thoughtSignature', 'main_sig');
		expect(parts[1]).not.toHaveProperty('thoughtSignature');
		expect(parts[2]).not.toHaveProperty('thoughtSignature');
	});

	test('preserves complex argument shapes', () => {
		const calls: ToolCall[] = [
			{
				name: 'complex',
				arguments: { nested: { key: 'value' }, list: [1, 2, 3], flag: true, n: 42 },
				thoughtSignature: 'sig',
			},
		];

		const parts = buildFunctionCallParts(calls);

		expect(parts[0].functionCall.args).toEqual({
			nested: { key: 'value' },
			list: [1, 2, 3],
			flag: true,
			n: 42,
		});
	});

	test('handles empty input', () => {
		expect(buildFunctionCallParts([])).toEqual([]);
	});
});

describe('buildFunctionResponseParts', () => {
	test('emits a single functionResponse part for a text result', () => {
		const results: ToolCallResultPair[] = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'note.md' },
				result: { success: true, data: { path: 'note.md', content: 'hello' } } as any,
			},
		];

		const parts = buildFunctionResponseParts(results);

		expect(parts).toHaveLength(1);
		expect(parts[0]).toEqual({
			functionResponse: {
				name: 'read_file',
				response: { success: true, data: { path: 'note.md', content: 'hello' } },
			},
		});
	});

	test('strips inlineData from the functionResponse and re-injects as sibling parts', () => {
		const results: ToolCallResultPair[] = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'photo.png' },
				result: {
					success: true,
					data: { path: 'photo.png', mimeType: 'image/png' },
					inlineData: [{ base64: 'iVBOR...', mimeType: 'image/png' }],
				} as any,
			},
		];

		const parts = buildFunctionResponseParts(results);

		expect(parts).toHaveLength(2);
		expect(parts[0].functionResponse.response).not.toHaveProperty('inlineData');
		expect(parts[0].functionResponse.response.data.path).toBe('photo.png');
		expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'iVBOR...' } });
	});

	test('emits one inlineData part per attachment', () => {
		const results: ToolCallResultPair[] = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'multi.pdf' },
				result: {
					success: true,
					data: { path: 'multi.pdf' },
					inlineData: [
						{ base64: 'page1', mimeType: 'application/pdf' },
						{ base64: 'page2', mimeType: 'application/pdf' },
					],
				} as any,
			},
		];

		const parts = buildFunctionResponseParts(results);

		expect(parts).toHaveLength(3);
		expect(parts[1].inlineData.data).toBe('page1');
		expect(parts[2].inlineData.data).toBe('page2');
	});

	test('handles empty inlineData array (still emits only the functionResponse)', () => {
		const results: ToolCallResultPair[] = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'note.md' },
				result: { success: true, data: { path: 'note.md' }, inlineData: [] } as any,
			},
		];

		const parts = buildFunctionResponseParts(results);

		expect(parts).toHaveLength(1);
		expect(parts[0].functionResponse).toBeDefined();
	});

	test('passes through failed tool results', () => {
		const results: ToolCallResultPair[] = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'missing.md' },
				result: { success: false, error: 'File not found' },
			},
		];

		const parts = buildFunctionResponseParts(results);

		expect(parts[0].functionResponse.response).toEqual({ success: false, error: 'File not found' });
	});

	test('interleaves text-only and binary results in order', () => {
		const results: ToolCallResultPair[] = [
			{
				toolName: 'read_file',
				toolArguments: { path: 'a.md' },
				result: { success: true, data: { content: 'text' } } as any,
			},
			{
				toolName: 'read_file',
				toolArguments: { path: 'b.png' },
				result: {
					success: true,
					data: { path: 'b.png' },
					inlineData: [{ base64: 'imgdata', mimeType: 'image/png' }],
				} as any,
			},
			{
				toolName: 'list_files',
				toolArguments: {},
				result: { success: true, data: { files: ['a', 'b'] } } as any,
			},
		];

		const parts = buildFunctionResponseParts(results);

		expect(parts).toHaveLength(4);
		expect(parts[0].functionResponse.name).toBe('read_file');
		expect(parts[1].functionResponse.name).toBe('read_file');
		expect(parts[2].inlineData.mimeType).toBe('image/png');
		expect(parts[3].functionResponse.name).toBe('list_files');
	});

	test('handles empty input', () => {
		expect(buildFunctionResponseParts([])).toEqual([]);
	});
});

describe('buildToolHistoryTurns', () => {
	const sampleHistory = [
		{ role: 'user', parts: [{ text: 'prior turn' }] },
		{ role: 'model', parts: [{ text: 'prior reply' }] },
	];

	const sampleToolCall: ToolCall = { name: 'read_file', arguments: { path: 'a.md' } };
	const sampleResult: ToolCallResultPair = {
		toolName: 'read_file',
		toolArguments: { path: 'a.md' },
		result: { success: true, data: { content: 'x' } } as any,
	};

	test('appends model + user turns after existing history when userMessage is empty', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: sampleHistory,
			userMessage: '',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(updated).toHaveLength(4); // 2 prior + model + user
		expect(updated[0]).toEqual(sampleHistory[0]);
		expect(updated[1]).toEqual(sampleHistory[1]);
		expect(updated[2].role).toBe('model');
		expect(updated[2].parts[0].functionCall.name).toBe('read_file');
		expect(updated[3].role).toBe('user');
		expect(updated[3].parts[0].functionResponse.name).toBe('read_file');
	});

	test('splices userMessage between history and the new model turn (not at the end)', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: sampleHistory,
			userMessage: 'do this thing',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(updated).toHaveLength(5); // 2 prior + user text + model + user response
		expect(updated[2]).toEqual({ role: 'user', parts: [{ text: 'do this thing' }] });
		expect(updated[3].role).toBe('model');
		expect(updated[4].role).toBe('user');
	});

	test('treats whitespace-only userMessage as empty (no splice)', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: sampleHistory,
			userMessage: '   \n  ',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(updated).toHaveLength(4);
		expect(updated[2].role).toBe('model');
	});

	test('does not mutate the input conversationHistory', () => {
		const original = [...sampleHistory];
		buildToolHistoryTurns({
			conversationHistory: sampleHistory,
			userMessage: 'x',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(sampleHistory).toEqual(original);
	});

	test('handles empty conversationHistory', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: [],
			userMessage: 'first turn',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(updated).toHaveLength(3); // user + model + user response
		expect(updated[0]).toEqual({ role: 'user', parts: [{ text: 'first turn' }] });
		expect(updated[1].role).toBe('model');
		expect(updated[2].role).toBe('user');
	});

	test('preserves thoughtSignature through full composition', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: [],
			userMessage: 'q',
			toolCalls: [{ name: 'read_file', arguments: { path: 'a' }, thoughtSignature: 'sig_xyz' }],
			toolResults: [sampleResult],
		});

		expect(updated[1].parts[0]).toHaveProperty('thoughtSignature', 'sig_xyz');
	});

	test('preserves inlineData injection through full composition', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: [],
			userMessage: 'q',
			toolCalls: [{ name: 'read_file', arguments: { path: 'photo.png' } }],
			toolResults: [
				{
					toolName: 'read_file',
					toolArguments: { path: 'photo.png' },
					result: {
						success: true,
						data: { path: 'photo.png' },
						inlineData: [{ base64: 'imgbytes', mimeType: 'image/png' }],
					} as any,
				},
			],
		});

		// Last turn (user/functionResponse) should have 2 parts: functionResponse + inlineData
		const userResponseTurn = updated[updated.length - 1];
		expect(userResponseTurn.parts).toHaveLength(2);
		expect(userResponseTurn.parts[0].functionResponse).toBeDefined();
		expect(userResponseTurn.parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'imgbytes' });
	});
});
