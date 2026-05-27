import { Content, Part } from '@google/genai';

type OpenAiContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export interface OpenAiMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string | OpenAiContentPart[];
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

/**
 * Converts Gemini Content[] to OpenAI messages[] format.
 * Handles text, inline images, function calls, and function responses.
 */
export function convertContentToMessages(contents: Content[]): OpenAiMessage[] {
	const messages: OpenAiMessage[] = [];

	for (const content of contents) {
		const role = content.role === 'model' ? 'assistant' : (content.role as 'user' | 'system');
		const parts = content.parts || [];

		const textParts: string[] = [];
		const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
		const toolCalls: OpenAiMessage['tool_calls'] = [];
		const toolResponses: Array<{ tool_call_id: string; content: string }> = [];

		for (const part of parts) {
			if ('text' in part && typeof part.text === 'string') {
				textParts.push(part.text);
			} else if (part.inlineData) {
				imageParts.push({
					type: 'image_url',
					image_url: {
						url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
					},
				});
			} else if (part.functionCall) {
				toolCalls.push({
					id: part.functionCall.id || `call_${Math.random().toString(36).slice(2)}`,
					type: 'function',
					function: {
						name: part.functionCall.name,
						arguments: JSON.stringify(part.functionCall.args || {}),
					},
				});
			} else if (part.functionResponse) {
				toolResponses.push({
					tool_call_id: part.functionResponse.id || `call_${Math.random().toString(36).slice(2)}`,
					content:
						typeof part.functionResponse.response === 'string'
							? part.functionResponse.response
							: JSON.stringify(part.functionResponse.response),
				});
			}
		}

		// Add tool responses as separate tool messages
		for (const tr of toolResponses) {
			messages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
		}

		// Add assistant message with text and/or tool calls
		if (role === 'assistant' && (textParts.length || toolCalls.length)) {
			const message: OpenAiMessage = { role: 'assistant' };
			if (textParts.length) message.content = textParts.join('\n');
			if (toolCalls.length) message.tool_calls = toolCalls;
			messages.push(message);
		} else if (role !== 'assistant' && (textParts.length || imageParts.length)) {
			const message: OpenAiMessage = { role };
			if (imageParts.length) {
				const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
				if (textParts.length) content.push({ type: 'text', text: textParts.join('\n') });
				content.push(...imageParts);
				message.content = content;
			} else {
				message.content = textParts.join('\n');
			}
			messages.push(message);
		}
	}

	return messages;
}

/**
 * Converts an OpenAI message back to Gemini Content.
 * Note: image_url content parts are not converted back (one-way for history).
 * Tool messages are converted to functionResponse parts.
 */
export function convertMessageToContent(message: OpenAiMessage): Content {
	if (message.role === 'tool') {
		return {
			role: 'user',
			parts: [{
				functionResponse: {
					name: message.tool_call_id || 'unknown',
					response: message.content || '',
					id: message.tool_call_id,
				},
			}],
		};
	}

	const parts: Part[] = [];

	if (typeof message.content === 'string' && message.content) {
		parts.push({ text: message.content });
	} else if (Array.isArray(message.content)) {
		for (const item of message.content) {
			if (item.type === 'text') parts.push({ text: item.text });
			// image_url items are not converted back (one-way for history)
		}
	}

	if (message.tool_calls) {
		for (const tc of message.tool_calls) {
			parts.push({
				functionCall: {
					name: tc.function.name,
					args: JSON.parse(tc.function.arguments || '{}'),
					id: tc.id,
				},
			});
		}
	}

	return {
		role: message.role === 'assistant' ? 'model' : message.role === 'system' ? 'system' : 'user',
		parts,
	};
}
