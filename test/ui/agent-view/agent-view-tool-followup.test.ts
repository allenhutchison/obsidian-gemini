import { describe, test, expect, vi } from 'vitest';
import type { Content } from '@google/genai';
import { buildFollowUpRequest, buildRetryRequest } from '../../../src/ui/agent-view/agent-view-tool-followup';
import { buildToolHistoryTurns, type ToolCallResultPair } from '../../../src/agent/agent-loop-helpers';
import type { ToolCall } from '../../../src/api/interfaces/model-api';

const PER_TURN_CONTEXT = 'CONTEXT FILES: probe note content with unique facts';

function makePlugin() {
	return {
		settings: { chatModelName: 'gemini-3-flash-preview', temperature: 0.7, topP: 0.95 },
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
		result: { success: true, data: { content: 'x' } } as any,
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
		expect(countContextOccurrences(request.conversationHistory as Content[])).toBe(1);
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
		expect(countContextOccurrences(request.conversationHistory as Content[])).toBe(1);
	});
});
