import { createGoogleGenAI } from '../../../../src/api/providers/gemini/google-genai-factory';
import { GoogleGenAI } from '@google/genai';

// Mock @google/genai
vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(function (options: any) {
		return { _options: options };
	}),
}));

const MockedGoogleGenAI = GoogleGenAI as unknown as ReturnType<typeof vi.fn>;

describe('createGoogleGenAI', () => {
	let mockPlugin: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPlugin = {
			apiKey: 'test-api-key',
			settings: {
				customBaseUrl: '',
			},
		};
	});

	test('passes apiKey to GoogleGenAI', () => {
		createGoogleGenAI(mockPlugin);

		expect(MockedGoogleGenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-api-key' }));
	});

	test('does not pass httpOptions when customBaseUrl is empty', () => {
		mockPlugin.settings.customBaseUrl = '';

		createGoogleGenAI(mockPlugin);

		const callArg = MockedGoogleGenAI.mock.calls[0][0];
		expect(callArg.httpOptions).toBeUndefined();
	});

	test('passes httpOptions.baseUrl when customBaseUrl is set', () => {
		mockPlugin.settings.customBaseUrl = 'https://my-proxy.example.com';

		createGoogleGenAI(mockPlugin);

		expect(MockedGoogleGenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: 'test-api-key',
				httpOptions: { baseUrl: 'https://my-proxy.example.com' },
			})
		);
	});

	test('does not pass httpOptions when customBaseUrl is whitespace only', () => {
		mockPlugin.settings.customBaseUrl = '   ';

		createGoogleGenAI(mockPlugin);

		const callArg = MockedGoogleGenAI.mock.calls[0][0];
		expect(callArg.httpOptions).toBeUndefined();
	});

	test('returns a GoogleGenAI instance', () => {
		const result = createGoogleGenAI(mockPlugin);
		expect(MockedGoogleGenAI).toHaveBeenCalledTimes(1);
		expect(result).toBeDefined();
	});

	test('apiKeyOverride wins over plugin.apiKey when provided', () => {
		mockPlugin.apiKey = 'plugin-key';

		createGoogleGenAI(mockPlugin, 'override-key');

		expect(MockedGoogleGenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'override-key' }));
	});

	test('tolerates undefined apiKey without throwing', () => {
		// Defensive: if the plugin is initialised before the user enters an API key,
		// the helper still has to return something — it forwards apiKey: undefined
		// to GoogleGenAI rather than throwing. The actual no-plugin fallback path
		// (constructing GoogleGenAI without going through the helper at all) lives
		// in GeminiClient and is covered in test/api/gemini-client.test.ts.
		mockPlugin.apiKey = undefined;
		mockPlugin.settings.customBaseUrl = '';

		expect(() => createGoogleGenAI(mockPlugin)).not.toThrow();
		expect(MockedGoogleGenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: undefined }));
	});
});
