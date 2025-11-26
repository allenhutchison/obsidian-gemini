import { GeminiClient, GeminiClientConfig } from '../../src/api/gemini-client';
import { GeminiPrompts } from '../../src/prompts';

// Mock @google/genai
jest.mock('@google/genai', () => ({
	GoogleGenAI: jest.fn().mockImplementation(() => ({
		getModel: jest.fn()
	}))
}));

// Mock window.localStorage
const mockLocalStorage = {
	getItem: jest.fn().mockReturnValue('en'),
	setItem: jest.fn(),
	removeItem: jest.fn(),
	clear: jest.fn()
};
Object.defineProperty(window, 'localStorage', {
	value: mockLocalStorage,
	writable: true
});

describe('GeminiClient', () => {
	let client: GeminiClient;
	let mockPlugin: any;
	let mockLogger: any;

	beforeEach(() => {
		// Setup mock logger
		mockLogger = {
			log: jest.fn(),
			debug: jest.fn(),
			error: jest.fn(),
			warn: jest.fn()
		};

		// Setup mock plugin
		mockPlugin = {
			logger: mockLogger
		};

		// Create client with minimal config
		const config: GeminiClientConfig = {
			apiKey: 'test-api-key',
			model: 'gemini-pro'
		};

		const prompts = new GeminiPrompts(mockPlugin);
		client = new GeminiClient(config, prompts, mockPlugin);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('supportsThinking()', () => {
		// Helper to access private method for testing
		const testSupportsThinking = (model: string | undefined): boolean => {
			return (client as any).supportsThinking(model);
		};

		describe('should return true for models that support thinking', () => {
			test('gemini-3-pro-preview', () => {
				expect(testSupportsThinking('gemini-3-pro-preview')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: gemini-3-pro-preview'
				);
			});

			test('gemini-3-pro-image-preview', () => {
				expect(testSupportsThinking('gemini-3-pro-image-preview')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: gemini-3-pro-image-preview'
				);
			});

			test('gemini-3-flash', () => {
				expect(testSupportsThinking('gemini-3-flash')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: gemini-3-flash'
				);
			});

			test('gemini-2.5-flash-preview', () => {
				expect(testSupportsThinking('gemini-2.5-flash-preview')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: gemini-2.5-flash-preview'
				);
			});

			test('gemini-2.5-pro-preview', () => {
				expect(testSupportsThinking('gemini-2.5-pro-preview')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: gemini-2.5-pro-preview'
				);
			});

			test('thinking-exp-1234', () => {
				expect(testSupportsThinking('thinking-exp-1234')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: thinking-exp-1234'
				);
			});
		});

		describe('should return false for models that do not support thinking', () => {
			test('gemini-1.5-pro', () => {
				expect(testSupportsThinking('gemini-1.5-pro')).toBe(false);
				expect(mockLogger.debug).not.toHaveBeenCalledWith(
					expect.stringContaining('Enabling thinking mode')
				);
			});

			test('gemini-1.5-flash', () => {
				expect(testSupportsThinking('gemini-1.5-flash')).toBe(false);
				expect(mockLogger.debug).not.toHaveBeenCalledWith(
					expect.stringContaining('Enabling thinking mode')
				);
			});

			test('gemini-pro', () => {
				expect(testSupportsThinking('gemini-pro')).toBe(false);
				expect(mockLogger.debug).not.toHaveBeenCalledWith(
					expect.stringContaining('Enabling thinking mode')
				);
			});

			test('undefined', () => {
				expect(testSupportsThinking(undefined)).toBe(false);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] No model specified for thinking check'
				);
			});

			test('empty string', () => {
				expect(testSupportsThinking('')).toBe(false);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] No model specified for thinking check'
				);
			});
		});

		describe('edge cases', () => {
			test('case insensitivity - uppercase', () => {
				expect(testSupportsThinking('GEMINI-3-PRO')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: GEMINI-3-PRO'
				);
			});

			test('case insensitivity - mixed case', () => {
				expect(testSupportsThinking('Gemini-3-Pro')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: Gemini-3-Pro'
				);
			});

			test('case insensitivity - Gemini 2.5', () => {
				expect(testSupportsThinking('GEMINI-2.5-FLASH')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: GEMINI-2.5-FLASH'
				);
			});

			test('whitespace handling - leading space', () => {
				expect(testSupportsThinking(' gemini-3-pro')).toBe(true);
			});

			test('whitespace handling - trailing space', () => {
				expect(testSupportsThinking('gemini-3-pro ')).toBe(true);
			});

			test('whitespace handling - both sides', () => {
				expect(testSupportsThinking(' gemini-3-pro ')).toBe(true);
			});
		});

		describe('model name variations', () => {
			test('gemini-3 with different suffixes', () => {
				expect(testSupportsThinking('gemini-3-ultra')).toBe(true);
				expect(testSupportsThinking('gemini-3-nano')).toBe(true);
				expect(testSupportsThinking('gemini-3-custom')).toBe(true);
			});

			test('gemini-2.5 with different suffixes', () => {
				expect(testSupportsThinking('gemini-2.5-ultra')).toBe(true);
				expect(testSupportsThinking('gemini-2.5-nano')).toBe(true);
				expect(testSupportsThinking('gemini-2.5-custom')).toBe(true);
			});

			test('thinking-exp with different versions', () => {
				expect(testSupportsThinking('thinking-exp-0115')).toBe(true);
				expect(testSupportsThinking('thinking-exp-alpha')).toBe(true);
				expect(testSupportsThinking('thinking-exp-beta')).toBe(true);
			});
		});

		describe('models that should not match', () => {
			test('similar but different model names', () => {
				expect(testSupportsThinking('gemini-1.0')).toBe(false);
				expect(testSupportsThinking('gemini-2.0')).toBe(false);
				expect(testSupportsThinking('gemini-2.4')).toBe(false);
				expect(testSupportsThinking('gemini-v3')).toBe(false); // not "gemini-3"
				expect(testSupportsThinking('thinking-preview')).toBe(false); // not "thinking-exp"
			});

			test('partial matches should not work', () => {
				expect(testSupportsThinking('my-gemini-3-model')).toBe(true); // contains "gemini-3"
				expect(testSupportsThinking('custom-thinking-exp-model')).toBe(true); // contains "thinking-exp"
			});
		});
	});
});
