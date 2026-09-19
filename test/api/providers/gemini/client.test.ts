import type { Mock } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { GeminiClient } from '../../../../src/api/providers/gemini/client';
import type { GeminiClientConfig } from '../../../../src/api/providers/gemini/config';
import { GeminiPrompts } from '../../../../src/prompts';
import type { ExtendedModelRequest, ToolCall } from '../../../../src/api/interfaces/model-api';
import { ModelUseCase } from '../../../../src/api/model-use-case';
import { buildToolHistoryTurns, type ToolCallResultPair } from '../../../../src/agent/agent-loop-helpers';

// Capture every call to `client.models.generateContent` so tests can assert on
// the params (system instruction, contents, etc.) the SDK sees. vi.hoisted lets
// us share the spy with the factory while keeping vitest's mock-hoisting safe.
const { generateContentMock, generateContentStreamMock, interactionsCreateMock, interactionsService } = vi.hoisted(
	() => {
		return {
			generateContentMock: vi.fn(),
			generateContentStreamMock: vi.fn(),
			interactionsCreateMock: vi.fn(),
			interactionsService: {
				create: vi.fn(),
			},
		};
	}
);
// Keep the create spy name the existing tests use.
interactionsService.create = interactionsCreateMock;

vi.mock('@google/genai', () => ({
	GoogleGenAI: vi.fn().mockImplementation(function () {
		return {
			getModel: vi.fn(),
			models: {
				generateContent: generateContentMock,
				generateContentStream: generateContentStreamMock,
			},
			interactions: interactionsService,
		};
	}),
}));

