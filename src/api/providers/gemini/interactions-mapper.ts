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
import type { Content } from '@google/genai';
import type { ModelResponse, ToolCall, ToolDefinition } from '../../interfaces/model-api';
import { decodeHtmlEntities } from '../../../utils/html-entities';
import { asRecord } from '../../../utils/error-utils';
import { renderGroundingSources } from './grounding-render';

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

/**
 * Serialize a tool's `functionResponse.response` into the `function_result.result`
 * shape. Always a plain string: the content-array form (`[{type:'text',…}]`) is a
 * "multimodal function response", which Gemini 2.5 models reject with a 400
 * ("Multimodal function responses are not supported for this model"). The string
 * form is accepted by both 2.5 and 3.x, so it's used unconditionally.
 */
function functionResponseToResult(response: unknown): string {
	return typeof response === 'string' ? response : JSON.stringify(response ?? {});
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
		if (part.functionCall) {
			const step: InteractionStep = {
				type: 'function_call',
				id: part.functionCall.id ?? part.functionCall.name ?? 'call',
				name: part.functionCall.name,
				arguments: part.functionCall.args ?? {},
			};
			if (part.thoughtSignature) step.signature = part.thoughtSignature;
			callSteps.push(step);
		} else if (part.functionResponse) {
			callSteps.push({
				type: 'function_result',
				call_id: part.functionResponse.id ?? part.functionResponse.name ?? 'call',
				name: part.functionResponse.name,
				result: functionResponseToResult(part.functionResponse.response),
			});
		} else if (part.inlineData?.data) {
			mediaItems.push(
				inlineDataToContentItem(part.inlineData.mimeType ?? 'application/octet-stream', part.inlineData.data)
			);
		} else if (typeof part.text === 'string' && part.text.length > 0 && !part.thought) {
			mediaItems.push({ type: 'text', text: part.text });
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
/** A grounding source surfaced as an inline `url_citation` annotation. */
interface GroundingSource {
	url: string;
	title?: string;
}

/** Collect deduped `url_citation` annotations into `into` (keyed by URL, first title wins). */
function collectUrlCitations(annotations: unknown, into: Map<string, GroundingSource>): void {
	if (!Array.isArray(annotations)) return;
	for (const annotation of annotations) {
		const a = annotation as { type?: string; url?: string; title?: string };
		if (a.type === 'url_citation' && typeof a.url === 'string' && a.url && !into.has(a.url)) {
			into.set(a.url, { url: a.url, title: a.title });
		}
	}
}

/** Collect `url_citation` annotations from the text items of a step's `content` array. */
function collectCitationsFromContent(content: unknown, into: Map<string, GroundingSource>): void {
	if (!Array.isArray(content)) return;
	for (const item of content) {
		const i = item as { type?: string; annotations?: unknown };
		if (i.type === 'text') collectUrlCitations(i.annotations, into);
	}
}

export function extractModelResponseFromInteraction(interaction: Record<string, unknown>): ModelResponse {
	const steps = Array.isArray(interaction.steps) ? (interaction.steps as InteractionStep[]) : [];

	let markdown = typeof interaction.output_text === 'string' ? interaction.output_text : '';
	let thoughts = '';
	const toolCalls: ToolCall[] = [];
	const sources = new Map<string, GroundingSource>();

	for (const step of steps) {
		const type = step.type as string;
		if (type === 'model_output') {
			if (!markdown) markdown += textFromContentArray(step.content);
			// Grounding sources arrive as inline url_citation annotations on the
			// model output text, not as a separate chunks list (see #1016).
			collectCitationsFromContent(step.content, sources);
		} else if (type === 'thought') {
			thoughts += textFromContentArray(step.summary);
		} else if (type === 'function_call') {
			toolCalls.push({
				name: typeof step.name === 'string' ? step.name : '',
				arguments: (step.arguments as Record<string, unknown>) ?? {},
				id: typeof step.id === 'string' ? step.id : undefined,
				thoughtSignature: typeof step.signature === 'string' ? step.signature : undefined,
			});
		}
	}

	markdown = decodeHtmlEntities(markdown);

	const response: ModelResponse = {
		markdown,
		rendered: renderGroundingSources([...sources.values()]),
	};
	if (thoughts) response.thoughts = thoughts;
	if (toolCalls.length > 0) response.toolCalls = toolCalls;
	const usageMetadata = mapInteractionUsage(interaction.usage);
	if (usageMetadata) response.usageMetadata = usageMetadata;
	return response;
}

/** Map an Interactions `usage` object to our `ModelResponse.usageMetadata` shape. */
function mapInteractionUsage(usage: unknown): ModelResponse['usageMetadata'] | undefined {
	if (!usage || typeof usage !== 'object') return undefined;
	const u = usage as Record<string, number>;
	return {
		promptTokenCount: u.total_input_tokens,
		candidatesTokenCount: u.total_output_tokens,
		totalTokenCount: u.total_tokens,
		cachedContentTokenCount: u.total_cached_tokens,
	};
}

/** A streamed Interactions SSE event (loosely typed; see `StepDelta`/`InteractionCompletedEvent`). */
export type InteractionStreamEvent = Record<string, unknown>;

/** A chunk to surface to the streaming callback (mirrors `StreamChunk`). */
export interface InteractionStreamChunk {
	text: string;
	thought?: string;
}

/** In-flight function-call step being assembled from `step.start` + `arguments_delta` fragments. */
interface PendingToolCall {
	id?: string;
	name: string;
	signature?: string;
	/** Concatenated `arguments_delta` fragments (a JSON string once complete). */
	argsBuffer: string;
	/** Whole arguments object from `step.start`, used when no `arguments_delta` arrives. */
	seedArgs?: Record<string, unknown>;
}

/**
 * Accumulates Interactions streaming events into a final `ModelResponse`.
 *
 * The step-based stream interleaves: `step.start` (carries the full `Step`, so a
 * `function_call` step's id/name/signature land here), `step.delta` (incremental
 * `text`, `thought_summary`, or `arguments_delta`), `step.stop` (finalizes a
 * step), and `interaction.completed` (final `usage`). Function-call arguments
 * arrive as `arguments_delta` string fragments keyed by step `index` and are
 * JSON-parsed once the step stops.
 *
 * Kept free of SDK/DOM dependencies so it is unit-testable with plain event
 * objects. `handleEvent` returns the chunk to emit (or null); `finalize` builds
 * the response once the stream ends.
 */
export class InteractionStreamAccumulator {
	private text = '';
	private thoughts = '';
	private usage: ModelResponse['usageMetadata'] | undefined;
	private readonly pending = new Map<number, PendingToolCall>();
	private readonly toolCalls: ToolCall[] = [];
	private readonly sources = new Map<string, GroundingSource>();

	/** Process one streamed event; returns a chunk to emit, or null if nothing to surface. */
	handleEvent(event: InteractionStreamEvent): InteractionStreamChunk | null {
		const eventType = event.event_type as string | undefined;

		if (eventType === 'step.start') {
			const step = event.step as Record<string, unknown> | undefined;
			if (step?.type === 'function_call') {
				const index = event.index as number;
				this.pending.set(index, {
					id: typeof step.id === 'string' ? step.id : undefined,
					name: typeof step.name === 'string' ? step.name : '',
					signature: typeof step.signature === 'string' ? step.signature : undefined,
					argsBuffer: '',
					seedArgs:
						step.arguments && typeof step.arguments === 'object'
							? (step.arguments as Record<string, unknown>)
							: undefined,
				});
			}
			return null;
		}

		if (eventType === 'step.delta') {
			return this.handleDelta(event);
		}

		if (eventType === 'step.stop') {
			this.finalizeStep(event.index as number);
			return null;
		}

		if (eventType === 'interaction.completed') {
			const interaction = event.interaction as Record<string, unknown> | undefined;
			const usage = mapInteractionUsage(interaction?.usage);
			if (usage) this.usage = usage;
			return null;
		}

		return null;
	}

	private handleDelta(event: InteractionStreamEvent): InteractionStreamChunk | null {
		const delta = event.delta as Record<string, unknown> | undefined;
		if (!delta) return null;

		switch (delta.type) {
			case 'text': {
				const text = decodeHtmlEntities(typeof delta.text === 'string' ? delta.text : '');
				if (!text) return null;
				this.text += text;
				return { text };
			}
			case 'thought_summary': {
				const content = delta.content as { text?: string } | undefined;
				const thought = content?.text ?? '';
				if (!thought) return null;
				this.thoughts += thought;
				return { text: '', thought };
			}
			case 'arguments_delta': {
				const pending = this.pending.get(event.index as number);
				if (pending && typeof delta.arguments === 'string') {
					pending.argsBuffer += delta.arguments;
				}
				return null;
			}
			case 'text_annotation_delta': {
				// Grounding sources stream as url_citation annotations (#1016).
				collectUrlCitations(delta.annotations, this.sources);
				return null;
			}
			default:
				return null;
		}
	}

	/** Finalize a function-call step into a `ToolCall` when its step stops. */
	private finalizeStep(index: number): void {
		const pending = this.pending.get(index);
		if (!pending) return;
		this.pending.delete(index);

		let args: Record<string, unknown> = pending.seedArgs ?? {};
		if (pending.argsBuffer) {
			try {
				args = asRecord(JSON.parse(pending.argsBuffer));
			} catch {
				// Keep the seed args (or empty) if the streamed fragments aren't valid JSON.
			}
		}

		this.toolCalls.push({
			name: pending.name,
			arguments: args,
			id: pending.id,
			thoughtSignature: pending.signature,
		});
	}

	/** Build the final response once the stream is exhausted (flushing any unstopped steps). */
	finalize(): ModelResponse {
		for (const index of [...this.pending.keys()]) {
			this.finalizeStep(index);
		}

		const response: ModelResponse = {
			markdown: this.text,
			rendered: renderGroundingSources([...this.sources.values()]),
		};
		if (this.thoughts) response.thoughts = this.thoughts;
		if (this.toolCalls.length > 0) response.toolCalls = this.toolCalls;
		if (this.usage) response.usageMetadata = this.usage;
		return response;
	}
}
