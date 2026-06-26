/**
 * Translation layer between the plugin's `generateContent`-shaped request/response
 * model and Google's GA Interactions API (`client.interactions.create`).
 *
 * The plugin owns conversation history (persisted as Markdown) and replays it on
 * every turn, so we drive the Interactions API **statelessly** (`store: false`,
 * no `previous_interaction_id`): the full conversation is rebuilt into the
 * `input` array of typed steps each call. See epic #1013.
 *
 * The Interactions request/response surface is snake_case (`call_id`,
 * `system_instruction`, `generation_config`, `total_input_tokens`, …), distinct
 * from the camelCase `Content` model the rest of the client uses — this module is
 * the single place that bridge lives, so the conversions stay testable in
 * isolation. Shapes are typed loosely (`Record<string, unknown>` / local
 * interfaces) on purpose: the SDK marks `interactions` experimental and several
 * step types are not exported, so we avoid hard-coupling to unstable type names.
 */
import type { Content, Part } from '@google/genai';
import type { ModelResponse, ToolCall, ToolDefinition } from '../../interfaces/model-api';
import { decodeHtmlEntities } from '../../../utils/html-entities';

/** A `Part` that may carry Gemini's thought metadata. */
interface PartWithThought extends Part {
	thought?: boolean;
	thoughtSignature?: string;
}

/** A typed step in an Interactions `input` array or response `steps` array. */
export type InteractionStep = Record<string, unknown>;

/** A typed content item (text/image/…) inside a `user_input`/`model_output` step. */
export type InteractionContentItem = Record<string, unknown>;

/**
 * MIME types the Interactions content model accepts as first-class media. Other
 * inline data is degraded to a text note so the model still sees that an
 * attachment existed rather than silently dropping it.
 */
function mediaTypeForMime(mime: string): 'image' | 'audio' | 'video' | 'document' | null {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('audio/')) return 'audio';
	if (mime.startsWith('video/')) return 'video';
	if (mime === 'application/pdf' || mime === 'text/csv') return 'document';
	return null;
}

/** Convert an inline-data part (base64 + mime) into an Interactions content item. */
function inlineDataToContentItem(mimeType: string, data: string): InteractionContentItem {
	const mediaType = mediaTypeForMime(mimeType);
	if (!mediaType) {
		return { type: 'text', text: `[attachment: ${mimeType}]` };
	}
	return { type: mediaType, data, mime_type: mimeType };
}

/** Serialize a tool's `functionResponse.response` into the `function_result.result` shape. */
function functionResponseToResult(response: unknown): InteractionContentItem[] {
	const text = typeof response === 'string' ? response : JSON.stringify(response ?? {});
	return [{ type: 'text', text }];
}

/**
 * Convert one history `Content` entry into zero or more Interactions steps.
 *
 * A single entry may contain a mix of text, inline media, function calls, and
 * function responses. Text/media collapse into one `user_input` or `model_output`
 * step (preserving the model's "say something, then call a tool" ordering by
 * emitting the content step before any call steps), while function calls/results
 * each become their own step. Model "thought" text parts are intentionally
 * dropped from replay — reasoning is reconstructed server-side and re-sending it
 * as plain output would distort the transcript.
 */
export function contentToSteps(content: Content): InteractionStep[] {
	const role = content.role === 'user' ? 'user' : 'model';
	const mediaItems: InteractionContentItem[] = [];
	const callSteps: InteractionStep[] = [];

	for (const part of content.parts ?? []) {
		const p = part as PartWithThought;
		if (p.functionCall) {
			const step: InteractionStep = {
				type: 'function_call',
				id: p.functionCall.id ?? p.functionCall.name ?? 'call',
				name: p.functionCall.name,
				arguments: p.functionCall.args ?? {},
			};
			if (p.thoughtSignature) step.signature = p.thoughtSignature;
			callSteps.push(step);
		} else if (p.functionResponse) {
			callSteps.push({
				type: 'function_result',
				call_id: p.functionResponse.id ?? p.functionResponse.name ?? 'call',
				name: p.functionResponse.name,
				result: functionResponseToResult(p.functionResponse.response),
			});
		} else if (p.inlineData?.data) {
			mediaItems.push(inlineDataToContentItem(p.inlineData.mimeType ?? 'application/octet-stream', p.inlineData.data));
		} else if (typeof p.text === 'string' && p.text.length > 0 && !p.thought) {
			mediaItems.push({ type: 'text', text: p.text });
		}
	}

	const steps: InteractionStep[] = [];
	if (mediaItems.length > 0) {
		steps.push({ type: role === 'user' ? 'user_input' : 'model_output', content: mediaItems });
	}
	steps.push(...callSteps);
	return steps;
}

