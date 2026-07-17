import { describe, test, expect } from 'vitest';
import {
	InteractionStreamAccumulator,
	extractImageDataFromInteraction,
	extractModelResponseFromInteraction,
	contentToSteps,
	buildUserInputStep,
} from '../../../../src/api/providers/gemini/interactions-mapper';
import type { Content } from '@google/genai';

/** Feed a list of events through the accumulator, collecting emitted chunks. */
function run(events: Array<Record<string, unknown>>) {
	const acc = new InteractionStreamAccumulator();
	const chunks: Array<{ text: string; thought?: string }> = [];
	for (const event of events) {
		const chunk = acc.handleEvent(event);
		if (chunk) chunks.push(chunk);
	}
	return { response: acc.finalize(), chunks };
}

describe('InteractionStreamAccumulator', () => {
	test('accumulates streamed text into markdown and emits text chunks', () => {
		const { response, chunks } = run([
			{ event_type: 'interaction.created', interaction: { id: 'int_1' } },
			{ event_type: 'step.start', index: 0, step: { type: 'model_output' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Hello' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: ', world' } },
			{ event_type: 'step.stop', index: 0 },
			{
				event_type: 'interaction.completed',
				interaction: { usage: { total_input_tokens: 4, total_output_tokens: 2, total_tokens: 6 } },
			},
		]);

		expect(chunks).toEqual([{ text: 'Hello' }, { text: ', world' }]);
		expect(response.markdown).toBe('Hello, world');
		expect(response.usageMetadata).toEqual({
			promptTokenCount: 4,
			candidatesTokenCount: 2,
			totalTokenCount: 6,
			cachedContentTokenCount: undefined,
		});
		expect(response.toolCalls).toBeUndefined();
	});

	test('surfaces thought_summary deltas as thought chunks and accumulates thoughts', () => {
		const { response, chunks } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'thought' } },
			{
				event_type: 'step.delta',
				index: 0,
				delta: { type: 'thought_summary', content: { type: 'text', text: 'Hmm ' } },
			},
			{
				event_type: 'step.delta',
				index: 0,
				delta: { type: 'thought_summary', content: { type: 'text', text: 'let me think' } },
			},
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(chunks).toEqual([
			{ text: '', thought: 'Hmm ' },
			{ text: '', thought: 'let me think' },
		]);
		expect(response.thoughts).toBe('Hmm let me think');
	});

	test('assembles a tool call from step.start + multi-fragment arguments_delta', () => {
		const { response, chunks } = run([
			{
				event_type: 'step.start',
				index: 0,
				step: { type: 'function_call', id: 'c1', name: 'read_file', signature: 'sig1' },
			},
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"path":' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '"foo.md"}' } },
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(chunks).toEqual([]); // tool-call assembly emits nothing to the UI text stream
		expect(response.toolCalls).toEqual([
			{ name: 'read_file', arguments: { path: 'foo.md' }, id: 'c1', thoughtSignature: 'sig1' },
		]);
	});

	test('falls back to seed arguments when no arguments_delta arrives', () => {
		const { response } = run([
			{
				event_type: 'step.start',
				index: 0,
				step: { type: 'function_call', id: 'c2', name: 'list_files', arguments: { dir: '.' } },
			},
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(response.toolCalls).toEqual([
			{ name: 'list_files', arguments: { dir: '.' }, id: 'c2', thoughtSignature: undefined },
		]);
	});

	test('keeps seed/empty args when streamed fragments are not valid JSON', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'c3', name: 'x' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{bad json' } },
			{ event_type: 'step.stop', index: 0 },
		]);
		expect(response.toolCalls).toEqual([{ name: 'x', arguments: {}, id: 'c3', thoughtSignature: undefined }]);
	});

	test('interleaves text and a tool call, and flushes an unstopped step on finalize', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'model_output' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Let me look' } },
			{ event_type: 'step.stop', index: 0 },
			{
				event_type: 'step.start',
				index: 1,
				step: { type: 'function_call', id: 'c9', name: 'search', arguments: { q: 'x' } },
			},
			// no step.stop for index 1 — finalize() must still flush it
		]);

		expect(response.markdown).toBe('Let me look');
		expect(response.toolCalls).toEqual([
			{ name: 'search', arguments: { q: 'x' }, id: 'c9', thoughtSignature: undefined },
		]);
	});

	test('parallel tool calls keyed by distinct step indexes do not cross-contaminate args', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'a', name: 'read_file' } },
			{ event_type: 'step.start', index: 1, step: { type: 'function_call', id: 'b', name: 'list_files' } },
			{ event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: '{"dir":"."}' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"path":"x"}' } },
			{ event_type: 'step.stop', index: 0 },
			{ event_type: 'step.stop', index: 1 },
		]);

		expect(response.toolCalls).toEqual([
			{ name: 'read_file', arguments: { path: 'x' }, id: 'a', thoughtSignature: undefined },
			{ name: 'list_files', arguments: { dir: '.' }, id: 'b', thoughtSignature: undefined },
		]);
	});
});

