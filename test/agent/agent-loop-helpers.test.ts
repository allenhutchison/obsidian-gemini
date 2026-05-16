import {
	sortToolCallsByPriority,
	buildFunctionCallParts,
	buildFunctionResponseParts,
	buildToolHistoryTurns,
	truncateOldToolResults,
	DEFAULT_TOOL_RESPONSE_TRUNCATE_BYTES,
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

		expect(parts[0].functionCall!.args).toEqual({});
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

		expect(parts[0].functionCall!.args).toEqual({
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
		expect(parts[0].functionResponse!.response).not.toHaveProperty('inlineData');
		expect((parts[0].functionResponse!.response as any).data.path).toBe('photo.png');
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
		expect(parts[1].inlineData!.data).toBe('page1');
		expect(parts[2].inlineData!.data).toBe('page2');
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

		expect(parts[0].functionResponse!.response).toEqual({ success: false, error: 'File not found' });
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
		expect(parts[0].functionResponse!.name).toBe('read_file');
		expect(parts[1].functionResponse!.name).toBe('read_file');
		expect(parts[2].inlineData!.mimeType).toBe('image/png');
		expect(parts[3].functionResponse!.name).toBe('list_files');
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
		expect(updated[2].parts![0].functionCall!.name).toBe('read_file');
		expect(updated[3].role).toBe('user');
		expect(updated[3].parts![0].functionResponse!.name).toBe('read_file');
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

	test('merges userMessage and perTurnContext into a single spliced user turn', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: sampleHistory,
			userMessage: 'user query text',
			perTurnContext: 'context files content...',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(updated).toHaveLength(5); // 2 prior + user combined + model + user response
		expect(updated[2]).toEqual({
			role: 'user',
			parts: [{ text: 'user query text' }, { text: 'context files content...' }],
		});
		expect(updated[3].role).toBe('model');
		expect(updated[4].role).toBe('user');
	});

	test('splices user turn with only perTurnContext when userMessage is empty', () => {
		const updated = buildToolHistoryTurns({
			conversationHistory: sampleHistory,
			userMessage: '',
			perTurnContext: 'only context files...',
			toolCalls: [sampleToolCall],
			toolResults: [sampleResult],
		});

		expect(updated).toHaveLength(5);
		expect(updated[2]).toEqual({
			role: 'user',
			parts: [{ text: 'only context files...' }],
		});
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

		expect(updated[1].parts![0]).toHaveProperty('thoughtSignature', 'sig_xyz');
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
		expect(userResponseTurn.parts![0].functionResponse).toBeDefined();
		expect(userResponseTurn.parts![1].inlineData).toEqual({ mimeType: 'image/png', data: 'imgbytes' });
	});
});

