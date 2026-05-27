import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../../../../src/api/providers/openai/sse-parser';

describe('parseSseStream', () => {
	it('parses text chunks', () => {
		const stream = `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n`;
		const chunks = parseSseStream(stream);
		expect(chunks).toHaveLength(2);
		expect(chunks[0].choices[0].delta.content).toBe('Hello');
		expect(chunks[1].choices[0].delta.content).toBe(' world');
	});

	it('ignores empty lines and comments', () => {
		const stream = `: comment\n\ndata: {"choices":[{"delta":{"content":"x"}}]}\n\n\n\ndata: [DONE]\n\n`;
		const chunks = parseSseStream(stream);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].choices[0].delta.content).toBe('x');
	});

	it('parses tool call chunks', () => {
		const stream = `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file"}}]}}]}\n\n`;
		const chunks = parseSseStream(stream);
		expect(chunks[0].choices[0].delta.tool_calls).toHaveLength(1);
		expect(chunks[0].choices[0].delta.tool_calls[0].function.name).toBe('read_file');
	});

	it('handles malformed json gracefully', () => {
		const stream = `data: not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n`;
		const chunks = parseSseStream(stream);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].choices[0].delta.content).toBe('ok');
	});
});
