import { SIMPLE_TOOL_ID_PATTERN, ToolIdLedger } from '../../../src/api/providers/tool-id-ledger';
import type { WalkedToolCall, WalkedToolResponse } from '../../../src/api/providers/history-walk';

const call = (name: string, partIndex: number, id?: string, thoughtSignature?: string): WalkedToolCall => ({
	name,
	args: { path: `${name}-${partIndex}` },
	partIndex,
	...(id !== undefined && { id }),
	...(thoughtSignature !== undefined && { thoughtSignature }),
});

const response = (name: string, partIndex: number, id?: string): WalkedToolResponse => ({
	name,
	response: { ok: `${name}-${partIndex}` },
	partIndex,
	...(id !== undefined && { id }),
});

const openAiLedger = () =>
	new ToolIdLedger({ mint: (name, seq) => `call_${name}_${seq}`, isValidId: (id) => SIMPLE_TOOL_ID_PATTERN.test(id) });

const anthropicLedger = () =>
	new ToolIdLedger({ mint: (_name, seq) => `toolu_${seq}`, isValidId: (id) => SIMPLE_TOOL_ID_PATTERN.test(id) });

describe('ToolIdLedger', () => {
	describe('declare (call ids)', () => {
		it('keeps a valid inbound id verbatim', () => {
			const ledger = openAiLedger();
			const { calls } = ledger.resolveEntry([call('read_file', 0, 'gemini-call-1')], []);
			expect(calls[0].id).toBe('gemini-call-1');
		});

		it('mints with the configured format when the id is missing', () => {
			const ledger = openAiLedger();
			const { calls } = ledger.resolveEntry([call('read_file', 0)], []);
			expect(calls[0].id).toBe('call_read_file_0');
			expect(anthropicLedger().resolveEntry([call('read_file', 0)], []).calls[0].id).toBe('toolu_0');
		});

		it('re-mints when the inbound id fails the validity predicate', () => {
			const ledger = anthropicLedger();
			const { calls } = ledger.resolveEntry([call('read_file', 0, 'bad id!')], []);
			expect(calls[0].id).toBe('toolu_0');
		});

		it('carries the thoughtSignature through to the resolved call', () => {
			const ledger = anthropicLedger();
			const { calls } = ledger.resolveEntry([call('read_file', 0, undefined, 'sig-1')], []);
			expect(calls[0].thoughtSignature).toBe('sig-1');
		});

		it('does not carry a thoughtSignature when none was present', () => {
			const ledger = openAiLedger();
			const { calls } = ledger.resolveEntry([call('read_file', 0)], []);
			expect('thoughtSignature' in calls[0]).toBe(false);
		});
	});

	describe('pairing (responses to calls)', () => {
		it('pairs two calls to the same tool with their respective responses in order', () => {
			const ledger = openAiLedger();
			const { calls, responses } = ledger.resolveEntry(
				[call('read_file', 0), call('read_file', 1)],
				[response('read_file', 2), response('read_file', 3)]
			);
			expect(responses[0].id).toBe(calls[0].id);
			expect(responses[1].id).toBe(calls[1].id);
			expect(responses[0].response).toEqual({ ok: 'read_file-2' });
		});

		it('pairs a response preceding its own call within one entry, in source-part order', () => {
			// Interleaved in part order: the response at index 0 resolves before
			// the call at index 1, exactly as Gemini's single-loop pairing did.
			const ledger = openAiLedger();
			const { calls, responses } = ledger.resolveEntry([call('read_file', 1)], [response('read_file', 0)]);
			expect(responses[0].id).toBeNull(); // minted-undeclared ids are gone; FIFO is empty
			expect(calls[0].id).toBe('call_read_file_0');
		});

		it('pairs a response that names a declared id, splicing it out of the FIFO', () => {
			const ledger = anthropicLedger();
			const { calls, responses } = ledger.resolveEntry(
				[call('read_file', 0, 'toolu_01'), call('read_file', 1)],
				[response('read_file', 2, 'toolu_01'), response('read_file', 3)]
			);
			expect(responses[0].id).toBe('toolu_01');
			// The named call is consumed, so the id-less response pairs with the next.
			expect(responses[1].id).toBe(calls[1].id);
		});

		it('treats a carried-but-undeclared response id as no id and pairs with the FIFO', () => {
			// The response carries an id the ledger never declared: pairing falls
			// back to the oldest unanswered call rather than trusting the id.
			const ledger = openAiLedger();
			const { calls, responses } = ledger.resolveEntry(
				[call('read_file', 0), call('read_file', 1)],
				[response('read_file', 2, 'call_undeclared')]
			);
			expect(responses[0].id).toBe(calls[0].id);
		});

		it('does not answer the same call twice with one id (undeclared ids fall back to FIFO)', () => {
			const ledger = openAiLedger();
			const { calls, responses } = ledger.resolveEntry(
				[call('read_file', 0)],
				[response('read_file', 1, 'gemini-call-1'), response('read_file', 2, 'gemini-call-1')]
			);
			expect(responses[0].id).toBe(calls[0].id);
			expect(responses[1].id).toBeNull();
		});

		it('does not answer a declared call twice with the same id', () => {
			// First response consumes the declared id out of the FIFO; the second
			// response carrying the same id must not re-match it — both APIs
			// reject two tool results referencing one tool call.
			const ledger = anthropicLedger();
			const { calls, responses } = ledger.resolveEntry(
				[call('read_file', 0, 'toolu_01')],
				[response('read_file', 1, 'toolu_01'), response('read_file', 2, 'toolu_01')]
			);
			expect(responses[0].id).toBe(calls[0].id);
			expect(responses[1].id).toBeNull();
		});
	});

	describe('orphaned responses (compaction)', () => {
		it('returns id null for a response whose call was trimmed away', () => {
			const ledger = openAiLedger();
			const { responses } = ledger.resolveEntry([], [response('tool1', 0)]);
			expect(responses[0].id).toBeNull();
		});

		it('reports no match rather than minting an undeclared id', () => {
			const ledger = openAiLedger();
			const { responses } = ledger.resolveEntry([], [response('tool1', 0)]);
			// Minting here would produce an id no assistant turn declared —
			// exactly what both APIs reject — so the ledger reports null.
			expect(responses[0].id).toBeNull();
		});

		it('returns null again for a second orphaned response', () => {
			const ledger = anthropicLedger();
			const { responses } = ledger.resolveEntry([], [response('tool1', 0), response('tool1', 1)]);
			expect(responses[0].id).toBeNull();
			expect(responses[1].id).toBeNull();
		});
	});

	describe('mixed history', () => {
		it('keeps ids independent per tool name across entries', () => {
			const ledger = openAiLedger();
			const first = ledger.resolveEntry([call('read_file', 0), call('write_file', 1)], []);
			const second = ledger.resolveEntry([], [response('read_file', 2), response('write_file', 3)]);
			expect(second.responses[0].id).toBe(first.calls[0].id);
			expect(second.responses[1].id).toBe(first.calls[1].id);
		});

		it('keeps the seq monotonic across re-minted ids and tool names', () => {
			const ledger = openAiLedger();
			const first = ledger.resolveEntry([call('read_file', 0, 'bad id!')], []);
			const second = ledger.resolveEntry([call('write_file', 1)], []);
			expect(first.calls[0].id).toBe('call_read_file_0');
			expect(second.calls[0].id).toBe('call_write_file_1');
		});
	});
});
