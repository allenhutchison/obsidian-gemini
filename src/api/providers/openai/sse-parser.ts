export interface SseChunk {
	id?: string;
	created?: number;
	choices: Array<{
		delta: {
			content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
	}>;
}

export function parseSseStream(streamText: string): SseChunk[] {
	const chunks: SseChunk[] = [];
	const lines = streamText.split('\n');

	const DATA_PREFIX = 'data: ';

	for (const line of lines) {
		const trimmed = line.trimStart();
		if (!trimmed.startsWith(DATA_PREFIX)) continue;

		const data = trimmed.slice(DATA_PREFIX.length);
		if (data === '[DONE]') continue;

		try {
			const parsed = JSON.parse(data);
			if (parsed.choices) {
				chunks.push(parsed);
			}
		} catch {
			// Intentionally skip malformed lines — stream may contain non-JSON comments
		}
	}

	return chunks;
}
