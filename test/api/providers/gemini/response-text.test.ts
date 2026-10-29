import { describe, test, expect } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { collectResponseText } from '../../../../src/api/providers/gemini/response-text';

const withParts = (parts: Array<{ text?: string; thought?: boolean }>) =>
	({ candidates: [{ content: { parts } }] }) as unknown as GenerateContentResponse;

describe('collectResponseText', () => {
	test('returns the text of a parts-only response', () => {
		expect(collectResponseText(withParts([{ text: 'Hello world' }]))).toBe('Hello world');
	});

	test('concatenates multiple text parts in order', () => {
		expect(collectResponseText(withParts([{ text: 'Hello ' }, {}, { text: 'world' }]))).toBe('Hello world');
	});

	test('returns an empty string for an empty parts array', () => {
		expect(collectResponseText(withParts([]))).toBe('');
	});

	test('returns an empty string when there are no candidates, without consulting result.text', () => {
		const result = { text: 'should not be used' } as unknown as GenerateContentResponse;
		expect(collectResponseText(result)).toBe('');
		expect(collectResponseText({} as GenerateContentResponse)).toBe('');
	});

	test('excludes thought parts', () => {
		const result = withParts([
			{ text: 'Let me think about this...', thought: true },
			{ text: 'The answer ' },
			{ text: 'more reasoning', thought: true },
			{ text: 'is 42.' },
		]);
		expect(collectResponseText(result)).toBe('The answer is 42.');
	});
});
