import { getActiveChatModel } from '../models';
import type { ObsidianGemini } from '../types/plugin';
import type { FeatureToolPolicy } from '../types/tool-policy';
import { DestructiveAction } from '../types/agent';
import { ToolExecutionContext } from '../tools/types';
import { ModelClientFactory } from '../api';
import { ExtendedModelRequest } from '../api/interfaces/model-api';
import { formatLocalTimestamp } from '../utils/format-utils';
import { buildTurnPreamble } from '../utils/turn-preamble';
import { AgentLoop, DEFAULT_HEADLESS_MAX_ITERATIONS } from '../agent/agent-loop';
import { HeadlessConfirmationProvider } from './headless-confirmation-provider';

/**
 * Shared driver for a single headless agent turn, used by both
 * `ScheduledTaskRunner` and `HookRunner`.
 *
 * Both callers need exactly the same thing — create a temporary session under a
 * feature tool policy, send one non-streaming request, hand any tool calls to
 * `AgentLoop`, and come back with the final text — and the two copies had
 * already drifted in wording. Keeping the whole span here means a change to
 * headless turn semantics (a new `ExtendedModelRequest` field, a different
 * tool-exposure rule, a cancellation-check placement) is made once.
 *
 * What deliberately stays with the callers: the output write. The scheduled task
 * always writes its result and treats empty output as a failure; a hook writes
 * only when `outputPath` is set and treats empty output as a silent no-op. Those
 * differences are real, and `headless-run-output.ts` already shares the
 * mechanical parts.
 *
 * This is a leaf module: it imports the session/factory/loop layers and nothing
 * imports the runners back, per the shared-leaf-helper rule in `coding.md`.
 */
export interface HeadlessAgentTurnSpec {
	/** Session title, e.g. `Scheduled: my-task` or `Hook: my-hook`. */
	sessionLabel: string;
	/** Log/error prefix identifying the caller, e.g. `[ScheduledTaskRunner]`. */
	logPrefix: string;
	/** Noun used in the exhaustion error, e.g. `Task` or `Hook`. */
	subjectNoun: string;
	/** Human-readable identifier of the unit of work, used in error messages. */
	subjectName: string;
	/** The prompt to send. Callers render any templates before handing it over. */
	prompt: string;
	/** Per-feature tool policy; when unset the session inherits the global policy. */
	toolPolicy?: FeatureToolPolicy;
	/** Model override; falls back to the active chat model. */
	model?: string;
	/** Tool-iteration cap; falls back to `DEFAULT_HEADLESS_MAX_ITERATIONS`. */
	maxIterations?: number;
	/**
	 * Skill include-list passed through to the model API. An empty or absent
	 * list means "no filter" — the run sees every available skill.
	 */
	projectSkills?: string[];
}

/**
 * Drive one headless agent turn to completion.
 *
 * @returns the final response text, or `undefined` if the run was cancelled.
 * @throws if agent services are not initialised, or if the tool-iteration
 *         budget is exhausted without producing a response.
 */
export async function runHeadlessAgentTurn(
	plugin: ObsidianGemini,
	spec: HeadlessAgentTurnSpec,
	isCancelled: () => boolean
): Promise<string | undefined> {
	if (!plugin.sessionManager || !plugin.toolRegistry || !plugin.toolExecutionEngine) {
		throw new Error(`${spec.logPrefix} Agent services not initialised`);
	}

	// Create a headless session bound to the caller's tool policy. When there is
	// no policy, the session inherits the global plugin policy — the registry
	// filter is permission-driven, so a run without a policy sees the same tools
	// as an interactive agent session.
	const session = await plugin.sessionManager.createAgentSession(spec.sessionLabel, {
		toolPolicy: spec.toolPolicy,
		requireConfirmation: [] as DestructiveAction[],
	});

	// Propagate the per-run model override so follow-up requests also use the
	// right model via session.modelConfig.
	if (spec.model) {
		session.modelConfig = { model: spec.model };
	}

	const toolContext: ToolExecutionContext = {
		plugin,
		session,
		featureToolPolicy: spec.toolPolicy,
	};
	const modelApi = ModelClientFactory.createChatModel(plugin);
	// Headless runs auto-approve confirmations, so only expose tools the user
	// explicitly opted into (APPROVE under the layered policy). ASK_USER tools
	// are excluded — exposing them would silently bypass the user's "ask first"
	// intent because there's no UI to ask on. To allow an ASK_USER tool in a
	// headless run, the run's toolPolicy must explicitly upgrade it (preset or
	// per-tool override).
	const availableTools = plugin.toolRegistry.getAutoApprovedTools(toolContext);

	// Prepend a turn preamble so the model has accurate "now" awareness.
	const startedAt = formatLocalTimestamp(session.created);
	const userMessage = buildTurnPreamble(formatLocalTimestamp(new Date())) + spec.prompt;
	const model = spec.model ?? getActiveChatModel(plugin.settings);

	const initialRequest: ExtendedModelRequest = {
		kind: 'extended',
		userMessage,
		conversationHistory: [],
		model,
		temperature: plugin.settings.temperature,
		topP: plugin.settings.topP,
		prompt: '',
		availableTools,
		renderContent: false,
		sessionStartedAt: startedAt,
		// The model API uses projectSkills as its include-list when filtering the
		// registered skill set. Empty list ⇒ no filter, so the run sees every
		// available skill (matches the documented "leave blank to inherit"
		// semantics).
		projectSkills: spec.projectSkills?.length ? spec.projectSkills : undefined,
	};

	if (isCancelled()) return undefined;
	const initialResponse = await modelApi.generateModelResponse(initialRequest);
	if (isCancelled()) return undefined;

	if (!initialResponse.toolCalls?.length) {
		return initialResponse.markdown ?? '';
	}

	// Per-run override falls back to the shared headless default when unset.
	const maxIterations = spec.maxIterations ?? DEFAULT_HEADLESS_MAX_ITERATIONS;
	// Hand off to AgentLoop — handles thoughtSignature propagation, history
	// construction, follow-up requests, empty-response retry, and agentEventBus
	// events without any UI coupling.
	const loop = new AgentLoop();
	const result = await loop.run({
		initialResponse,
		initialUserMessage: userMessage,
		initialHistory: [],
		options: {
			plugin,
			session,
			isCancelled,
			confirmationProvider: new HeadlessConfirmationProvider(),
			maxIterations,
			featureToolPolicy: spec.toolPolicy,
			headless: true,
		},
	});

	if (result.cancelled) return undefined;

	if (result.exhausted) {
		// Exhaustion fires only after the soft budget's one-shot extension was
		// also spent, so the actual iteration count exceeds the configured cap —
		// report both.
		throw new Error(
			`${spec.logPrefix} ${spec.subjectNoun} "${spec.subjectName}" exhausted its tool-iteration budget ` +
				`(cap ${maxIterations}, ran ${result.iterations}) without producing a response`
		);
	}

	return result.markdown;
}
