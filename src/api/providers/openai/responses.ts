/**
 * OpenAI Responses API (`/v1/responses`) request and response mapping (#1755).
 *
 * `OpenAIClient` speaks Chat Completions so it works against any
 * OpenAI-compatible server. Some current OpenAI models (gpt-6.1-*,
 * gpt-6-astra) reject function tools on Chat Completions and only call tools
 * through the Responses API, so for those models on api.openai.com the client
 * sends tool-bearing requests here instead. This module holds the pure
 * mapping both ways; the client owns the transport, streaming and
 * cancellation.
 *
 * Requests are stateless (`store: false`): the plugin already holds the whole
 * conversation, so each request carries the full history as input items,
 * exactly like the Chat Completions path. Reasoning models need their
 * reasoning items handed back alongside the function calls they produced, so
 * the response's reasoning items are requested with `encrypted_content` and,
 * like `reasoning-replay.ts` does for OpenRouter, serialized into the first
 * tool call's `thoughtSignature` behind a prefix of their own. The agent loop
 * replays that signature with the tool round, and history conversion turns
 * it back into reasoning input items.
 */

import type OpenAI from 'openai';
import type { ExtendedModelRequest, ModelResponse, ToolCall, ToolDefinition } from '../../interfaces/model-api';
import { walkHistoryEntry } from '../history-walk';
import { SIMPLE_TOOL_ID_PATTERN, ToolIdLedger } from '../tool-id-ledger';
import { NonRetryableRequestError } from '../../../utils/request-errors';
import { t } from '../../../i18n';

type InputItem = OpenAI.Responses.ResponseInputItem;
type InputContent = OpenAI.Responses.ResponseInputMessageContentList;
type ReasoningItem = OpenAI.Responses.ResponseReasoningItem;
type FunctionTool = OpenAI.Responses.FunctionTool;

/** What a logger needs to offer this module. */
interface MappingLogger {
	log(...args: unknown[]): void;
	warn(...args: unknown[]): void;
}

const REASONING_PREFIX = 'oai-responses-reasoning:';

/** The fixed request options every Responses call carries. */
const RESPONSES_REQUEST_OPTIONS = {
	// Stateless: the full history travels with every request.
	store: false,
	// Needed to replay reasoning across a tool round when nothing is stored.
	include: ['reasoning.encrypted_content'] as OpenAI.Responses.ResponseIncludable[],
} as const;

function isReasoningItem(value: unknown): value is ReasoningItem {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return item.type === 'reasoning' && typeof item.id === 'string' && Array.isArray(item.summary);
}

/** Serialize a turn's reasoning items, or `undefined` when it had none. */
export function encodeResponsesReasoning(items: readonly ReasoningItem[]): string | undefined {
	return items.length ? REASONING_PREFIX + JSON.stringify(items) : undefined;
}

/**
 * Decode a `thoughtSignature` written by {@link encodeResponsesReasoning}.
 * Anything else (a Gemini or Anthropic signature, OpenRouter's
 * `reasoning_details`, malformed JSON) decodes to `[]`, so a foreign
 * signature is never sent to OpenAI.
 */
export function decodeResponsesReasoning(signature: string | undefined): ReasoningItem[] {
	if (!signature?.startsWith(REASONING_PREFIX)) return [];
	try {
		const parsed: unknown = JSON.parse(signature.slice(REASONING_PREFIX.length));
		return Array.isArray(parsed) ? parsed.filter(isReasoningItem) : [];
	} catch {
		return [];
	}
}

function imageContent(mimeType: string, base64: string): OpenAI.Responses.ResponseInputImage {
	return { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'auto' };
}

function userMessage(text: string, images: { mimeType: string; base64: string }[]): InputItem {
	if (!images.length) return { role: 'user', content: text };
	const content: InputContent = [];
	if (text) content.push({ type: 'input_text', text });
	content.push(...images.map((image) => imageContent(image.mimeType, image.base64)));
	return { role: 'user', content };
}

/**
 * Convert one history entry (Gemini `Content` or the legacy
 * `{role, text|message}` shape) into Responses input items. Pairing of calls
 * and responses is delegated to the shared `ToolIdLedger`, as on the Chat
 * Completions path.
 */
function convertHistoryEntry(
	entry: unknown,
	ledger: ToolIdLedger,
	providerName: string,
	logger: MappingLogger | undefined
): InputItem[] {
	const walked = walkHistoryEntry(entry, providerName);
	if (!walked) return [];

	const { calls, responses } = ledger.resolveEntry(walked.toolCalls, walked.toolResponses);
	const out: InputItem[] = [];

	if (walked.role === 'assistant') {
		// Reasoning first, then the visible text, then the calls it led to: the
		// order the model produced them in.
		out.push(...decodeResponsesReasoning(calls.find((call) => call.thoughtSignature)?.thoughtSignature));
		if (walked.hasText) out.push({ role: 'assistant', content: walked.text });
		for (const call of calls) {
			out.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) });
		}
	}

	for (const response of responses) {
		if (response.id === null) {
			logger?.log(`${providerName} history: dropping orphaned tool response`, response.name);
			continue;
		}
		out.push({
			type: 'function_call_output',
			call_id: response.id,
			// An explicit null result stays "null", as on the Chat Completions path.
			output: typeof response.response === 'string' ? response.response : JSON.stringify(response.response),
		});
	}

	if (walked.role !== 'assistant' && (walked.hasText || walked.images.length)) {
		out.push(
			walked.role === 'user' ? userMessage(walked.text, walked.images) : { role: walked.role, content: walked.text }
		);
	}
	return out;
}

