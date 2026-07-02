import { getApiKeyErrorMessage } from '../../src/utils/init-error-message';

describe('getApiKeyErrorMessage', () => {
	test('a captured init error wins for the Gemini provider', () => {
		const message = getApiKeyErrorMessage({
			provider: 'gemini',
			lastInitError: 'model not found',
			apiKeySecretName: 'my-key',
			ollamaBaseUrl: 'http://localhost:11434',
		});
		expect(message).toContain('model not found');
		expect(message).toContain('Open Settings');
	});

	test('a captured init error wins for the Ollama provider', () => {
		const message = getApiKeyErrorMessage({
			provider: 'ollama',
			lastInitError: 'model not pulled',
			apiKeySecretName: '',
			ollamaBaseUrl: 'http://localhost:11434',
		});
		expect(message).toContain('model not pulled');
	});

	test('falls back to the Ollama-unreachable message when no init error was captured', () => {
		const message = getApiKeyErrorMessage({
			provider: 'ollama',
			lastInitError: null,
			apiKeySecretName: '',
			ollamaBaseUrl: 'http://localhost:11434',
		});
		expect(message).toContain('http://localhost:11434');
		expect(message).toContain('Ollama');
	});

	test('falls back to the no-API-key message for Gemini when nothing is configured', () => {
		const message = getApiKeyErrorMessage({
			provider: 'gemini',
			lastInitError: null,
			apiKeySecretName: '',
			ollamaBaseUrl: 'http://localhost:11434',
		});
		expect(message).toContain('No Gemini API key configured');
	});

	test('falls back to the key-retrieval-failed message for Gemini when a key is configured but unreadable', () => {
		const message = getApiKeyErrorMessage({
			provider: 'gemini',
			lastInitError: null,
			apiKeySecretName: 'my-key',
			ollamaBaseUrl: 'http://localhost:11434',
		});
		expect(message).toContain('Could not retrieve your API key');
	});
});
