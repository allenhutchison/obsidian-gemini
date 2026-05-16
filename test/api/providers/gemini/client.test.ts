import type { Mock } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { GeminiClient } from '../../../../src/api/providers/gemini/client';
import type { GeminiClientConfig } from '../../../../src/api/providers/gemini/config';
import { GeminiPrompts } from '../../../../src/prompts';
import type { ExtendedModelRequest } from '../../../../src/api/interfaces/model-api';

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
	// extractModelResponse()
	// ──────────────────────────────────────────────────────────────────────
	describe('extractModelResponse()', () => {
		const extract = (response: any) => (client as any).extractModelResponse(response);

		test('regular text parts are concatenated', () => {
			const result = extract({
				candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] } }],
			});
			expect(result.markdown).toBe('hello world');
			expect(result.thoughts).toBeUndefined();
		});

		test('thought parts go to thoughts field', () => {
			const result = extract({
				candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }] } }],
			});
			expect(result.markdown).toBe('');
			expect(result.thoughts).toBe('thinking...');
		});

		test('both thought and regular parts separated correctly', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [{ text: 'regular text' }, { text: 'deep thought', thought: true }, { text: ' more text' }],
						},
					},
				],
			});
			expect(result.markdown).toBe('regular text more text');
			expect(result.thoughts).toBe('deep thought');
		});

		test('usageMetadata mapped from response', () => {
			const result = extract({
				candidates: [{ content: { parts: [{ text: 'ok' }] } }],
				usageMetadata: {
					promptTokenCount: 10,
					candidatesTokenCount: 5,
					totalTokenCount: 15,
					cachedContentTokenCount: 2,
				},
			});
			expect(result.usageMetadata).toEqual({
				promptTokenCount: 10,
				candidatesTokenCount: 5,
				totalTokenCount: 15,
				cachedContentTokenCount: 2,
			});
		});

		test('tool calls extracted via extractToolCallsFromResponse', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: 'read_file', args: { path: '/a.md' }, id: 'call-1' } }],
						},
					},
				],
			});
			expect(result.toolCalls).toEqual([
				{ name: 'read_file', arguments: { path: '/a.md' }, id: 'call-1', thoughtSignature: undefined },
			]);
		});

		test('search grounding extracted via extractRenderedFromResponse', () => {
			const result = extract({
				candidates: [
					{
						content: { parts: [{ text: 'answer' }] },
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
						},
					},
				],
			});
			expect(result.rendered).toContain('https://example.com');
			expect(result.rendered).toContain('Example');
		});

		test('empty/no candidates -> empty markdown', () => {
			expect(extract({ candidates: [] }).markdown).toBe('');
			expect(extract({}).markdown).toBe('');
			expect(extract({ candidates: [{ content: { parts: [] } }] }).markdown).toBe('');
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// extractToolCallsFromResponse()
	// ──────────────────────────────────────────────────────────────────────
	describe('extractToolCallsFromResponse()', () => {
		const extract = (response: any) => (client as any).extractToolCallsFromResponse(response);

		test('single functionCall extracted', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: 'read_file', args: { path: '/a.md' } } }],
						},
					},
				],
			});
			expect(result).toHaveLength(1);
			expect(result![0].name).toBe('read_file');
			expect(result![0].arguments).toEqual({ path: '/a.md' });
		});

		test('multiple functionCalls', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [
								{ functionCall: { name: 'read_file', args: { path: '/a.md' } } },
								{ functionCall: { name: 'write_file', args: { path: '/b.md', content: 'hi' } } },
							],
						},
					},
				],
			});
			expect(result).toHaveLength(2);
			expect(result![0].name).toBe('read_file');
			expect(result![1].name).toBe('write_file');
		});

		test('functionCall with thoughtSignature', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [
								{
									functionCall: { name: 'tool', args: { x: 1 } },
									thoughtSignature: 'sig123',
								},
							],
						},
					},
				],
			});
			expect(result![0].thoughtSignature).toBe('sig123');
		});

		test('functionCall.args defaults to {} when undefined', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: 'no_args' } }],
						},
					},
				],
			});
			expect(result![0].arguments).toEqual({});
		});

		test('no functionCall parts -> undefined', () => {
			const result = extract({
				candidates: [{ content: { parts: [{ text: 'just text' }] } }],
			});
			expect(result).toBeUndefined();
		});

		test('no parts -> undefined', () => {
			expect(extract({ candidates: [{ content: {} }] })).toBeUndefined();
			expect(extract({})).toBeUndefined();
		});

		test('functionCall with id preserved', () => {
			const result = extract({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: 'tool', args: {}, id: 'fc-42' } }],
						},
					},
				],
			});
			expect(result![0].id).toBe('fc-42');
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// extractRenderedFromResponse()
	// ──────────────────────────────────────────────────────────────────────
	describe('extractRenderedFromResponse()', () => {
		const extract = (response: any) => (client as any).extractRenderedFromResponse(response);

		test('no grounding metadata -> empty string', () => {
			expect(extract({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })).toBe('');
		});

		test('empty groundingChunks -> empty string', () => {
			expect(
				extract({
					candidates: [
						{
							content: { parts: [{ text: 'ok' }] },
							groundingMetadata: { groundingChunks: [] },
						},
					],
				})
			).toBe('');
		});

		test('web chunks with title and uri -> HTML with links', () => {
			const result = extract({
				candidates: [
					{
						content: { parts: [{ text: 'ok' }] },
						groundingMetadata: {
							groundingChunks: [
								{ web: { uri: 'https://example.com', title: 'Example Site' } },
								{ web: { uri: 'https://test.org', title: 'Test Org' } },
							],
						},
					},
				],
			});
			expect(result).toContain('<a href="https://example.com"');
			expect(result).toContain('Example Site');
			expect(result).toContain('<a href="https://test.org"');
			expect(result).toContain('Test Org');
			expect(result).toContain('search-grounding');
		});

		test('web chunks without title -> uses URI as text', () => {
			const result = extract({
				candidates: [
					{
						content: { parts: [{ text: 'ok' }] },
						groundingMetadata: {
							groundingChunks: [{ web: { uri: 'https://no-title.com' } }],
						},
					},
				],
			});
			expect(result).toContain('>https://no-title.com</a>');
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// extractTextFromChunk() and extractThoughtFromChunk()
	// ──────────────────────────────────────────────────────────────────────
	describe('extractTextFromChunk()', () => {
		const extractText = (chunk: any) => (client as any).extractTextFromChunk(chunk);

		test('chunk with regular text parts -> returns text', () => {
			const result = extractText({
				candidates: [{ content: { parts: [{ text: 'hello' }, { text: ' world' }] } }],
			});
			expect(result).toBe('hello world');
		});

		test('chunk with thought parts excluded', () => {
			const result = extractText({
				candidates: [
					{
						content: {
							parts: [{ text: 'visible' }, { text: 'hidden', thought: true }],
						},
					},
				],
			});
			expect(result).toBe('visible');
		});

		test('chunk with no candidates -> empty string', () => {
			expect(extractText({})).toBe('');
			expect(extractText({ candidates: [] })).toBe('');
		});
	});

	describe('extractThoughtFromChunk()', () => {
		const extractThought = (chunk: any) => (client as any).extractThoughtFromChunk(chunk);

		test('chunk with thought parts -> returns thought text', () => {
			const result = extractThought({
				candidates: [
					{
						content: {
							parts: [
								{ text: 'reasoning step 1', thought: true },
								{ text: ' reasoning step 2', thought: true },
							],
						},
					},
				],
			});
			expect(result).toBe('reasoning step 1 reasoning step 2');
		});

		test('chunk with no thought parts -> empty string', () => {
			const result = extractThought({
				candidates: [{ content: { parts: [{ text: 'regular text' }] } }],
			});
			expect(result).toBe('');
		});

		test('chunk with no candidates -> empty string', () => {
			expect(extractThought({})).toBe('');
			expect(extractThought({ candidates: [] })).toBe('');
		});
	});

	// ──────────────────────────────────────────────────────────────────────
	// buildContents() — tested indirectly via generateModelResponse
	// ──────────────────────────────────────────────────────────────────────
	describe('buildContents()', () => {
		const validResponse = {
			candidates: [{ content: { parts: [{ text: 'ok' }] } }],
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
		};

		beforeEach(() => {
			generateContentMock.mockReset();
			generateContentMock.mockResolvedValue(validResponse);
			(mockPlugin as any).agentsMemory = { read: vi.fn().mockResolvedValue('') };
			(mockPlugin as any).skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			(mockPlugin as any).settings = { userName: 'Tester', ragIndexing: { enabled: false } };
		});

		test('Content format history ({role, parts}) passed through', async () => {
			const historyEntry = { role: 'user', parts: [{ text: 'prior question' }] };

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'follow up',
				conversationHistory: [historyEntry],
			} as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			// The history entry should appear in contents
			expect(params.contents).toEqual(
				expect.arrayContaining([expect.objectContaining({ role: 'user', parts: [{ text: 'prior question' }] })])
			);
		});

		test('Internal {role, text} format converted', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'new msg',
				conversationHistory: [{ role: 'user', text: 'old msg' }],
			} as unknown as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.contents).toEqual(
				expect.arrayContaining([expect.objectContaining({ role: 'user', parts: [{ text: 'old msg' }] })])
			);
		});

		test('Internal {role, message} format converted', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'new msg',
				conversationHistory: [{ role: 'assistant', message: 'I helped' }],
			} as unknown as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.contents).toEqual(
				expect.arrayContaining([expect.objectContaining({ role: 'model', parts: [{ text: 'I helped' }] })])
			);
		});

		test('model role mapped to "model" in output', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'q',
				conversationHistory: [{ role: 'model', text: 'answer' }],
			} as unknown as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.contents).toEqual(
				expect.arrayContaining([expect.objectContaining({ role: 'model', parts: [{ text: 'answer' }] })])
			);
		});

		test('userMessage with inline attachments adds inlineData parts', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'look at this',
				conversationHistory: [],
				inlineAttachments: [{ base64: 'abc123', mimeType: 'image/png' }],
			} as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			const lastContent = params.contents[params.contents.length - 1];
			expect(lastContent.role).toBe('user');
			expect(lastContent.parts).toEqual(
				expect.arrayContaining([{ text: 'look at this' }, { inlineData: { mimeType: 'image/png', data: 'abc123' } }])
			);
		});

		test('both inlineAttachments and imageAttachments merged', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: 'see these',
				conversationHistory: [],
				inlineAttachments: [{ base64: 'inline1', mimeType: 'image/jpeg' }],
				imageAttachments: [{ base64: 'img1', mimeType: 'image/gif' }],
			} as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			const lastContent = params.contents[params.contents.length - 1];
			// Should have text + 2 inlineData parts
			const inlineDataParts = lastContent.parts.filter((p: any) => 'inlineData' in p);
			expect(inlineDataParts).toHaveLength(2);
		});

		test('empty userMessage with no history -> finalContents is empty string', async () => {
			await client.generateModelResponse({
				prompt: '',
				userMessage: '',
				conversationHistory: [],
			} as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.contents).toBe('');
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

	// ──────────────────────────────────────────────────────────────────────
	// buildGenerateContentParams() with tools
	// ──────────────────────────────────────────────────────────────────────
	describe('buildGenerateContentParams() with tools', () => {
		beforeEach(() => {
			generateContentMock.mockReset();
			generateContentMock.mockResolvedValue({
				candidates: [{ content: { parts: [{ text: 'ok' }] } }],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
			});
			(mockPlugin as any).agentsMemory = { read: vi.fn().mockResolvedValue('') };
			(mockPlugin as any).skillManager = { getSkillSummaries: vi.fn().mockResolvedValue([]) };
			(mockPlugin as any).settings = { userName: 'Tester', ragIndexing: { enabled: false } };
		});

		test('availableTools converted to functionDeclarations in config.tools', async () => {
			const tools = [
				{
					name: 'read_file',
					description: 'Read a file',
					parameters: {
						type: 'object' as const,
						properties: { path: { type: 'string', description: 'File path' } },
						required: ['path'],
					},
				},
			];

			await client.generateModelResponse({
				prompt: '',
				userMessage: 'read that file',
				conversationHistory: [],
				availableTools: tools,
			} as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.config.tools).toBeDefined();
			expect(params.config.tools[0].functionDeclarations).toEqual([
				{
					name: 'read_file',
					description: 'Read a file',
					parameters: {
						type: 'object',
						properties: { path: { type: 'string', description: 'File path' } },
						required: ['path'],
					},
				},
			]);
		});

		test('maxOutputTokens included when set', async () => {
			// Ensure mockPlugin has customBaseUrl for constructor
			(mockPlugin as any).settings.customBaseUrl = '';

			// Create a client with maxOutputTokens configured
			const configWithMaxTokens: GeminiClientConfig = {
				apiKey: 'test-api-key',
				model: 'gemini-pro',
				maxOutputTokens: 4096,
			};
			const clientWithTokens = new GeminiClient(configWithMaxTokens, new GeminiPrompts(mockPlugin), mockPlugin);

			await clientWithTokens.generateModelResponse({
				prompt: '',
				userMessage: 'hello',
				conversationHistory: [],
			} as ExtendedModelRequest);

			const params = (generateContentMock as Mock).mock.calls[0][0];
			expect(params.config.maxOutputTokens).toBe(4096);
		});
	});
});