/** Map plugin tool definitions to Responses function tools. */
function toResponsesTools(tools: ToolDefinition[]): FunctionTool[] {
	return tools.map((tool) => ({
		type: 'function' as const,
		name: tool.name,
		description: tool.description,
		parameters: {
			type: tool.parameters.type ?? 'object',
			properties: tool.parameters.properties ?? {},
			required: tool.parameters.required ?? [],
		},
		// The plugin's schemas aren't written for strict mode (every property
		// required, additionalProperties false), so leave it off.
		strict: false,
	}));
}

/**
 * Build the body of a Responses request for an extended (agent) turn: the
 * system instruction becomes `instructions`, history and the new user turn
 * become `input`.
 */
export function buildResponsesBody(
	model: string,
	request: ExtendedModelRequest,
	systemInstruction: string | undefined,
	providerName: string,
	logger?: MappingLogger
): OpenAI.Responses.ResponseCreateParamsNonStreaming {
	const ledger = new ToolIdLedger({
		mint: (name, seq) => `call_${name}_${seq}`,
		isValidId: (id) => SIMPLE_TOOL_ID_PATTERN.test(id),
	});
	const input: InputItem[] = [];
	for (const entry of request.conversationHistory ?? []) {
		input.push(...convertHistoryEntry(entry, ledger, providerName, logger));
	}

	const text = [request.userMessage, request.perTurnContext].filter((part) => part && part.trim()).join('\n\n');
	const images = (request.inlineAttachments ?? []).map((att) => {
		if (!att.mimeType.startsWith('image/')) {
			throw new NonRetryableRequestError(
				t('provider.unsupportedAttachment', { provider: providerName, mimeType: att.mimeType })
			);
		}
		return { mimeType: att.mimeType, base64: att.base64 };
	});
	if (text || images.length) input.push(userMessage(text, images));

	const tools = request.availableTools?.length ? toResponsesTools(request.availableTools) : undefined;
	return {
		model,
		input,
		...(systemInstruction && { instructions: systemInstruction }),
		...(tools && { tools }),
		...RESPONSES_REQUEST_OPTIONS,
		stream: false,
	};
}

function parseArguments(name: string, raw: string, logger: MappingLogger | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch (error) {
		logger?.warn(`[OpenAIClient] Failed to parse tool call arguments for ${name}:`, error);
		return {};
	}
}

/**
 * Map a completed Responses `Response` to the plugin's `ModelResponse`:
 * output text, function calls (with the turn's reasoning encoded on the
 * first), reasoning summaries as thoughts, and usage.
 */
export function responseToModelResponse(response: OpenAI.Responses.Response, logger?: MappingLogger): ModelResponse {
	if (response.status === 'failed') {
		throw new Error(response.error?.message || 'OpenAI response failed');
	}
	const textParts: string[] = [];
	const thoughts: string[] = [];
	const reasoning: ReasoningItem[] = [];
	const toolCalls: ToolCall[] = [];

	for (const item of response.output ?? []) {
		if (item.type === 'message') {
			for (const part of item.content) {
				if (part.type === 'output_text') textParts.push(part.text);
				// A refusal carries the model's explanation; show it rather than
				// an empty answer.
				else if (part.type === 'refusal') textParts.push(part.refusal);
			}
		} else if (item.type === 'function_call') {
			// A call cut off mid-generation (e.g. at the output token limit) has
			// partial arguments; never hand it to the agent as runnable.
			if (item.status === 'incomplete') {
				logger?.warn(`[OpenAIClient] Dropping incomplete tool call ${item.name}`);
				continue;
			}
			toolCalls.push({
				id: item.call_id,
				name: item.name,
				arguments: parseArguments(item.name, item.arguments, logger),
			});
		} else if (item.type === 'reasoning') {
			reasoning.push(item);
			thoughts.push(...item.summary.map((s) => s.text).filter(Boolean));
		}
	}

	const thoughtSignature = toolCalls.length ? encodeResponsesReasoning(reasoning) : undefined;
	if (thoughtSignature) toolCalls[0] = { ...toolCalls[0], thoughtSignature };

	const usage = response.usage;
	const cached = usage?.input_tokens_details?.cached_tokens;
	return {
		markdown: textParts.join(''),
		rendered: '',
		...(thoughts.length && { thoughts: thoughts.join('\n\n') }),
		...(toolCalls.length && { toolCalls }),
		...(usage && {
			usageMetadata: {
				promptTokenCount: usage.input_tokens,
				candidatesTokenCount: usage.output_tokens,
				totalTokenCount: usage.total_tokens,
				...(cached ? { cachedContentTokenCount: cached } : {}),
			},
		}),
	};
}

/**
 * Fold one streaming event into the running state. Text deltas are
 * forwarded as they arrive; the final `response.completed` (or
 * `response.incomplete`) event carries the whole response, from which tool
 * calls, reasoning and usage are taken. A failure event throws.
 */
export function applyResponsesStreamEvent(
	event: OpenAI.Responses.ResponseStreamEvent,
	state: { final?: OpenAI.Responses.Response },
	onText: (text: string) => void
): void {
	switch (event.type) {
		// A refusal streams as its own delta type; forward it like text so the
		// explanation appears in the agent view as it would on a full answer.
		case 'response.output_text.delta':
		case 'response.refusal.delta':
			if (event.delta) onText(event.delta);
			return;
		case 'response.completed':
		case 'response.incomplete':
			state.final = event.response;
			return;
		case 'response.failed':
			throw new Error(event.response.error?.message || 'OpenAI response failed');
		case 'error':
			throw new Error(event.message || 'OpenAI stream error');
		default:
			return;
	}
}
