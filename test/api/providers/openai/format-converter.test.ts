import { describe, it, expect } from 'vitest';
import {
	convertContentToMessages,
	convertMessageToContent,
} from '../../../../src/api/providers/openai/format-converter';
import { Content } from '@google/genai';

describe('convertContentToMessages', () => {
	it('converts user text message', () => {
		const content: Content = { role: 'user', parts: [{ text: 'Hello' }] };
		const result = convertContentToMessages([content]);
		expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
	});

	it('converts model text message to assistant', () => {
		const content: Content = { role: 'model', parts: [{ text: 'Hi there' }] };
		const result = convertContentToMessages([content]);
		expect(result).toEqual([{ role: 'assistant', content: 'Hi there' }]);
	});

	it('converts inline image to image_url', () => {
		const content: Content = {
			role: 'user',
			parts: [{ inlineData: { mimeType: 'image/png', data: 'base64data' } }],
		};
		const result = convertContentToMessages([content]);
		expect(result).toEqual([
			{
				role: 'user',
				content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,base64data' } }],
			},
		]);
	});

	it('converts functionCall to tool_calls', () => {
		const content: Content = {
			role: 'model',
			parts: [{ functionCall: { name: 'read_file', args: { path: 'test.md' } } }],
		};
		const result = convertContentToMessages([content]);
		expect(result[0].role).toBe('assistant');
		expect(result[0].tool_calls).toHaveLength(1);
		expect(result[0].tool_calls[0].function.name).toBe('read_file');
	});

	it('converts functionResponse to tool message', () => {
		const content: Content = {
			role: 'user',
			parts: [{ functionResponse: { name: 'read_file', response: { content: 'file data' } } }],
		};
		const result = convertContentToMessages([content]);
		expect(result[0].role).toBe('tool');
		expect(result[0].tool_call_id).toBeDefined();
		expect(result[0].content).toContain('file data');
	});
});
