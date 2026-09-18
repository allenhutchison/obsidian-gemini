import { describe, test, expect, vi } from 'vitest';
import type { Content } from '@google/genai';
import {
	buildFollowUpRequest,
	buildRetryRequest,
	buildEmptyResponseMessage,
} from '../../../src/ui/agent-view/agent-view-tool-followup';
import { buildToolHistoryTurns, type ToolCallResultPair } from '../../../src/agent/agent-loop-helpers';
import type { ToolCall } from '../../../src/api/interfaces/model-api';

const PER_TURN_CONTEXT = 'CONTEXT FILES: probe note content with unique facts';

function makePlugin() {
	return {
		settings: {
			features: {
				chat: { provider: 'gemini', model: 'gemini-3-flash-preview' },
				summary: { provider: 'gemini', model: '' },
				completions: { provider: 'gemini', model: '' },
				rewrite: { provider: 'gemini', model: '' },
				webSearch: { provider: 'gemini', model: '' },
				deepResearch: { provider: 'gemini', model: '' },
				rag: { provider: 'gemini', model: '' },
				imageGen: { provider: 'gemini', model: '' },
			},
		},
		toolRegistry: {
			getEnabledTools: vi.fn().mockReturnValue([{ name: 'read_file' }]),
			getAutoApprovedTools: vi.fn().mockReturnValue([{ name: 'read_file' }]),
		},
	} as any;
}

const currentSession = { modelConfig: {} } as any;

// Count text parts across a Content[] that exactly equal the per-turn context.
function countContextOccurrences(history: Content[]): number {
	return history.flatMap((c) => c.parts ?? []).filter((p) => 'text' in p && p.text === PER_TURN_CONTEXT).length;
}

describe('buildFollowUpRequest / buildRetryRequest — perTurnContext is not duplicated', () => {
	const conversationHistory: Content[] = [{ role: 'user', parts: [{ text: 'prior turn' }] }];
	const toolCall: ToolCall = { name: 'read_file', arguments: { path: 'a.md' } };
	const toolResult: ToolCallResultPair = {
		toolName: 'read_file',
		toolArguments: { path: 'a.md' },
		result: { success: true, data: { content: 'x' } },
	};

	// buildToolHistoryTurns splices perTurnContext into the user turn — so the
	// follow-up/retry requests must NOT carry it again, or buildContents would
	// append a second copy.
	const updatedHistory = buildToolHistoryTurns({
		conversationHistory,
		userMessage: 'user query',
		perTurnContext: PER_TURN_CONTEXT,
		toolCalls: [toolCall],
		toolResults: [toolResult],
	});

	test('buildToolHistoryTurns already embeds the context exactly once', () => {
		expect(countContextOccurrences(updatedHistory)).toBe(1);
	});

	test('buildFollowUpRequest omits perTurnContext and preserves it in history', () => {
		const request = buildFollowUpRequest({
			plugin: makePlugin(),
			currentSession,
			updatedHistory,
			perTurnContext: PER_TURN_CONTEXT,
		});

		// Omitted from the request so buildContents cannot re-append it.
		expect(request.perTurnContext).toBeUndefined();
		// Still reaches the model — once — via conversation history.
		expect(request.conversationHistory).toBe(updatedHistory);
		expect(countContextOccurrences(request.conversationHistory)).toBe(1);
	});

	test('buildRetryRequest omits perTurnContext and preserves it in history', () => {
		const request = buildRetryRequest({
			plugin: makePlugin(),
			currentSession,
			updatedHistory,
			perTurnContext: PER_TURN_CONTEXT,
		});

		expect(request.perTurnContext).toBeUndefined();
		expect(request.conversationHistory).toBe(updatedHistory);
		expect(countContextOccurrences(request.conversationHistory)).toBe(1);
	});
});

// The fallback markdown is rendered straight into the chat. Since #1391 it comes from t(),
// so these assert the message a user actually sees — a missing key or a broken placeholder
// would surface here as a raw key or an unfilled {tools}.
describe('buildEmptyResponseMessage — localized fallback text', () => {
	function pluginWithTools(displayNames: Record<string, string>) {
		return {
			toolRegistry: {
				getTool: (name: string) => (displayNames[name] ? { displayName: displayNames[name] } : undefined),
			},
		} as any;
	}

	test('lists the executed tool display names', () => {
		const message = buildEmptyResponseMessage(
			[
				{ toolName: 'read_file', result: { success: true } },
				{ toolName: 'write_file', result: { success: true } },
			],
			pluginWithTools({ read_file: 'Read File', write_file: 'Write File' })
		);

		expect(message).toBe(
			'I completed the requested actions (Read File, Write File) but had trouble generating a summary. The operations were successful.'
		);
	});

	test('omits the tool list when no tool succeeded', () => {
		const message = buildEmptyResponseMessage(
			[{ toolName: 'read_file', result: { success: false } }],
			pluginWithTools({ read_file: 'Read File' })
		);

		expect(message).toBe(
			'I completed the requested actions but had trouble generating a summary. The operations were successful.'
		);
	});
});
