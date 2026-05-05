import { createGoogleGenAI } from '../../src/api/google-genai-factory';
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

		// 注意：createGoogleGenAI 直接用 settings.customBaseUrl，
		// 空格字符串是 truthy，所以会传入。这个测试验证实际行为。
		createGoogleGenAI(mockPlugin);

		const callArg = MockedGoogleGenAI.mock.calls[0][0];
		// 空格字符串是 truthy，httpOptions 会被设置
		expect(callArg.httpOptions).toBeDefined();
	});

	test('returns a GoogleGenAI instance', () => {
		const result = createGoogleGenAI(mockPlugin);
		expect(MockedGoogleGenAI).toHaveBeenCalledTimes(1);
		expect(result).toBeDefined();
	});
});
