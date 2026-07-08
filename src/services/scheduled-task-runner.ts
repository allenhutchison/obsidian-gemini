import { getActiveChatModel } from '../models';
import type { ObsidianGemini } from '../types/plugin';
import type { ScheduledTask } from './scheduled-tasks/types';
import { DestructiveAction } from '../types/agent';
import { ToolExecutionContext } from '../tools/types';
import { ModelClientFactory } from '../api';
import { ExtendedModelRequest } from '../api/interfaces/model-api';
import { resolveOutputPath, writeHeadlessOutput } from './headless-run-output';
import { formatLocalDate, formatLocalTimestamp } from '../utils/format-utils';
import { buildTurnPreamble } from '../utils/turn-preamble';
import { AgentLoop, DEFAULT_HEADLESS_MAX_ITERATIONS } from '../agent/agent-loop';
import { HeadlessConfirmationProvider } from './headless-confirmation-provider';

/**
 * Runs a single scheduled task headlessly:
 *  1. Creates a temporary agent session with the task's tool configuration
 *  2. Sends the task prompt to the model (non-streaming)
 *  3. Delegates tool-execution loop to AgentLoop (inherits thoughtSignature
 *     propagation, empty-response retry, agentEventBus events, and hook-failure
 *     isolation for free)
 *  4. Writes the final response text to the resolved outputPath
 *  5. Returns the vault path so BackgroundTaskManager can surface an "Open result" link
 */
export class ScheduledTaskRunner {
	constructor(
		private plugin: ObsidianGemini,
		private task: ScheduledTask
	) {}

	async run(isCancelled: () => boolean): Promise<string | undefined> {
		if (!this.plugin.sessionManager || !this.plugin.toolRegistry || !this.plugin.toolExecutionEngine) {
			throw new Error('[ScheduledTaskRunner] Agent services not initialised');
		}

		// Create a headless session bound to this task's tool policy. When the
		// task has no toolPolicy, the session inherits the global plugin policy
		// — the registry filter is permission-driven so a task without a policy
		// sees the same tools as an interactive agent session.
		const session = await this.plugin.sessionManager.createAgentSession(`Scheduled: ${this.task.slug}`, {
			toolPolicy: this.task.toolPolicy,
			requireConfirmation: [] as DestructiveAction[],
		});

		// Propagate the per-task model override so follow-up requests also use
		// the right model via session.modelConfig.
		if (this.task.model) {
			session.modelConfig = { model: this.task.model };
		}

		const toolContext: ToolExecutionContext = {
			plugin: this.plugin,
			session,
			featureToolPolicy: this.task.toolPolicy,
		};
		const modelApi = ModelClientFactory.createChatModel(this.plugin);
		// Headless runs auto-approve confirmations, so only expose tools the
		// user explicitly opted into (APPROVE under the layered policy).
		// ASK_USER tools are excluded — exposing them would silently bypass
		// the user's "ask first" intent because there's no UI to ask on.
		const availableTools = this.plugin.toolRegistry.getAutoApprovedTools(toolContext);

		// Prepend a turn preamble so the model has accurate "now" awareness.
		const startedAt = formatLocalTimestamp(session.created);
		const userMessage = buildTurnPreamble(formatLocalTimestamp(new Date())) + this.task.prompt;
		const model = this.task.model ?? getActiveChatModel(this.plugin.settings);

		const initialRequest: ExtendedModelRequest = {
			kind: 'extended',
			userMessage,
			conversationHistory: [],
			model,
			temperature: this.plugin.settings.temperature,
			topP: this.plugin.settings.topP,
			prompt: '',
			availableTools,
			renderContent: false,
			sessionStartedAt: startedAt,
		};

		if (isCancelled()) return undefined;
		const initialResponse = await modelApi.generateModelResponse(initialRequest);
		if (isCancelled()) return undefined;

		let finalText: string;

		if (initialResponse.toolCalls?.length) {
			// Per-task override falls back to the shared default when unset.
			const maxIterations = this.task.maxIterations ?? DEFAULT_HEADLESS_MAX_ITERATIONS;
			// Hand off to AgentLoop — handles thoughtSignature propagation,
			// history construction, follow-up requests, empty-response retry,
			// and agentEventBus events without any UI coupling.
			const loop = new AgentLoop();
			const result = await loop.run({
				initialResponse,
				initialUserMessage: userMessage,
				initialHistory: [],
				options: {
					plugin: this.plugin,
					session,
					isCancelled,
					confirmationProvider: new HeadlessConfirmationProvider(),
					maxIterations,
					featureToolPolicy: this.task.toolPolicy,
					headless: true,
				},
			});

			if (result.cancelled) return undefined;

			if (result.exhausted) {
				// Exhaustion now fires only after the soft budget's one-shot
				// extension was also spent, so the actual iteration count exceeds
				// the configured cap — report both.
				throw new Error(
					`[ScheduledTaskRunner] Task "${this.task.slug}" exhausted its tool-iteration budget ` +
						`(cap ${maxIterations}, ran ${result.iterations}) without producing a response`
				);
			}

			finalText = result.markdown;
		} else {
			finalText = initialResponse.markdown ?? '';
		}

		if (isCancelled()) return undefined;

		if (!finalText) {
			throw new Error(`[ScheduledTaskRunner] Task "${this.task.slug}" produced no response`);
		}

		// {date} is day-granular so interval tasks or multiple manual runs on the
		// same day would otherwise overwrite each other — writeHeadlessOutput
		// resolves a unique path before creating the file.
		const outputPath = resolveOutputPath(this.task.outputPath, {
			slug: this.task.slug,
			date: formatLocalDate(),
		});
		// Use JSON.stringify for YAML quoted scalars — guards against quotes or
		// backslashes in the slug or ISO timestamp breaking the frontmatter.
		const header = `---\nscheduled_task: ${JSON.stringify(this.task.slug)}\nran_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n`;
		await writeHeadlessOutput({
			vault: this.plugin.app.vault,
			outputPath,
			header,
			content: finalText,
			folderLabel: 'scheduled task output folder',
			logger: this.plugin.logger,
		});
		return outputPath;
	}
}