describe('grounding sources (rendered)', () => {
	test('non-streaming: url_citation annotations on model_output → deduped sources block', () => {
		const response = extractModelResponseFromInteraction({
			output_text: 'Paris is the capital of France.',
			steps: [
				{
					type: 'model_output',
					content: [
						{
							type: 'text',
							text: 'Paris is the capital of France.',
							annotations: [
								{ type: 'url_citation', url: 'https://a.example/paris', title: 'Paris' },
								{ type: 'url_citation', url: 'https://b.example/france', title: 'France' },
								{ type: 'url_citation', url: 'https://a.example/paris', title: 'dup (ignored)' },
							],
						},
					],
				},
			],
		});

		expect(response.rendered).toContain('<div class="search-grounding">');
		expect(response.rendered).toContain(
			'<a href="https://a.example/paris" target="_blank" rel="noopener noreferrer">Paris</a>'
		);
		expect(response.rendered).toContain(
			'<a href="https://b.example/france" target="_blank" rel="noopener noreferrer">France</a>'
		);
		// Deduped by URL — only two <li> entries.
		expect(response.rendered.match(/<li>/g)).toHaveLength(2);
	});

	test('non-streaming: no annotations → empty rendered', () => {
		const response = extractModelResponseFromInteraction({
			output_text: 'hi',
			steps: [{ type: 'model_output', content: [{ type: 'text', text: 'hi' }] }],
		});
		expect(response.rendered).toBe('');
	});

	test('streaming: text_annotation_delta events accumulate into the sources block', () => {
		const { response } = run([
			{ event_type: 'step.start', index: 0, step: { type: 'model_output' } },
			{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Answer' } },
			{
				event_type: 'step.delta',
				index: 0,
				delta: {
					type: 'text_annotation_delta',
					annotations: [{ type: 'url_citation', url: 'https://src.example', title: 'Source' }],
				},
			},
			{ event_type: 'step.stop', index: 0 },
		]);

		expect(response.markdown).toBe('Answer');
		expect(response.rendered).toContain(
			'<a href="https://src.example" target="_blank" rel="noopener noreferrer">Source</a>'
		);
	});

	test('falls back to the URL when a citation has no title', () => {
		const response = extractModelResponseFromInteraction({
			steps: [
				{
					type: 'model_output',
					content: [
						{ type: 'text', text: 'x', annotations: [{ type: 'url_citation', url: 'https://no-title.example' }] },
					],
				},
			],
		});
		expect(response.rendered).toContain(
			'<a href="https://no-title.example" target="_blank" rel="noopener noreferrer">https://no-title.example</a>'
		);
	});

	test('sanitizes malicious citation url/title (no HTML injection, no javascript: href)', () => {
		const response = extractModelResponseFromInteraction({
			steps: [
				{
					type: 'model_output',
					content: [
						{
							type: 'text',
							text: 'x',
							annotations: [
								{ type: 'url_citation', url: 'javascript:alert(1)', title: '<img src=x onerror=alert(1)>' },
							],
						},
					],
				},
			],
		});

		// Disallowed scheme is neutralized to '#'.
		expect(response.rendered).toContain('href="#"');
		expect(response.rendered).not.toContain('javascript:');
		// Title is HTML-escaped, so no raw tag survives.
		expect(response.rendered).not.toContain('<img');
		expect(response.rendered).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(response.rendered).toContain('rel="noopener noreferrer"');
	});
});

describe('inline attachments (all media classes)', () => {
	const att = (mimeType: string) => ({ base64: 'AAAA', mimeType });

	test('buildUserInputStep classifies image/audio/video/pdf as first-class media', () => {
		const step = buildUserInputStep('look', undefined, [
			att('image/png'),
			att('audio/mp3'),
			att('video/mp4'),
			att('application/pdf'),
		]);
		expect(step?.content).toEqual([
			{ type: 'text', text: 'look' },
			{ type: 'image', data: 'AAAA', mime_type: 'image/png' },
			{ type: 'audio', data: 'AAAA', mime_type: 'audio/mp3' },
			{ type: 'video', data: 'AAAA', mime_type: 'video/mp4' },
			{ type: 'document', data: 'AAAA', mime_type: 'application/pdf' },
		]);
	});

	test('unsupported mime degrades to a text note rather than dropping silently', () => {
		const step = buildUserInputStep(undefined, undefined, [att('application/zip')]);
		expect(step?.content).toEqual([{ type: 'text', text: '[attachment: application/zip]' }]);
	});

	test('contentToSteps maps a history inlineData PDF part to a document content item', () => {
		const content: Content = {
			role: 'user',
			parts: [{ inlineData: { mimeType: 'application/pdf', data: 'BBBB' } }],
		};
		expect(contentToSteps(content)).toEqual([
			{ type: 'user_input', content: [{ type: 'document', data: 'BBBB', mime_type: 'application/pdf' }] },
		]);
	});
});

describe('extractImageDataFromInteraction', () => {
	test('prefers the output_image convenience property', () => {
		const interaction = {
			output_image: { data: 'BASE64_CONVENIENCE', mime_type: 'image/png' },
			steps: [{ type: 'model_output', content: [{ type: 'image', data: 'BASE64_STEP' }] }],
		};
		expect(extractImageDataFromInteraction(interaction)).toBe('BASE64_CONVENIENCE');
	});

	test('falls back to scanning model_output steps for image content', () => {
		const interaction = {
			steps: [
				{ type: 'thought', summary: [{ type: 'text', text: 'planning' }] },
				{
					type: 'model_output',
					content: [
						{ type: 'text', text: 'Here is your image:' },
						{ type: 'image', data: 'BASE64_STEP', mime_type: 'image/png' },
					],
				},
			],
		};
		expect(extractImageDataFromInteraction(interaction)).toBe('BASE64_STEP');
	});

	test('returns the last image when the output interleaves several', () => {
		const interaction = {
			steps: [
				{ type: 'model_output', content: [{ type: 'image', data: 'FIRST' }] },
				{ type: 'model_output', content: [{ type: 'image', data: 'LAST' }] },
			],
		};
		expect(extractImageDataFromInteraction(interaction)).toBe('LAST');
	});

	test('returns null for a text-only response', () => {
		const interaction = {
			output_text: 'Sorry, no image.',
			steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Sorry, no image.' }] }],
		};
		expect(extractImageDataFromInteraction(interaction)).toBeNull();
	});

	test('returns null when steps are missing entirely', () => {
		expect(extractImageDataFromInteraction({})).toBeNull();
	});
});
