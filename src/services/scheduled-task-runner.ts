import { normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import type { ScheduledTask } from './scheduled-task-manager';
import { ToolCategory, DestructiveAction } from '../types/agent';
import { ToolExecutionContext } from '../tools/types';
import { GeminiClientFactory } from '../api';
import { ExtendedModelRequest } from '../api/interfaces/model-api';
import { ensureFolderExists } from '../utils/file-utils';
import { formatLocalDate, formatLocalTimestamp } from '../utils/format-utils';
import { buildTurnPreamble } from '../utils/turn-preamble';
import { AgentLoop } from '../agent/agent-loop';

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

		// Map task's enabledTools strings to ToolCategory enum values,
		// defaulting to read-only when the list is empty.
		const enabledToolCategories =
			this.task.enabledTools.length > 0 ? (this.task.enabledTools as ToolCategory[]) : [ToolCategory.READ_ONLY];

		// Create a headless session — no confirmation required.
		const session = await this.plugin.sessionManager.createAgentSession(`Scheduled: ${this.task.slug}`, {
			enabledTools: enabledToolCategories,
			requireConfirmation: [] as DestructiveAction[],
		});

		// Propagate the per-task model override so follow-up requests also use
		// the right model via session.modelConfig.
		if (this.task.model) {
			session.modelConfig = { model: this.task.model };
		}

		const toolContext: ToolExecutionContext = { plugin: this.plugin, session };
		const modelApi = GeminiClientFactory.createChatModel(this.plugin);
		const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);

		// Prepend a turn preamble so the model has accurate "now" awareness.
		const startedAt = formatLocalTimestamp(session.created);
		const userMessage = buildTurnPreamble(formatLocalTimestamp(new Date())) + this.task.prompt;
		const model = this.task.model ?? this.plugin.settings.chatModelName;

		const initialRequest: ExtendedModelRequest = {
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
					maxIterations: 20,
				},
			});

			if (result.cancelled) return undefined;

			if (result.exhausted) {
				throw new Error(
					`[ScheduledTaskRunner] Task "${this.task.slug}" exhausted 20 tool iterations without producing a response`
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

		const outputPath = this.resolveOutputPath();
		await this.writeOutput(outputPath, finalText);
		return outputPath;
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	private resolveOutputPath(): string {
		const date = formatLocalDate();
		// Use split/join instead of replace() to avoid $& / $$ special replacement
		// sequences if the slug or date string ever contains a dollar sign.
		const resolved = this.task.outputPath.split('{slug}').join(this.task.slug).split('{date}').join(date);
		return normalizePath(resolved);
	}

	private async writeOutput(outputPath: string, content: string): Promise<void> {
		// Resolve a unique path — {date} is day-granular so interval tasks or
		// multiple manual runs on the same day would otherwise overwrite each other.
		const uniquePath = this.resolveUniquePath(outputPath);

		const parentPath = uniquePath.includes('/') ? uniquePath.slice(0, uniquePath.lastIndexOf('/')) : null;
		if (parentPath) {
			await ensureFolderExists(this.plugin.app.vault, parentPath, 'scheduled task output folder', this.plugin.logger);
		}

		const ranAt = new Date().toISOString();
		// Use JSON.stringify for YAML quoted scalars — guards against quotes or
		// backslashes in the slug or ISO timestamp breaking the frontmatter.
		const header = `---\nscheduled_task: ${JSON.stringify(this.task.slug)}\nran_at: ${JSON.stringify(ranAt)}\n---\n\n`;
		const fullContent = header + content;

		await this.plugin.app.vault.create(uniquePath, fullContent);
	}

	/**
	 * Return a path that does not already exist in the vault.
	 * If `base` is taken, appends -1, -2, … before the extension until a free
	 * slot is found (e.g. `2026-04-20.md` → `2026-04-20-1.md`).
	 */
	private resolveUniquePath(base: string): string {
		if (!this.plugin.app.vault.getAbstractFileByPath(base)) return base;

		const dotIdx = base.lastIndexOf('.');
		const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
		const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';

		for (let i = 1; i <= 99; i++) {
			const candidate = `${stem}-${i}${ext}`;
			if (!this.plugin.app.vault.getAbstractFileByPath(candidate)) return candidate;
		}
		// Fallback: timestamp suffix guarantees uniqueness
		return `${stem}-${Date.now()}${ext}`;
	}
}
