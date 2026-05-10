import type { Mock } from 'vitest';
import { GeminiClient, GeminiClientConfig } from '../../src/api/gemini-client';
import { GeminiPrompts } from '../../src/prompts';
import type { ExtendedModelRequest } from '../../src/api/interfaces/model-api';

// Capture every call to `client.models.generateContent` so tests can assert on
// the params (system instruction, contents, etc.) the SDK sees. vi.hoisted lets
// us share the spy with the factory while keeping vitest's mock-hoisting safe.
const { generateContentMock } = vi.hoisted(() => ({
	generateContentMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(function () {
		return {
			getModel: vi.fn(),
			models: {
				generateContent: generateContentMock,
				generateContentStream: vi.fn(),
			},
		};
	}),
}));

// Mock window.localStorage
const mockLocalStorage = {
	getItem: vi.fn().mockReturnValue('en'),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
	value: mockLocalStorage,
	writable: true,
});

describe('GeminiClient', () => {
	let client: GeminiClient;
	let mockPlugin: any;
	let mockLogger: any;

	beforeEach(() => {
		// Setup mock logger
		mockLogger = {
			log: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		};

		// Setup mock plugin
		mockPlugin = {
			logger: mockLogger,
			apiKey: 'test-api-key',
			settings: {
				customBaseUrl: '',
			},
		};

		// Create client with minimal config
		const config: GeminiClientConfig = {
			apiKey: 'test-api-key',
			model: 'gemini-pro',
		};

		const prompts = new GeminiPrompts(mockPlugin);
		client = new GeminiClient(config, prompts, mockPlugin);
	});

	afterEach(() => {
		vi.clearAllMocks();
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
				expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Enabling thinking mode'));
			});

			test('gemini-1.5-flash', () => {
				expect(testSupportsThinking('gemini-1.5-flash')).toBe(false);
				expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Enabling thinking mode'));
			});

			test('gemini-pro', () => {
				expect(testSupportsThinking('gemini-pro')).toBe(false);
				expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Enabling thinking mode'));
			});

			test('undefined', () => {
				expect(testSupportsThinking(undefined)).toBe(false);
				expect(mockLogger.debug).toHaveBeenCalledWith('[GeminiClient] No model specified for thinking check');
			});

			test('null', () => {
				expect(testSupportsThinking(null as any)).toBe(false);
				expect(mockLogger.debug).toHaveBeenCalledWith('[GeminiClient] No model specified for thinking check');
			});

			test('empty string', () => {
				expect(testSupportsThinking('')).toBe(false);
				expect(mockLogger.debug).toHaveBeenCalledWith('[GeminiClient] No model specified for thinking check');
			});
		});

		describe('edge cases', () => {
			test('case insensitivity - uppercase', () => {
				expect(testSupportsThinking('GEMINI-3-PRO')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith('[GeminiClient] Enabling thinking mode for model: GEMINI-3-PRO');
			});

			test('case insensitivity - mixed case', () => {
				expect(testSupportsThinking('Gemini-3-Pro')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith('[GeminiClient] Enabling thinking mode for model: Gemini-3-Pro');
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

			test('partial matches DO work (current behavior using .includes())', () => {
				// NOTE: Current implementation allows partial matches because it uses .includes()
				// This test documents the ACTUAL behavior, not necessarily desired behavior
				expect(testSupportsThinking('my-gemini-3-model')).toBe(true); // contains "gemini-3"
				expect(testSupportsThinking('custom-thinking-exp-model')).toBe(true); // contains "thinking-exp"
			});
		});
	});

	// Regression coverage for the drag-and-drop / @-mention bug. perTurnContext
	// carries the rendered content of context-chip files; the GeminiClient
	// must paste it into the SDK request's `systemInstruction` so the model
	// can read those files without a redundant tool call. See agent-loop
	// tests for the follow-up propagation guarantee — this test confirms the
	// initial-request wiring on the Gemini path.
	describe('perTurnContext propagation to systemInstruction', () => {
		beforeEach(() => {
			generateContentMock.mockReset();
			generateContentMock.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'ok' }] } }],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
			});

			// Stub agentsMemory + skillManager so buildSystemInstruction doesn't NPE.
			(mockPlugin as any).agentsMemory = { read: vi.fn().mockResolvedValue('') };
			(mockPlugin as any).skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			(mockPlugin as any).settings = { userName: 'Tester', ragIndexing: { enabled: false } };
		});

		test('embeds perTurnContext under "## Turn Context" in systemInstruction', async () => {
			const renderedContext =
				'CONTEXT FILES: places.md\n\n==============================\nFile Label: Context File\nFile Name: places.md\n==============================\n\nMachu Picchu, Petra, the Great Wall.';

			const request: ExtendedModelRequest = {
				prompt: '',
				userMessage: 'list the places',
				conversationHistory: [],
				perTurnContext: renderedContext,
				projectInstructions: 'always cite paths',
				sessionStartedAt: '2026-05-09T10:00:00',
			};

			await client.generateModelResponse(request);

			expect(generateContentMock).toHaveBeenCalledTimes(1);
			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.config.systemInstruction).toBeTruthy();
			expect(params.config.systemInstruction).toContain('## Turn Context');
			expect(params.config.systemInstruction).toContain('Machu Picchu, Petra, the Great Wall.');
			expect(params.config.systemInstruction).toContain('always cite paths');
			expect(params.config.systemInstruction).toContain('2026-05-09T10:00:00');
		});

		test('omits "## Turn Context" section when perTurnContext is empty', async () => {
			// Without a per-turn context (e.g. a chat with no chip files), the
			// section should not appear in the system instruction. This guards
			// against accidentally always-injecting an empty heading that would
			// shift the prefix bytes Gemini's implicit cache keys on.
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'just chat',
				conversationHistory: [],
			});

			expect(generateContentMock).toHaveBeenCalledTimes(1);
			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.config.systemInstruction).not.toContain('## Turn Context');
		});
	});
});