/** Build a `user_input` step for the current turn (message + per-turn context + attachments). */
export function buildUserInputStep(
	userMessage: string | undefined,
	perTurnContext: string | undefined,
	attachments: Array<{ base64: string; mimeType: string }>
): InteractionStep | null {
	const content: InteractionContentItem[] = [];
	if (userMessage && userMessage.trim()) content.push({ type: 'text', text: userMessage });
	if (perTurnContext && perTurnContext.trim()) content.push({ type: 'text', text: perTurnContext });
	for (const attachment of attachments) {
		content.push(inlineDataToContentItem(attachment.mimeType, attachment.base64));
	}
	return content.length > 0 ? { type: 'user_input', content } : null;
}

/** Map our tool definitions to flat Interactions `function` tool declarations. */
export function toolsToInteractionTools(tools: ToolDefinition[]): InteractionStep[] {
	return tools.map((tool) => ({
		type: 'function',
		name: tool.name,
		description: tool.description,
		parameters: {
			type: 'object',
			properties: tool.parameters.properties || {},
			required: tool.parameters.required || [],
		},
	}));
}

/** Pull the concatenated text out of a step's `content` array. */
function textFromContentArray(content: unknown): string {
	if (!Array.isArray(content)) return '';
	return content
		.filter((item): item is { type: string; text: string } => {
			const i = item as { type?: string; text?: unknown };
			return i.type === 'text' && typeof i.text === 'string';
		})
		.map((item) => item.text)
		.join('');
}

/**
 * Extract a `ModelResponse` from a completed `Interaction`.
 *
 * Prefers the SDK's `output_text` convenience for the final answer, falling back
 * to scanning trailing `model_output` steps. Thought summaries, tool calls, and
 * token usage are read directly off the `steps`/`usage` surface.
 */
export function extractModelResponseFromInteraction(interaction: Record<string, unknown>): ModelResponse {
	const steps = Array.isArray(interaction.steps) ? (interaction.steps as InteractionStep[]) : [];

	let markdown = typeof interaction.output_text === 'string' ? interaction.output_text : '';
	let thoughts = '';
	const toolCalls: ToolCall[] = [];

	for (const step of steps) {
		const type = step.type as string;
		if (type === 'model_output' && !markdown) {
			markdown += textFromContentArray(step.content);
		} else if (type === 'thought') {
			thoughts += textFromContentArray(step.summary);
		} else if (type === 'function_call') {
			toolCalls.push({
				name: String(step.name ?? ''),
				arguments: (step.arguments as Record<string, unknown>) ?? {},
				id: typeof step.id === 'string' ? step.id : undefined,
				thoughtSignature: typeof step.signature === 'string' ? step.signature : undefined,
			});
		}
	}

	markdown = decodeHtmlEntities(markdown);

	const usage = interaction.usage as Record<string, number> | undefined;
	const response: ModelResponse = {
		markdown,
		rendered: '', // search grounding is Phase 3 (#1016)
	};
	if (thoughts) response.thoughts = thoughts;
	if (toolCalls.length > 0) response.toolCalls = toolCalls;
	if (usage) {
		response.usageMetadata = {
			promptTokenCount: usage.total_input_tokens,
			candidatesTokenCount: usage.total_output_tokens,
			totalTokenCount: usage.total_tokens,
			cachedContentTokenCount: usage.total_cached_tokens,
		};
	}
	return response;
}
