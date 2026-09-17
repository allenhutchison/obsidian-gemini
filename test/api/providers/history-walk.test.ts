import { walkHistoryEntry } from '../../../src/api/providers/history-walk';

describe('walkHistoryEntry', () => {
	describe('null returns', () => {
		it('returns null for a non-object entry', () => {
			expect(walkHistoryEntry(null, 'Ollama')).toBeNull();
			expect(walkHistoryEntry(undefined, 'Ollama')).toBeNull();
			expect(walkHistoryEntry('hello', 'Ollama')).toBeNull();
			expect(walkHistoryEntry(42, 'Ollama')).toBeNull();
		});

		it('returns null for an object with no role', () => {
			expect(walkHistoryEntry({ parts: [{ text: 'orphan' }] }, 'Ollama')).toBeNull();
		});

		it('returns null when a Content decodes to no parts at all', () => {
			expect(walkHistoryEntry({ role: 'user', parts: [] }, 'Ollama')).toBeNull();
			// Parts the ladder recognizes none of.
			expect(walkHistoryEntry({ role: 'user', parts: [{ unknownKind: true }] }, 'Ollama')).toBeNull();
		});

		it('returns null for a legacy entry whose text is missing or blank', () => {
			expect(walkHistoryEntry({ role: 'user' }, 'Ollama')).toBeNull();
			expect(walkHistoryEntry({ role: 'user', text: '   ' }, 'Ollama')).toBeNull();
			expect(walkHistoryEntry({ role: 'user', text: 42 }, 'Ollama')).toBeNull();
		});
	});

	describe('role mapping', () => {
		it("maps 'model' to assistant, 'system' to system, and anything else to user", () => {
			expect(walkHistoryEntry({ role: 'model', parts: [{ text: 'a' }] }, 'Ollama')?.role).toBe('assistant');
			expect(walkHistoryEntry({ role: 'system', parts: [{ text: 'a' }] }, 'Ollama')?.role).toBe('system');
			expect(walkHistoryEntry({ role: 'user', parts: [{ text: 'a' }] }, 'Ollama')?.role).toBe('user');
			expect(walkHistoryEntry({ role: 'tool', parts: [{ text: 'a' }] }, 'Ollama')?.role).toBe('user');
		});
	});

	describe('text joining', () => {
		it('joins assistant text chunks with a single newline and trims', () => {
			const walked = walkHistoryEntry({ role: 'model', parts: [{ text: ' one ' }, { text: 'two ' }] }, 'Ollama');
			expect(walked?.text).toBe('one \ntwo');
			expect(walked?.hasText).toBe(true);
		});

		it('joins non-assistant text chunks with a blank line and trims', () => {
			const walked = walkHistoryEntry({ role: 'user', parts: [{ text: ' one ' }, { text: 'two ' }] }, 'Ollama');
			expect(walked?.text).toBe('one \n\ntwo');
		});

		it('reports hasText for a blank text part even though the joined text is empty', () => {
			// Both clients gate emission on the presence of a text part, not on
			// non-empty text — an empty assistant turn still emits a message.
			const walked = walkHistoryEntry({ role: 'model', parts: [{ text: '' }] }, 'Ollama');
			expect(walked).not.toBeNull();
			expect(walked?.text).toBe('');
			expect(walked?.hasText).toBe(true);
		});
	});

	describe('part classification ladder', () => {
		it('collects image inlineData as InlineDataPart', () => {
			const walked = walkHistoryEntry(
				{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
				'Ollama'
			);
			expect(walked?.images).toEqual([{ mimeType: 'image/png', base64: 'AAAA' }]);
			expect(walked?.hasText).toBe(false);
		});

		it('throws for an image inlineData part carrying no data', () => {
			// Pre-existing behaviour, preserved verbatim from both clients: the
			// image branch requires `data`, so a data-less image part falls
			// through to the unsupported-mime throw even though its mime is an
			// image. Asserted rather than corrected — see #1373's out-of-scope
			// note on latent oddities.
			expect(() =>
				walkHistoryEntry({ role: 'user', parts: [{ inlineData: { mimeType: 'image/png' } }] }, 'Ollama')
			).toThrow(/Ollama only supports image attachments/);
		});

		it('throws a provider-named error for a non-image inlineData mime', () => {
			expect(() =>
				walkHistoryEntry(
					{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'x' } }] },
					'Ollama'
				)
			).toThrow(/Ollama only supports image attachments; conversation history contains application\/pdf/);

			expect(() =>
				walkHistoryEntry({ role: 'user', parts: [{ inlineData: { mimeType: 'audio/mp3', data: 'x' } }] }, 'OpenAI')
			).toThrow(/OpenAI only supports image attachments; conversation history contains audio\/mp3/);
		});

		it('collects PDFs into documents only when the caller accepts them', () => {
			const entry = {
				role: 'user',
				parts: [
					{ inlineData: { mimeType: 'application/pdf', data: 'PDF' } },
					{ inlineData: { mimeType: 'image/png', data: 'IMG' } },
				],
			};
			const walked = walkHistoryEntry(entry, 'Anthropic', { acceptsPdf: true });
			expect(walked?.documents).toEqual([{ mimeType: 'application/pdf', base64: 'PDF' }]);
			expect(walked?.images).toEqual([{ mimeType: 'image/png', base64: 'IMG' }]);

			expect(() =>
				walkHistoryEntry({ role: 'user', parts: [{ inlineData: { mimeType: 'video/mp4', data: 'x' } }] }, 'Anthropic', {
					acceptsPdf: true,
				})
			).toThrow(/Anthropic only supports image and PDF attachments; conversation history contains video\/mp4/);
		});

		it("surfaces a functionCall part's sibling thoughtSignature", () => {
			const walked = walkHistoryEntry(
				{
					role: 'model',
					parts: [{ functionCall: { name: 'a' }, thoughtSignature: 'sig' }, { functionCall: { name: 'b' } }],
				},
				'Anthropic'
			);
			expect(walked?.toolCalls[0].thoughtSignature).toBe('sig');
			expect(walked?.toolCalls[1]).not.toHaveProperty('thoughtSignature');
		});

		it('collects functionCall and functionResponse parts with their source index', () => {
			const walked = walkHistoryEntry(
				{
					role: 'model',
					parts: [
						{ text: 'calling' },
						{ functionCall: { name: 'read_file', args: { path: 'a.md' } } },
						{ functionResponse: { name: 'read_file', response: { content: 'data' }, id: 'gemini-1' } },
					],
				},
				'OpenAI'
			);
			expect(walked?.toolCalls).toEqual([{ name: 'read_file', args: { path: 'a.md' }, id: undefined, partIndex: 1 }]);
			expect(walked?.toolResponses).toEqual([
				{ name: 'read_file', response: { content: 'data' }, id: 'gemini-1', partIndex: 2 },
			]);
		});

		it('defaults missing functionCall args to an empty object', () => {
			const walked = walkHistoryEntry({ role: 'model', parts: [{ functionCall: { name: 'ping' } }] }, 'OpenAI');
			expect(walked?.toolCalls[0].args).toEqual({});
		});

		it('surfaces functionCall ids verbatim and never mints one', () => {
			const walked = walkHistoryEntry(
				{ role: 'model', parts: [{ functionCall: { name: 'read_file', id: 'gemini-call-1' } }] },
				'OpenAI'
			);
			expect(walked?.toolCalls[0].id).toBe('gemini-call-1');
		});

		it('decodes text, image, call and response together in one entry', () => {
			const walked = walkHistoryEntry(
				{
					role: 'user',
					parts: [
						{ text: 'look' },
						{ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } },
						{ functionCall: { name: 'search', args: {} } },
						{ functionResponse: { name: 'search', response: 'hit' } },
					],
				},
				'OpenAI'
			);
			expect(walked?.role).toBe('user');
			expect(walked?.text).toBe('look');
			expect(walked?.images).toHaveLength(1);
			expect(walked?.toolCalls).toHaveLength(1);
			expect(walked?.toolResponses).toHaveLength(1);
		});
	});

	describe('legacy entry tail', () => {
		it('reads the legacy `text` field', () => {
			expect(walkHistoryEntry({ role: 'user', text: 'hey' }, 'Ollama')).toEqual({
				role: 'user',
				text: 'hey',
				hasText: true,
				images: [],
				documents: [],
				toolCalls: [],
				toolResponses: [],
			});
		});

		it('reads the legacy `message` field when `text` is absent', () => {
			expect(walkHistoryEntry({ role: 'user', message: 'hey' }, 'Ollama')?.text).toBe('hey');
		});

		it("maps both 'model' and 'assistant' to the assistant role", () => {
			expect(walkHistoryEntry({ role: 'model', text: 'a' }, 'Ollama')?.role).toBe('assistant');
			expect(walkHistoryEntry({ role: 'assistant', text: 'a' }, 'Ollama')?.role).toBe('assistant');
			expect(walkHistoryEntry({ role: 'system', text: 'a' }, 'Ollama')?.role).toBe('user');
		});

		it('returns legacy text un-trimmed', () => {
			// The blank check trims, but the stored text has always been emitted
			// verbatim — preserve that rather than silently reformatting history.
			expect(walkHistoryEntry({ role: 'user', text: '  hey  ' }, 'Ollama')?.text).toBe('  hey  ');
		});

		it('prefers the Content branch when an entry has both parts and legacy text', () => {
			const walked = walkHistoryEntry({ role: 'user', text: 'legacy', parts: [{ text: 'content' }] }, 'Ollama');
			expect(walked?.text).toBe('content');
		});
	});
});
