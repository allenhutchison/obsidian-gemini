/**
 * Integration test for OpenAI-compatible client.
 *
 * Usage:
 *   OPENAI_BASE_URL=https://api.example.com/v1 \\
 *   OPENAI_API_KEY=your-key \\
 *   OPENAI_MODEL=gpt-4 \\
 *   node test-scripts/test-openai-client.mjs
 */

const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4';

if (!apiKey) {
	console.error('Error: OPENAI_API_KEY environment variable required');
	process.exit(1);
}

async function testChat() {
	console.log('Testing non-streaming chat...');
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [{ role: 'user', content: 'Say "Hello from OpenAI test" and nothing else.' }],
		}),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${await response.text()}`);
	}

	const data = await response.json();
	console.log('Response:', data.choices[0].message.content);
	console.log('Usage:', data.usage);
}

async function testStreaming() {
	console.log('\nTesting streaming chat...');
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			Accept: 'text/event-stream',
		},
		body: JSON.stringify({
			model,
			messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
			stream: true,
		}),
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${await response.text()}`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith('data: ')) continue;
			const data = trimmed.slice(6);
			if (data === '[DONE]') continue;

			try {
				const parsed = JSON.parse(data);
				const content = parsed.choices?.[0]?.delta?.content;
				if (content) process.stdout.write(content);
			} catch {
				// skip malformed
			}
		}
	}
	console.log('\nStreaming complete.');
}

async function testModels() {
	console.log('\nTesting /v1/models...');
	const response = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${await response.text()}`);
	}

	const data = await response.json();
	console.log(`Found ${data.data.length} models:`);
	data.data.slice(0, 10).forEach((m) => console.log(`  - ${m.id}`));
}

async function main() {
	try {
		await testChat();
		await testStreaming();
		await testModels();
		console.log('\n✅ All tests passed!');
	} catch (error) {
		console.error('\n❌ Test failed:', error.message);
		process.exit(1);
	}
}

main();
