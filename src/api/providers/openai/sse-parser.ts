export interface SseChunk {
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
	}>;
}

export function parseSseStream(streamText: string): SseChunk[] {
	const chunks: SseChunk[] = [];
	const lines = streamText.split('\n');

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data: ')) continue;

		const data = trimmed.slice(6);
		if (data === '[DONE]') continue;

		try {
			const parsed = JSON.parse(data);
			if (parsed.choices) {
				chunks.push(parsed);
			}
		} catch {
			// Skip malformed lines
		}
	}

	return chunks;
}
