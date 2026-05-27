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

	it('converts system text message', () => {
		const content: Content = { role: 'system', parts: [{ text: 'Be helpful' }] };
		const result = convertContentToMessages([content]);
		expect(result).toEqual([{ role: 'system', content: 'Be helpful' }]);
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

	it('converts mixed text and image parts', () => {
		const content: Content = {
			role: 'user',
			parts: [
				{ text: 'Look at this' },
				{ inlineData: { mimeType: 'image/jpeg', data: 'imgdata' } },
			],
		};
		const result = convertContentToMessages([content]);
		expect(result).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Look at this' },
					{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,imgdata' } },
				],
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
		expect(result[0].tool_calls![0].function.name).toBe('read_file');
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

describe('convertMessageToContent', () => {
	it('converts assistant text message', () => {
		const message = { role: 'assistant' as const, content: 'Hello back' };
		const result = convertMessageToContent(message);
		expect(result).toEqual({ role: 'model', parts: [{ text: 'Hello back' }] });
	});

	it('converts system role message', () => {
		const message = { role: 'system' as const, content: 'Be helpful' };
		const result = convertMessageToContent(message);
		expect(result).toEqual({ role: 'system', parts: [{ text: 'Be helpful' }] });
	});

	it('converts tool role message to functionResponse', () => {
		const message = { role: 'tool' as const, tool_call_id: 'call_123', content: 'tool result' };
		const result = convertMessageToContent(message);
		expect(result.role).toBe('user');
		expect(result.parts).toHaveLength(1);
		expect(result.parts[0]).toMatchObject({
			functionResponse: {
				name: 'call_123',
				response: 'tool result',
				id: 'call_123',
			},
		});
	});

	it('converts assistant message with tool_calls', () => {
		const message = {
			role: 'assistant' as const,
			content: '',
			tool_calls: [
				{
					id: 'call_abc',
					type: 'function' as const,
					function: { name: 'read_file', arguments: '{"path":"test.md"}' },
				},
			],
		};
		const result = convertMessageToContent(message);
		expect(result.role).toBe('model');
		expect(result.parts).toHaveLength(1);
		expect(result.parts[0]).toMatchObject({
			functionCall: {
				name: 'read_file',
				args: { path: 'test.md' },
				id: 'call_abc',
			},
		});
	});
});