const MockedGoogleGenAI = GoogleGenAI as unknown as Mock;

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
			test('gemini-3.1-pro-preview', () => {
				expect(testSupportsThinking('gemini-3.1-pro-preview')).toBe(true);
				expect(mockLogger.debug).toHaveBeenCalledWith(
					'[GeminiClient] Enabling thinking mode for model: gemini-3.1-pro-preview'
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
	// must paste it into the request's `system_instruction` so the model can
	// read those files without a redundant tool call. See agent-loop tests for
	// the follow-up propagation guarantee — this test confirms the
	// initial-request wiring on the Gemini path (the Interactions transport,
	// the only one the conversational path uses as of the settings redesign).
	describe('perTurnContext propagation to system_instruction', () => {
		beforeEach(() => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockResolvedValue({
				id: 'int_pt',
				status: 'completed',
				output_text: 'ok',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }],
				usage: { total_input_tokens: 1, total_output_tokens: 1, total_tokens: 2 },
			});

			// Stub agentsMemory + skillManager so buildSystemInstruction doesn't NPE.
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			mockPlugin.settings = { userName: 'Tester', ragIndexing: { enabled: false } };
		});

		test('transmits perTurnContext directly as a user input content item', async () => {
			const renderedContext =
				'CONTEXT FILES: places.md\n\n==============================\nFile Label: Context File\nFile Name: places.md\n==============================\n\nMachu Picchu, Petra, the Great Wall.';

			const request: ExtendedModelRequest = {
				prompt: '',
				userMessage: 'list the places',
				kind: 'extended',
				conversationHistory: [],
				perTurnContext: renderedContext,
				projectInstructions: 'always cite paths',
				sessionStartedAt: '2026-05-09T10:00:00',
			};

			await client.generateModelResponse(request);

			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			const params = interactionsCreateMock.mock.calls[0][0];

			// System instruction should be static (no perTurnContext!)
			expect(params.system_instruction).toBeTruthy();
			expect(params.system_instruction).not.toContain('## Turn Context');
			expect(params.system_instruction).not.toContain('Machu Picchu, Petra, the Great Wall.');
			expect(params.system_instruction).toContain('always cite paths');
			expect(params.system_instruction).toContain('2026-05-09T10:00:00');

			// The user input step must contain perTurnContext as its own content item.
			const userStep = params.input[params.input.length - 1];
			expect(userStep.type).toBe('user_input');
			expect(userStep.content).toEqual([
				{ type: 'text', text: 'list the places' },
				{ type: 'text', text: renderedContext },
			]);
		});

		test('omits perTurnContext when it is empty', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'just chat',
				kind: 'extended',
				conversationHistory: [],
			});

			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			const params = interactionsCreateMock.mock.calls[0][0];

			const userStep = params.input[params.input.length - 1];
			expect(userStep.content).toEqual([{ type: 'text', text: 'just chat' }]);
		});
	});

	// Per-use-case thinkingLevel (#621): the client maps the ModelUseCase it was
	// created for to generation_config.thinking_level on the Interactions API
	// (the sole conversational transport as of the settings redesign), which
	// accepts thinking_level for every thinking-capable model — Gemini 2.5,
	// 3.x, and thinking-exp alike (unlike `generateContent`, which rejects it
	// on 2.5/thinking-exp with a 400 and needs the legacy thinkingBudget).
	describe('per-use-case thinkingLevel', () => {
		const THINKING_MODEL = 'gemini-3-pro';

		beforeEach(() => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockResolvedValue({
				id: 'int_tl',
				status: 'completed',
				output_text: 'ok',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }],
				usage: { total_input_tokens: 1, total_output_tokens: 1, total_tokens: 2 },
			});
		});

		// Captures the generation_config the SDK is handed for a client created
		// with the given use case against a thinking-capable model.
		const generationConfigFor = async (useCase?: ModelUseCase, model: string = THINKING_MODEL): Promise<any> => {
			const client = new GeminiClient(
				{ apiKey: 'test-api-key', model, useCase },
				new GeminiPrompts(mockPlugin),
				mockPlugin
			);
			await client.generateModelResponse({ kind: 'base', prompt: 'hi' });
			const params = interactionsCreateMock.mock.calls[0][0];
			return params.generation_config;
		};

		test.each([
			[ModelUseCase.COMPLETIONS, 'minimal'],
			[ModelUseCase.SUMMARY, 'low'],
			[ModelUseCase.REWRITE, 'low'],
			[ModelUseCase.SEARCH, 'medium'],
			[ModelUseCase.CHAT, 'high'],
		])('%s maps to thinking_level %s', async (useCase, expectedLevel) => {
			const generationConfig = await generationConfigFor(useCase);
			expect(generationConfig.thinking_level).toBe(expectedLevel);
			expect(generationConfig.thinking_summaries).toBe('auto');
		});

		test('defaults to high when no use case is set (e.g. createCustom callers)', async () => {
			const generationConfig = await generationConfigFor(undefined);
			expect(generationConfig.thinking_level).toBe('high');
		});

		// The Interactions API is unaffected by the generateContent-only 400 on
		// 2.5/thinking-exp models — it always sends thinking_level.
		test.each(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'thinking-exp-1234'])(
			'%s still gets thinking_level via Interactions',
			async (model) => {
				const generationConfig = await generationConfigFor(ModelUseCase.CHAT, model);
				expect(generationConfig.thinking_level).toBe('high');
			}
		);

		test('gemini-3.x variants get thinking_level', async () => {
			for (const model of ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.5-flash']) {
				interactionsCreateMock.mockClear();
				const generationConfig = await generationConfigFor(ModelUseCase.CHAT, model);
				expect(generationConfig.thinking_level).toBe('high');
			}
		});

		test('omits thinking_level entirely for non-thinking models', async () => {
			const client = new GeminiClient(
				{ apiKey: 'test-api-key', model: 'gemini-pro', useCase: ModelUseCase.CHAT },
				new GeminiPrompts(mockPlugin),
				mockPlugin
			);
			await client.generateModelResponse({ kind: 'base', prompt: 'hi' });
			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.generation_config.thinking_level).toBeUndefined();
		});
	});

	// Wiring coverage: the constructor must route through createGoogleGenAI so a
	// user-configured customBaseUrl reaches the SDK as httpOptions.baseUrl. The
	// google-genai-factory tests cover the helper in isolation; these guard the
	// integration so a future refactor that bypasses the helper would fail loudly.
	describe('customBaseUrl wiring', () => {
		beforeEach(() => {
			MockedGoogleGenAI.mockClear();
		});

		test('forwards httpOptions.baseUrl when plugin.settings.customBaseUrl is set', () => {
			const plugin: any = {
				logger: mockLogger,
				apiKey: 'test-api-key',
				settings: { customBaseUrl: 'https://my-proxy.example.com' },
			};
			new GeminiClient({ apiKey: 'test-api-key', model: 'gemini-pro' }, new GeminiPrompts(plugin), plugin);

			expect(MockedGoogleGenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: 'test-api-key',
					httpOptions: { baseUrl: 'https://my-proxy.example.com' },
				})
			);
		});

		test('omits httpOptions when plugin.settings.customBaseUrl is empty', () => {
			const plugin: any = {
				logger: mockLogger,
				apiKey: 'test-api-key',
				settings: { customBaseUrl: '' },
			};
			new GeminiClient({ apiKey: 'test-api-key', model: 'gemini-pro' }, new GeminiPrompts(plugin), plugin);

			const callArg = MockedGoogleGenAI.mock.calls[0][0];
			expect(callArg.httpOptions).toBeUndefined();
		});

		test('no-plugin fallback constructs GoogleGenAI with config.apiKey only', () => {
			// When GeminiClient is constructed without a plugin (e.g. via
			// ModelClientFactory.createCustom in code paths that don't have one
			// handy), the helper isn't invoked — the constructor falls back to
			// using config.apiKey directly and customBaseUrl is unreachable.
			const promptsPlugin: any = { logger: mockLogger, settings: {} };
			new GeminiClient({ apiKey: 'config-only-key', model: 'gemini-pro' }, new GeminiPrompts(promptsPlugin), undefined);

			expect(MockedGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'config-only-key' });
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// generateImage()
	// ──────────────────────────────────────────────────────────────────────
	describe('generateImage()', () => {
		beforeEach(() => {
			generateContentMock.mockReset();
		});

		test('success - returns base64 from inlineData part', async () => {
			generateContentMock.mockResolvedValue({
				candidates: [
					{
						content: {
							parts: [
								{ text: 'Here is the image' },
								{ inlineData: { mimeType: 'image/png', data: 'base64ImageData' } },
							],
						},
					},
				],
			});

			const result = await client.generateImage('a cat', 'gemini-2.5-flash-image-preview');
			expect(result).toBe('base64ImageData');
		});

		test('no parts -> throws "No content parts in response"', async () => {
			generateContentMock.mockResolvedValue({
				candidates: [{ content: { parts: [] } }],
			});

			await expect(client.generateImage('a cat', 'model')).rejects.toThrow('No content parts in response');
		});

		test('parts without inlineData -> throws "No image data in response"', async () => {
			generateContentMock.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'sorry, no image' }] } }],
			});

			await expect(client.generateImage('a cat', 'model')).rejects.toThrow('No image data in response');
		});

		test('error propagation with logging', async () => {
			const apiError = new Error('API quota exceeded');
			generateContentMock.mockRejectedValue(apiError);

			await expect(client.generateImage('a cat', 'model')).rejects.toThrow('API quota exceeded');
			expect(mockLogger.error).toHaveBeenCalledWith('[GeminiClient] Error generating image:', apiError);
		});
	});

	describe('Interactions API transport', () => {
		const makeInteractionsClient = (extra: Partial<GeminiClientConfig> = {}) =>
			new GeminiClient(
				{ apiKey: 'test-api-key', model: 'gemini-3-flash', ...extra },
				new GeminiPrompts(mockPlugin),
				mockPlugin
			);

		beforeEach(() => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockResolvedValue({
				id: 'int_1',
				status: 'completed',
				output_text: 'Hello from interactions',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello from interactions' }] }],
				usage: { total_input_tokens: 10, total_output_tokens: 5, total_tokens: 15, total_cached_tokens: 2 },
			});

			// Stub the plugin surface buildExtendedSystemInstruction depends on.
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			mockPlugin.settings = { userName: 'Tester', ragIndexing: { enabled: false } };
		});

		test('routes generateModelResponse to interactions.create, not generateContent', async () => {
			const client = makeInteractionsClient();
			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [],
			});

			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			expect(generateContentMock).not.toHaveBeenCalled();
			expect(response.markdown).toBe('Hello from interactions');
		});

		test('sends stateless params: store=false and snake_case generation_config', async () => {
			const client = makeInteractionsClient();
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [],
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.store).toBe(false);
			expect(params.previous_interaction_id).toBeUndefined();
			// gemini-3-flash supports thinking → lowercase thinking_level for CHAT use case
			expect(params.generation_config.thinking_level).toBe('high');
		});

		test('maxOutputTokens threads through as snake_case max_output_tokens', async () => {
			const client = makeInteractionsClient({ maxOutputTokens: 4096 });
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [],
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.generation_config.max_output_tokens).toBe(4096);
		});

		test('maps tools to flat function declarations', async () => {
			const client = makeInteractionsClient();
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'use a tool',
				kind: 'extended',
				conversationHistory: [],
				availableTools: [
					{
						name: 'read_file',
						description: 'Read a file',
						parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
					},
				],
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.tools).toEqual([
				{
					type: 'function',
					name: 'read_file',
					description: 'Read a file',
					parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
				},
			]);
		});

		test('replays history as typed steps incl. function call/result round-trip', async () => {
			const client = makeInteractionsClient();
			// Build the history the way production does — via buildToolHistoryTurns
			// from a ToolCall + ToolCallResultPair — so this fixture cannot diverge
			// from the shape buildFunctionResponseParts actually emits (#1398: the
			// old hand-written Content literal carried a functionResponse.id that
			// no production path ever produced).
			const conversationHistory = buildToolHistoryTurns({
				conversationHistory: [{ role: 'user', parts: [{ text: 'read foo.md' }] }],
				userMessage: '',
				toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'foo.md' } }],
				toolResults: [
					{
						toolName: 'read_file',
						toolArguments: { path: 'foo.md' },
						result: { success: true, data: { content: 'hi' } },
						id: 'c1',
						sourceIndex: 0,
					},
				],
			});
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'and now?',
				kind: 'extended',
				conversationHistory,
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.input).toEqual([
				{ type: 'user_input', content: [{ type: 'text', text: 'read foo.md' }] },
				{ type: 'function_call', id: 'c1', name: 'read_file', arguments: { path: 'foo.md' } },
				{
					type: 'function_result',
					call_id: 'c1',
					name: 'read_file',
					// Plain string, never a content array — the array form is a
					// "multimodal function response" that Gemini 2.5 rejects with a 400.
					result: JSON.stringify({ success: true, data: { content: 'hi' } }),
				},
				{ type: 'user_input', content: [{ type: 'text', text: 'and now?' }] },
			]);
		});

		test('pairs function_result.call_id with function_call.id after a priority reorder (#1398)', async () => {
			const client = makeInteractionsClient();
			// The model emitted [delete_file, read_file]; the sort reorders to
			// [read_file, delete_file] before execution. The replayed history
			// must still pair each function_result with its own function_call
			// id — this is exactly the case where name-based pairing breaks
			// under two same-name calls or cross-name reordering.
			const toolCalls: ToolCall[] = [
				{ id: 'call_d1', name: 'delete_file', arguments: { path: 'a.md' } },
				{ id: 'call_r1', name: 'read_file', arguments: { path: 'b.md' } },
			];
			const toolResults: ToolCallResultPair[] = [
				{
					toolName: 'read_file',
					toolArguments: { path: 'b.md' },
					result: { success: true, data: {} },
					id: 'call_r1',
					sourceIndex: 1,
				},
				{
					toolName: 'delete_file',
					toolArguments: { path: 'a.md' },
					result: { success: true, data: {} },
					id: 'call_d1',
					sourceIndex: 0,
				},
			];
			const conversationHistory = buildToolHistoryTurns({
				conversationHistory: [{ role: 'user', parts: [{ text: 'read b.md then delete a.md' }] }],
				userMessage: '',
				toolCalls,
				toolResults,
			});
			// Sanity: the call parts are in the model's emitted order.
			const callParts = conversationHistory
				.flatMap((c) => c.parts)
				.filter((p): p is NonNullable<typeof p> => p?.functionCall !== undefined);
			expect(callParts.map((p) => p.functionCall!.id)).toEqual(['call_d1', 'call_r1']);

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'done?',
				kind: 'extended',
				conversationHistory,
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			const results = params.input.filter((s: { type: string }) => s.type === 'function_result');
			const calls = params.input.filter((s: { type: string }) => s.type === 'function_call');
			// Every call_id references a function_call id that exists in the same input.
			for (const r of results) {
				expect(calls.some((c: { id?: string }) => c.id === r.call_id)).toBe(true);
			}
			// ...and the results are realigned onto the model's emitted order, so
			// the two turns pair up positionally as well as by id (#1499). Before
			// the realignment these came back in execution order (r1 then d1),
			// leaving the id as the only thing holding the pairing together.
			expect(results.map((r: { call_id: string }) => r.call_id)).toEqual(['call_d1', 'call_r1']);
			expect(calls.map((c: { id?: string }) => c.id)).toEqual(['call_d1', 'call_r1']);
		});

		test('maps inline image attachments to image content items', async () => {
			const client = makeInteractionsClient();
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'what is this?',
				kind: 'extended',
				conversationHistory: [],
				inlineAttachments: [{ base64: 'AAAA', mimeType: 'image/png' }],
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			const lastStep = params.input[params.input.length - 1];
			expect(lastStep.content).toEqual([
				{ type: 'text', text: 'what is this?' },
				{ type: 'image', data: 'AAAA', mime_type: 'image/png' },
			]);
		});

		test('maps multiple inline attachments in order', async () => {
			const client = makeInteractionsClient();
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'what are these?',
				kind: 'extended',
				conversationHistory: [],
				inlineAttachments: [
					{ base64: 'AAAA', mimeType: 'image/png' },
					{ base64: 'BBBB', mimeType: 'image/gif' },
				],
			});

			const params = interactionsCreateMock.mock.calls[0][0];
			const lastStep = params.input[params.input.length - 1];
			expect(lastStep.content).toEqual([
				{ type: 'text', text: 'what are these?' },
				{ type: 'image', data: 'AAAA', mime_type: 'image/png' },
				{ type: 'image', data: 'BBBB', mime_type: 'image/gif' },
			]);
		});

		test('extracts tool calls, thoughts, and usage from the interaction', async () => {
			interactionsCreateMock.mockResolvedValue({
				id: 'int_2',
				status: 'requires_action',
				output_text: '',
				steps: [
					{ type: 'thought', summary: [{ type: 'text', text: 'thinking...' }] },
					{ type: 'function_call', id: 'c9', name: 'list_files', arguments: { dir: '.' }, signature: 'sig9' },
				],
				usage: { total_input_tokens: 7, total_output_tokens: 3, total_tokens: 10 },
			});
			const client = makeInteractionsClient();
			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'list files',
				kind: 'extended',
				conversationHistory: [],
			});

			expect(response.thoughts).toBe('thinking...');
			expect(response.toolCalls).toEqual([
				{ name: 'list_files', arguments: { dir: '.' }, id: 'c9', thoughtSignature: 'sig9' },
			]);
			expect(response.usageMetadata).toEqual({
				promptTokenCount: 7,
				candidatesTokenCount: 3,
				totalTokenCount: 10,
				cachedContentTokenCount: undefined,
			});
		});

		test('streams step-based events: text chunks, tool call, and usage', async () => {
			const events = [
				{ event_type: 'interaction.created', interaction: { id: 'int_s' } },
				{ event_type: 'step.start', index: 0, step: { type: 'model_output' } },
				{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Read' } },
				{ event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'ing…' } },
				{ event_type: 'step.stop', index: 0 },
				{ event_type: 'step.start', index: 1, step: { type: 'function_call', id: 'c1', name: 'read_file' } },
				{ event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: '{"path":"a.md"}' } },
				{ event_type: 'step.stop', index: 1 },
				{
					event_type: 'interaction.completed',
					interaction: { usage: { total_input_tokens: 9, total_output_tokens: 3, total_tokens: 12 } },
				},
			];
			interactionsCreateMock.mockImplementation(async () => {
				return (async function* () {
					for (const event of events) yield event;
				})();
			});

			const client = makeInteractionsClient();
			const chunks: Array<{ text: string; thought?: string }> = [];
			const stream = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'read a.md', kind: 'extended', conversationHistory: [] },
				(chunk) => chunks.push(chunk)
			);
			const result = await stream.complete;

			// stream: true was requested
			expect(interactionsCreateMock.mock.calls[0][0].stream).toBe(true);
			// text streamed incrementally
			expect(chunks).toEqual([{ text: 'Read' }, { text: 'ing…' }]);
			expect(result.markdown).toBe('Reading…');
			// tool call assembled from start + arguments_delta
			expect(result.toolCalls).toEqual([
				{ name: 'read_file', arguments: { path: 'a.md' }, id: 'c1', thoughtSignature: undefined },
			]);
			expect(result.usageMetadata?.totalTokenCount).toBe(12);
		});

		test('cancel() stops processing and returns the partial response', async () => {
			interactionsCreateMock.mockImplementation(async () => {
				return (async function* () {
					yield { event_type: 'step.start', index: 0, step: { type: 'model_output' } };
					yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'partial' } };
					yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: ' MORE' } };
				})();
			});

			const client = makeInteractionsClient();
			const chunks: Array<{ text: string }> = [];
			const stream = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				(chunk) => {
					chunks.push(chunk);
					stream.cancel(); // cancel after the first emitted chunk
				}
			);
			const result = await stream.complete;

			// Only the pre-cancel chunk is emitted and processed; later events are ignored.
			expect(chunks).toEqual([{ text: 'partial' }]);
			expect(result.markdown).toBe('partial');
			expect(result.markdown).not.toContain('MORE');
		});

		test('cancel() aborts a stalled SSE read (does not wait for the next frame)', async () => {
			// A Stream that yields one frame, then blocks on the next read until its
			// AbortController fires — modelling a server that has gone quiet. Without
			// aborting the controller, `complete` would hang here.
			interactionsCreateMock.mockImplementation(async () => {
				const controller = new AbortController();
				return {
					controller,
					async *[Symbol.asyncIterator]() {
						yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'partial' } };
						await new Promise((_resolve, reject) => {
							if (controller.signal.aborted) return reject(new Error('aborted'));
							controller.signal.addEventListener('abort', () => reject(new Error('aborted')));
						});
						yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: ' NEVER' } };
					},
				};
			});

			const client = makeInteractionsClient();
			const stream = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				() => stream.cancel() // cancel mid-read, while the second read is blocked
			);
			const result = await stream.complete; // resolves only because cancel() aborts the read

			expect(result.markdown).toBe('partial');
			expect(result.markdown).not.toContain('NEVER');
		});

		test('one-shot base requests pass the prompt as input', async () => {
			const client = makeInteractionsClient();
			await client.generateModelResponse({ prompt: 'just answer', kind: 'base' } as any);

			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.input).toBe('just answer');
			expect(params.system_instruction).toBeUndefined();
		});

		describe('error handling', () => {
			test('generateModelResponse logs and rethrows when interactions.create rejects', async () => {
				const apiError = new Error('interactions boom');
				interactionsCreateMock.mockReset();
				interactionsCreateMock.mockRejectedValue(apiError);

				const client = makeInteractionsClient();
				await expect(
					client.generateModelResponse({
						prompt: '',
						userMessage: 'hi',
						kind: 'extended',
						conversationHistory: [],
					})
				).rejects.toBe(apiError);

				expect(mockLogger.error).toHaveBeenCalledWith('[GeminiClient] Error creating interaction:', apiError);
			});

			test('streaming logs and rethrows when interactions.create rejects', async () => {
				const apiError = new Error('interactions stream boom');
				interactionsCreateMock.mockReset();
				interactionsCreateMock.mockRejectedValue(apiError);

				const client = makeInteractionsClient();
				const chunks: Array<{ text: string }> = [];
				const stream = client.generateStreamingResponse(
					{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
					(chunk) => chunks.push(chunk)
				);

				await expect(stream.complete).rejects.toBe(apiError);
				expect(chunks).toEqual([]);
				expect(mockLogger.error).toHaveBeenCalledWith('[GeminiClient] Error streaming interaction:', apiError);
			});

			test('streaming logs and rethrows when the stream throws mid-iteration', async () => {
				const apiError = new Error('mid-stream boom');
				interactionsCreateMock.mockReset();
				interactionsCreateMock.mockImplementation(async () => {
					return (async function* () {
						yield { event_type: 'step.start', index: 0, step: { type: 'model_output' } };
						yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'partial' } };
						throw apiError;
					})();
				});

				const client = makeInteractionsClient();
				const chunks: Array<{ text: string }> = [];
				const stream = client.generateStreamingResponse(
					{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
					(chunk) => chunks.push(chunk)
				);

				await expect(stream.complete).rejects.toBe(apiError);
				// The pre-error chunk was still emitted before the stream faulted.
				expect(chunks).toEqual([{ text: 'partial' }]);
				expect(mockLogger.error).toHaveBeenCalledWith('[GeminiClient] Error streaming interaction:', apiError);
			});
		});
	});

	describe('interactions-only model routing', () => {
		// gemini-omni-flash-preview is flagged interactionsOnly in the bundled
		// catalog: generateContent rejects it with a 400 ("This model only
		// supports Interactions API"). generateModelResponse/generateStreamingResponse
		// always route through Interactions now (the transport toggle is gone), so
		// this exercises resolveModel's per-request override and generateImage's
		// own (still generateContent-based) routing around the same flag.
		const makeClient = (model: string) =>
			new GeminiClient({ apiKey: 'test-api-key', model }, new GeminiPrompts(mockPlugin), mockPlugin);

		beforeEach(() => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockResolvedValue({
				id: 'int_2',
				status: 'completed',
				output_text: 'Hello from interactions',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello from interactions' }] }],
			});
			generateContentMock.mockReset();
			generateContentMock.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'Hello from generateContent' }] } }],
			});

			// Stub the plugin surface buildExtendedSystemInstruction depends on.
			mockPlugin.agentsMemory = { read: vi.fn().mockResolvedValue('') };
			mockPlugin.skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			mockPlugin.settings = { userName: 'Tester', ragIndexing: { enabled: false } };
		});

		test('configured interactions-only model routes via interactions.create', async () => {
			const client = makeClient('gemini-omni-flash-preview');
			const response = await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [],
			});

			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			expect(generateContentMock).not.toHaveBeenCalled();
			expect(interactionsCreateMock.mock.calls[0][0].model).toBe('gemini-omni-flash-preview');
			expect(response.markdown).toBe('Hello from interactions');
		});

		test('per-request model override to an interactions-only model routes via interactions.create', async () => {
			const client = makeClient('gemini-flash-latest');
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'hi',
				kind: 'extended',
				conversationHistory: [],
				model: 'gemini-omni-flash-preview',
			});

			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			expect(generateContentMock).not.toHaveBeenCalled();
			expect(interactionsCreateMock.mock.calls[0][0].model).toBe('gemini-omni-flash-preview');
		});

		test('generateImage routes an interactions-only image model via interactions.create', async () => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockResolvedValue({
				id: 'int_img',
				status: 'completed',
				output_image: { data: 'BASE64_IMAGE', mime_type: 'image/png' },
				steps: [{ type: 'model_output', content: [{ type: 'image', data: 'BASE64_IMAGE' }] }],
			});

			const client = makeClient('gemini-flash-latest');
			const data = await client.generateImage('a nano banana dish', 'gemini-omni-flash-preview');

			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			expect(generateContentMock).not.toHaveBeenCalled();
			const params = interactionsCreateMock.mock.calls[0][0];
			expect(params.model).toBe('gemini-omni-flash-preview');
			expect(params.input).toBe('a nano banana dish');
			expect(params.store).toBe(false);
			expect(data).toBe('BASE64_IMAGE');
		});

		test('generateImage via interactions throws when the response has no image data', async () => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockResolvedValue({
				id: 'int_img',
				status: 'completed',
				output_text: 'Sorry, cannot draw that.',
				steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Sorry, cannot draw that.' }] }],
			});

			const client = makeClient('gemini-flash-latest');
			await expect(client.generateImage('a nano banana dish', 'gemini-omni-flash-preview')).rejects.toThrow(
				'No image data in response'
			);
		});

		test('generateImage keeps using generateContent for regular image models', async () => {
			generateContentMock.mockReset();
			generateContentMock.mockResolvedValue({
				candidates: [{ content: { parts: [{ inlineData: { data: 'GC_IMAGE' } }] } }],
			});

			const client = makeClient('gemini-flash-latest');
			const data = await client.generateImage('a nano banana dish', 'gemini-2.5-flash-image');

			expect(generateContentMock).toHaveBeenCalledTimes(1);
			expect(interactionsCreateMock).not.toHaveBeenCalled();
			expect(data).toBe('GC_IMAGE');
		});

		test('streaming an interactions-only model routes via the interactions stream despite the toggle being off', async () => {
			interactionsCreateMock.mockReset();
			interactionsCreateMock.mockImplementation(async () => {
				return (async function* () {
					yield { event_type: 'step.start', index: 0, step: { type: 'model_output' } };
					yield { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'streamed' } };
				})();
			});

			const client = makeClient('gemini-omni-flash-preview');
			const chunks: Array<{ text: string }> = [];
			const stream = client.generateStreamingResponse(
				{ prompt: '', userMessage: 'hi', kind: 'extended', conversationHistory: [] },
				(chunk) => chunks.push(chunk)
			);

			const response = await stream.complete;
			expect(interactionsCreateMock).toHaveBeenCalledTimes(1);
			expect(interactionsCreateMock.mock.calls[0][0].stream).toBe(true);
			expect(chunks).toEqual([{ text: 'streamed' }]);
			expect(response.markdown).toBe('streamed');
		});
	});
});
