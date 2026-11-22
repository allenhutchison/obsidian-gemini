import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { OllamaClient } from '../../../../src/api/providers/ollama/client';

// End-to-end over the real ollama-js browser client: only Obsidian's
// `requestUrl` is faked. ollama.com rejects the renderer's `fetch` (no CORS,
// #1785), so the cloud route must go through `requestUrl`, which hands back the
// whole NDJSON body at once. These tests prove that a buffered body still
// settles both the streaming and the non-streaming paths.
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, requestUrl: vi.fn() };
});

const plugin = {
	logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
	settings: { userName: 'Tester', ragIndexing: { enabled: false } },
	agentsMemory: { read: vi.fn().mockResolvedValue('') },
	skillManager: { getSkillSummaries: vi.fn().mockResolvedValue([]) },
	ragIndexing: null,
} as any;

function ndjson(lines: object[]): string {
	return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function respond(text: string, status = 200) {
	const buffer = new TextEncoder().encode(text).buffer;
	(requestUrl as unknown as Mock).mockResolvedValue({
		status,
		headers: { 'content-type': 'application/x-ndjson' },
		arrayBuffer: buffer,
		text,
	});
}

describe('Ollama Cloud over requestUrl (#1785)', () => {
	const fetchSpy = vi.fn();

	beforeEach(() => {
		(requestUrl as unknown as Mock).mockReset();
		fetchSpy.mockReset();
		vi.stubGlobal('fetch', fetchSpy);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('streams a cloud chat reply from a buffered NDJSON body without touching window.fetch', async () => {
		respond(
			ndjson([
				{ model: 'gpt-oss:20b', message: { role: 'assistant', content: 'Hel' }, done: false },
				{ model: 'gpt-oss:20b', message: { role: 'assistant', content: 'lo' }, done: false },
				{
					model: 'gpt-oss:20b',
					message: { role: 'assistant', content: '' },
					done: true,
					prompt_eval_count: 7,
					eval_count: 2,
				},
			])
		);
		const client = new OllamaClient(
			{ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:20b' },
			undefined,
			plugin
		);
		const chunks: string[] = [];
		const stream = client.generateStreamingResponse(
			{ kind: 'extended', userMessage: 'hi', conversationHistory: [], model: 'cloud::gpt-oss:20b' } as any,
			(c) => {
				if (c.text) chunks.push(c.text);
			}
		);
		const result = await stream.complete;

		expect(result.markdown).toBe('Hello');
		expect(chunks).toEqual(['Hel', 'lo']);
		expect(result.usageMetadata).toEqual({ promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 });
		expect(fetchSpy).not.toHaveBeenCalled();
		const [param] = (requestUrl as unknown as Mock).mock.calls[0];
		expect(new URL(param.url).href).toBe('https://ollama.com/api/chat');
		expect(param.method).toBe('POST');
		expect(param.headers.Authorization).toBe('Bearer secret');
		expect(JSON.parse(param.body).model).toBe('gpt-oss:20b');
	});

	it('settles a cancelled cloud turn at once instead of waiting for the buffered reply', async () => {
		let release!: (value: unknown) => void;
		(requestUrl as unknown as Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
		const client = new OllamaClient(
			{ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:20b' },
			undefined,
			plugin
		);
		const onChunk = vi.fn();
		const stream = client.generateStreamingResponse(
			{ kind: 'extended', userMessage: 'hi', conversationHistory: [], model: 'cloud::gpt-oss:20b' } as any,
			onChunk
		);
		await vi.waitFor(() => expect(requestUrl).toHaveBeenCalled());

		stream.cancel();
		// `complete` settles while requestUrl is still outstanding, so the UI's
		// cleanup for this turn runs now, not after a newer turn has started.
		const result = await stream.complete;
		expect(result.markdown).toBe('');

		// The late reply is dropped: no chunks reach the cancelled turn.
		const text = ndjson([{ model: 'gpt-oss:20b', message: { role: 'assistant', content: 'late' }, done: true }]);
		release({ status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(text).buffer, text });
		await new Promise((r) => window.setTimeout(r, 0));
		expect(onChunk).not.toHaveBeenCalled();
	});

	it('releases each late cloud reply after repeated cancels, so the SDK client keeps none', async () => {
		const releases: Array<(value: unknown) => void> = [];
		(requestUrl as unknown as Mock).mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
		const client = new OllamaClient(
			{ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:20b' },
			undefined,
			plugin
		);
		for (let i = 0; i < 3; i++) {
			const stream = client.generateStreamingResponse(
				{ kind: 'extended', userMessage: `hi ${i}`, conversationHistory: [] } as any,
				() => {}
			);
			await vi.waitFor(() => expect(releases).toHaveLength(i + 1));
			stream.cancel();
			await stream.complete;
		}
		const text = ndjson([{ model: 'gpt-oss:20b', message: { role: 'assistant', content: 'late' }, done: true }]);
		for (const release of releases) {
			release({ status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(text).buffer, text });
		}
		// Let every late reply reach the SDK (it registers each stream) and be drained.
		await new Promise((r) => window.setTimeout(r, 20));
		const sdk = (client as any).clients.get('https://ollama.com');
		expect(sdk.ongoingStreamedRequests).toHaveLength(0);
	});

	it('returns tool calls from a buffered cloud reply', async () => {
		respond(
			ndjson([
				{
					model: 'gpt-oss:20b',
					message: {
						role: 'assistant',
						content: '',
						tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.md' } } }],
					},
					done: true,
				},
			])
		);
		const client = new OllamaClient({ baseUrl: 'https://ollama.com', apiKey: 'secret' }, undefined, plugin);
		const stream = client.generateStreamingResponse(
			{
				kind: 'extended',
				userMessage: 'read a.md',
				conversationHistory: [],
				model: 'cloud::gpt-oss:20b',
				availableTools: [{ name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } }],
			} as any,
			() => {}
		);
		const result = await stream.complete;
		expect(result.toolCalls).toEqual([{ name: 'read_file', arguments: { path: 'a.md' } }]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('answers a non-streaming cloud request', async () => {
		respond(JSON.stringify({ model: 'gpt-oss:20b', response: 'summary', done: true }));
		const client = new OllamaClient(
			{ baseUrl: 'http://localhost:11434', apiKey: 'secret', model: 'cloud::gpt-oss:20b' },
			undefined,
			plugin
		);
		const result = await client.generateModelResponse({ prompt: 'summarise' } as any);
		expect(result.markdown).toBe('summary');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('surfaces a cloud HTTP error instead of hanging', async () => {
		respond(JSON.stringify({ error: 'unauthorized' }), 401);
		const client = new OllamaClient(
			{ baseUrl: 'http://localhost:11434', apiKey: 'bad', model: 'cloud::gpt-oss:20b' },
			undefined,
			plugin
		);
		await expect(client.generateModelResponse({ prompt: 'x' } as any)).rejects.toThrow(/unauthorized/);
	});
});