describe('truncateOldToolResults', () => {
	const fnResponseTurn = (name: string, response: any) => ({
		role: 'user',
		parts: [{ functionResponse: { name, response } }],
	});
	const fnCallTurn = (name: string) => ({
		role: 'model',
		parts: [{ functionCall: { name, args: {} } }],
	});
	const userText = (text: string) => ({ role: 'user', parts: [{ text }] });
	const modelText = (text: string) => ({ role: 'model', parts: [{ text }] });

	const big = (size = DEFAULT_TOOL_RESPONSE_TRUNCATE_BYTES + 1000) => ({
		success: true,
		content: 'x'.repeat(size),
	});

	test('returns the exact input reference when there are no tool-result turns', () => {
		// Identity (not just deep equality) matters — ContextManager uses
		// `truncated !== history` as a fast-path to skip the double
		// JSON.stringify when no truncation occurred.
		const history = [userText('hi'), modelText('hello')];
		expect(truncateOldToolResults(history)).toBe(history);
	});

	test('returns the exact input reference when fewer tool-result turns exist than keepRecent', () => {
		const history = [fnCallTurn('read_file'), fnResponseTurn('read_file', { success: true, content: 'tiny' })];
		// Only 1 tool-result turn, keepRecent=2 — nothing to truncate.
		expect(truncateOldToolResults(history, { keepRecent: 2 })).toBe(history);
	});

	test('keeps the most recent N tool-result turns intact', () => {
		const history = [
			fnCallTurn('read_file'),
			fnResponseTurn('read_file', big()), // index 1 — old
			modelText('thinking'),
			fnCallTurn('read_file'),
			fnResponseTurn('read_file', big()), // index 4 — recent
			modelText('more'),
			fnCallTurn('read_file'),
			fnResponseTurn('read_file', big()), // index 7 — most recent
		];
		const out = truncateOldToolResults(history, { keepRecent: 2 });
		// First (oldest) tool-result turn should be truncated.
		expect((out[1].parts![0].functionResponse!.response as any).truncated).toBe(true);
		expect((out[1].parts![0].functionResponse!.response as any).success).toBe(true);
		// The two most recent tool-result turns should be untouched.
		expect(out[4]).toBe(history[4]);
		expect(out[7]).toBe(history[7]);
	});

	test('does not truncate small responses regardless of age', () => {
		const small = { success: true, content: 'short' };
		const history = [
			fnResponseTurn('read_file', small),
			fnResponseTurn('read_file', small),
			fnResponseTurn('read_file', small),
		];
		const out = truncateOldToolResults(history, { keepRecent: 1 });
		// All three responses are well under the threshold — none should be marked truncated.
		for (const turn of out) {
			expect((turn.parts![0].functionResponse!.response as any).truncated).toBeUndefined();
		}
	});

	test('preserves the original success flag when truncating', () => {
		const history = [
			fnResponseTurn('read_file', { success: false, error: 'x'.repeat(5000) }),
			fnResponseTurn('read_file', big()),
		];
		const out = truncateOldToolResults(history, { keepRecent: 1 });
		expect((out[0].parts![0].functionResponse!.response as any).success).toBe(false);
		expect((out[0].parts![0].functionResponse!.response as any).truncated).toBe(true);
		// truncatedFrom should be the serialized JSON length, which exceeds maxBytes.
		expect((out[0].parts![0].functionResponse!.response as any).truncatedFrom).toBeGreaterThan(
			DEFAULT_TOOL_RESPONSE_TRUNCATE_BYTES
		);
	});

	test('does not mutate the input history array', () => {
		const original = fnResponseTurn('read_file', big());
		const history = [original, fnResponseTurn('read_file', big())];
		truncateOldToolResults(history, { keepRecent: 1 });
		// The first turn was a candidate for truncation; the original object should be unchanged.
		expect((original.parts[0].functionResponse.response as any).truncated).toBeUndefined();
	});

	test('passes through inlineData and other non-functionResponse parts', () => {
		const history = [
			{
				role: 'user',
				parts: [
					{ functionResponse: { name: 'read_file', response: big() } },
					{ inlineData: { mimeType: 'image/png', data: 'abc' } },
				],
			},
			fnResponseTurn('read_file', big()), // recent — kept intact
		];
		const out = truncateOldToolResults(history, { keepRecent: 1 });
		// The functionResponse in the older turn was truncated...
		expect((out[0].parts![0].functionResponse!.response as any).truncated).toBe(true);
		// ...but the inlineData sibling is preserved.
		expect(out[0].parts![1].inlineData).toEqual({ mimeType: 'image/png', data: 'abc' });
	});

	test('respects custom maxBytes / keepRecent options', () => {
		const history = [
			fnResponseTurn('read_file', { success: true, content: 'x'.repeat(20) }),
			fnResponseTurn('read_file', { success: true, content: 'x'.repeat(20) }),
		];
		const out = truncateOldToolResults(history, { maxBytes: 10, keepRecent: 1 });
		expect((out[0].parts![0].functionResponse!.response as any).truncated).toBe(true);
		// keepRecent=1 → most recent is intact.
		expect(out[1]).toBe(history[1]);
	});

	test('handles empty / undefined input', () => {
		expect(truncateOldToolResults([])).toEqual([]);
		expect(truncateOldToolResults(undefined as any)).toEqual([]);
	});

	test('preserves functionResponse.name when truncating (shape regression)', () => {
		// When truncation replaced the response payload, an earlier any-typed
		// version could have accidentally dropped the sibling `name` field.
		// This test verifies the discriminated-union shape stays intact.
		const history = [fnResponseTurn('important_tool', big()), fnResponseTurn('another_tool', big())];
		const out = truncateOldToolResults(history, { keepRecent: 1 });
		const truncatedPart = out[0].parts![0];

		// The truncation marker must preserve the original functionResponse.name
		expect(truncatedPart.functionResponse!.name).toBe('important_tool');
		// And the response must have the truncation shape
		const response = truncatedPart.functionResponse!.response as Record<string, unknown>;
		expect(response).toHaveProperty('truncated', true);
		expect(response).toHaveProperty('truncatedFrom');
		expect(response).toHaveProperty('note');
		expect(typeof response.note).toBe('string');
	});
});
