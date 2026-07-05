/**
 * Common interfaces for model API implementations
 */

import { CustomPrompt } from '../../prompts/types';
import type { Content } from '@google/genai';

/**
 * Represents a response from a model.
 *
 * @property markdown - The primary text response in markdown format
 * @property rendered - Optional rendered HTML content (used for search grounding)
 * @property toolCalls - Optional array of tool/function calls requested by the model
 */
export interface ModelResponse {
	markdown: string;
	rendered: string;
	thoughts?: string;
	toolCalls?: ToolCall[];
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
		/**
		 * Portion of `promptTokenCount` served from Gemini's implicit or explicit
		 * content cache. Present on responses where the request matched a cached
		 * prefix; omitted otherwise. Used to surface caching effectiveness in the
		 * token readout UI and debug logs.
		 */
		cachedContentTokenCount?: number;
	};
}

/**
 * Represents a tool call requested by the model
 */
export interface ToolCall {
	name: string;
	arguments: Record<string, unknown>;
	id?: string;
	thoughtSignature?: string;
}

/**
 * Represents a basic request to a model.
 *
 * @property kind - Discriminant for the request union. `'base'` marks a one-shot
 *   prompt request whose full input lives in `prompt`. Required so TypeScript
 *   flags a base request that accidentally carries extended-only fields (e.g. a
 *   stray `userMessage`) instead of the union silently misrouting it at runtime
 *   (see #859).
 * @property model - Optional model identifier. If not provided, the default model will be used.
 * @property prompt - The prompt or input text for the model. Should be fully processed.
 */
export interface BaseModelRequest {
	kind: 'base';
	model?: string;
	prompt: string;
	temperature?: number;
	topP?: number;
}

/**
 * Represents an inline data attachment for multimodal input (images, audio, video, PDF)
 */
export interface InlineDataPart {
	base64: string;
	mimeType: string;
}

/**
 * Represents an extended model request with conversation history and a user message.
 *
 * @extends BaseModelRequest
 *
 * @property conversationHistory - An array representing the history of the conversation.
 * @property userMessage - The message from the user.
 * @property renderContent - Whether to render the content in responses (default: true)
 * @property customPrompt - Optional custom prompt to modify system behavior
 * @property projectInstructions - Optional project-scoped instructions injected into the system prompt
 * @property availableTools - Optional array of tool definitions for function calling
 * @property inlineAttachments - Optional array of inline data attachments for multimodal input
 * @property imageAttachments - Deprecated alias for inlineAttachments
 */
export interface ExtendedModelRequest extends Omit<BaseModelRequest, 'kind'> {
	/** Discriminant for the request union. `'extended'` marks a chat-style request. */
	kind: 'extended';
	conversationHistory: Content[];
	userMessage: string;
	renderContent?: boolean;
	customPrompt?: CustomPrompt;
	projectInstructions?: string;
	/** Optional list of skill names to include (filters available skills when a project is active) */
	projectSkills?: string[];
	availableTools?: ToolDefinition[];
	/** Per-turn context injected into the system instruction: context file list, attachment paths, rendered file contents. */
	perTurnContext?: string;
	/**
	 * Canonical, byte-stable string describing when the session started
	 * (e.g. the raw `frontmatter.created` value). Rendered verbatim into the
	 * system prompt's "This conversation started on ..." anchor. Must not be
	 * re-formatted per request — doing so would break Gemini's implicit
	 * prefix cache across tool-loop iterations and resumes.
	 */
	sessionStartedAt?: string;
	inlineAttachments?: InlineDataPart[];
	/** @deprecated Use inlineAttachments instead */
	imageAttachments?: InlineDataPart[];
}

/**
 * Represents a tool definition for function calling
 */
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

/**
 * Streaming chunk data passed to callback
 */
// knip:keep — Intentional public API structurally consumed by StreamCallback
export interface StreamChunk {
	/** Text content chunk */
	text: string;
	/** Thought/reasoning content chunk (if available) */
	thought?: string;
}

/**
 * Callback function for handling streaming responses
 *
 * @param chunk - The chunk data received from the stream
 */
export type StreamCallback = (chunk: StreamChunk) => void;

/**
 * Represents a streaming response from a model
 *
 * @property complete - Promise that resolves when streaming is complete with the full response
 * @property cancel - Function to cancel the stream
 */
export interface StreamingModelResponse {
	complete: Promise<ModelResponse>;
	cancel: () => void;
}

/**
 * Canonical discriminator for the `BaseModelRequest | ExtendedModelRequest`
 * union. Narrows on the required `kind` field. Prefer this over ad-hoc
 * `'userMessage' in request` checks, which silently misclassify a base request
 * that happens to carry a stray `userMessage` (see #859).
 */
export function isExtendedRequest(request: BaseModelRequest | ExtendedModelRequest): request is ExtendedModelRequest {
	return request.kind === 'extended';
}

/**
 * Interface for model API implementations
 */
export interface ModelApi {
	/**
	 * Generate a response from a model
	 *
	 * @param request - Either a BaseModelRequest or ExtendedModelRequest
	 * @returns A promise resolving to a ModelResponse
	 */
	generateModelResponse(request: BaseModelRequest | ExtendedModelRequest): Promise<ModelResponse>;

	/**
	 * Generate a streaming response from a model
	 *
	 * @param request - Either a BaseModelRequest or ExtendedModelRequest
	 * @param onChunk - Callback function called for each text chunk
	 * @returns A StreamingModelResponse with completion promise and cancel function
	 *
	 * @remarks
	 * Implementations that don't support streaming should fall back to
	 * non-streaming behavior by calling generateModelResponse and
	 * emitting the full response as a single chunk.
	 */
	generateStreamingResponse?(
		request: BaseModelRequest | ExtendedModelRequest,
		onChunk: StreamCallback
	): StreamingModelResponse;
}
