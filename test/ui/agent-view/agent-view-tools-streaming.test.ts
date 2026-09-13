import { describe, test, expect, vi } from 'vitest';
import { AgentViewTools } from '../../../src/ui/agent-view/agent-view-tools';
import type { StreamChunk } from '../../../src/api/interfaces/model-api';

// `AgentLoop` picks its streaming follow-up branch purely from the presence of
// the `onFollowUpChunk` hook. The plugin always streams when the provider
// client supports it (there is no user-facing toggle), so
// `followUpStreamingHooks` always supplies both hooks. These tests drive that
// directly: constructing the full adapter would need a live view + chat DOM.
// The members below are private on AgentViewTools, so the probe is typed as a
// standalone shape rather than an intersection with the class (intersecting a
// private member reduces the type to `never`).
interface ToolsProbe {
	plugin: unknown;
	context: unknown;
	streamingFollowUpContainer: HTMLElement | null;
	followUpStreamingHooks(): Record<string, unknown>;
}

/**
 * Build an `AgentViewTools` probe with the three context callbacks the
 * streaming hooks touch stubbed. The instance is created off the prototype so
 * no chat container, view, or DOM is needed — `followUpStreamingHooks` reads
 * only `context`.
 *
 * @returns The probe plus the stub callbacks, for asserting what the hooks call.
 */
function makeTools() {
	const tools = Object.create(AgentViewTools.prototype) as ToolsProbe;
	const registerFollowUpStream = vi.fn();
	const createFollowUpStream = vi.fn().mockReturnValue(null);
	const updateProgress = vi.fn();
	tools.plugin = {};
	tools.context = { registerFollowUpStream, createFollowUpStream, updateProgress };
	tools.streamingFollowUpContainer = null;
	return { tools, registerFollowUpStream, createFollowUpStream, updateProgress };
}

describe('AgentViewTools.followUpStreamingHooks — always streams follow-ups', () => {
	test('supplies both follow-up streaming hooks', () => {
		const { tools } = makeTools();
		const hooks = tools.followUpStreamingHooks();

		expect(typeof hooks.onFollowUpChunk).toBe('function');
		expect(typeof hooks.onFollowUpStreamReady).toBe('function');
	});

	test('the supplied onFollowUpStreamReady still routes the stream to the Stop target', () => {
		const { tools, registerFollowUpStream } = makeTools();
		const hooks = tools.followUpStreamingHooks();
		const stream = { cancel: vi.fn() };

		(hooks.onFollowUpStreamReady as (s: unknown) => void)(stream);
		expect(registerFollowUpStream).toHaveBeenCalledWith(stream);
	});

	test('the supplied onFollowUpChunk ignores whitespace-only text before opening a container', () => {
		const { tools, createFollowUpStream } = makeTools();
		const hooks = tools.followUpStreamingHooks();

		(hooks.onFollowUpChunk as (c: StreamChunk) => void)({ text: '   ' });
		expect(createFollowUpStream).not.toHaveBeenCalled();

		(hooks.onFollowUpChunk as (c: StreamChunk) => void)({ text: 'answer' });
		expect(createFollowUpStream).toHaveBeenCalled();
	});
});
