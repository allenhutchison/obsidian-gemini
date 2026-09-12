import { describe, test, expect, vi } from 'vitest';
import { AgentViewTools } from '../../../src/ui/agent-view/agent-view-tools';
import type { StreamChunk } from '../../../src/api/interfaces/model-api';

// `AgentLoop` picks its streaming follow-up branch purely from the presence of
// the `onFollowUpChunk` hook, so the "Enable streaming" setting can only reach
// post-tool responses by withholding the hooks. These tests drive that decision
// directly: constructing the full adapter would need a live view + chat DOM,
// and the branch under test is a pure function of the setting.
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
 * Build an `AgentViewTools` probe with `settings.streamingEnabled` set to the
 * given value and the three context callbacks the streaming hooks touch stubbed.
 * The instance is created off the prototype so no chat container, view, or DOM
 * is needed — `followUpStreamingHooks` reads only the setting and `context`.
 *
 * @param streamingEnabled - Value for `plugin.settings.streamingEnabled`;
 *   `undefined` models a settings object saved before the toggle existed.
 * @returns The probe plus the stub callbacks, for asserting what the hooks call.
 */
function makeTools(streamingEnabled: boolean | undefined) {
	const tools = Object.create(AgentViewTools.prototype) as ToolsProbe;
	const registerFollowUpStream = vi.fn();
	const createFollowUpStream = vi.fn().mockReturnValue(null);
	const updateProgress = vi.fn();
	tools.plugin = { settings: { streamingEnabled } };
	tools.context = { registerFollowUpStream, createFollowUpStream, updateProgress };
	tools.streamingFollowUpContainer = null;
	return { tools, registerFollowUpStream, createFollowUpStream, updateProgress };
}

describe('AgentViewTools.followUpStreamingHooks — honours the streaming setting', () => {
	test('streaming on: supplies both follow-up streaming hooks', () => {
		const { tools } = makeTools(true);
		const hooks = tools.followUpStreamingHooks();

		expect(typeof hooks.onFollowUpChunk).toBe('function');
		expect(typeof hooks.onFollowUpStreamReady).toBe('function');
	});

	test('streaming off: supplies neither, so AgentLoop takes its non-streaming branch', () => {
		const { tools } = makeTools(false);
		const hooks = tools.followUpStreamingHooks();

		// Presence is the signal AgentLoop reads — an explicit `undefined` value
		// would still be an own key, so assert the keys are absent entirely.
		expect(Object.keys(hooks)).toEqual([]);
		expect('onFollowUpChunk' in hooks).toBe(false);
		expect('onFollowUpStreamReady' in hooks).toBe(false);
	});

	test('setting absent (pre-migration data): defaults to streaming, matching the initial request', () => {
		const { tools } = makeTools(undefined);
		const hooks = tools.followUpStreamingHooks();

		expect(typeof hooks.onFollowUpChunk).toBe('function');
	});

	test('the supplied onFollowUpStreamReady still routes the stream to the Stop target', () => {
		const { tools, registerFollowUpStream } = makeTools(true);
		const hooks = tools.followUpStreamingHooks();
		const stream = { cancel: vi.fn() };

		(hooks.onFollowUpStreamReady as (s: unknown) => void)(stream);
		expect(registerFollowUpStream).toHaveBeenCalledWith(stream);
	});

	test('the supplied onFollowUpChunk ignores whitespace-only text before opening a container', () => {
		const { tools, createFollowUpStream } = makeTools(true);
		const hooks = tools.followUpStreamingHooks();

		(hooks.onFollowUpChunk as (c: StreamChunk) => void)({ text: '   ' });
		expect(createFollowUpStream).not.toHaveBeenCalled();

		(hooks.onFollowUpChunk as (c: StreamChunk) => void)({ text: 'answer' });
		expect(createFollowUpStream).toHaveBeenCalled();
	});
});
