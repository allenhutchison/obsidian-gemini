import { normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ToolCategory, DestructiveAction } from '../types/agent';
import type { ConfirmationResult, DiffContext, IConfirmationProvider, Tool } from '../tools/types';
import { ToolExecutionContext } from '../tools/types';
import { GeminiClientFactory } from '../api';
import { ExtendedModelRequest } from '../api/interfaces/model-api';
import { ensureFolderExists } from '../utils/file-utils';
import { formatLocalDate, formatLocalTimestamp } from '../utils/format-utils';
import { buildTurnPreamble } from '../utils/turn-preamble';
import { AgentLoop } from '../agent/agent-loop';
import { HookFireContext, renderPrompt } from './hook-manager';

/**
 * Auto-approve all tool confirmations for headless hook fires. The user
 * authored the hook definition with an explicit `enabledTools` allowlist —
 * there is no UI surface during a vault-event-triggered run on which to
 * surface a mid-run confirmation.
 */
class HeadlessConfirmationProvider implements IConfirmationProvider {
	async showConfirmationInChat(
		_tool: Tool,
		_parameters: unknown,
		_executionId: string,
		_diffContext?: DiffContext
	): Promise<ConfirmationResult> {
		return { confirmed: true, allowWithoutConfirmation: false };
	}
	isToolAllowedWithoutConfirmation(_toolName: string): boolean {
		return true;
	}
	allowToolWithoutConfirmation(_toolName: string): void {
		/* no-op */
	}
	updateProgress(_message: string, _status: string): void {
		/* no-op */
	}
}

/**
 * Runs a single hook fire headlessly:
 *  1. Renders the prompt template with the trigger context
 *  2. Creates a temporary agent session scoped to the hook's tool/skill list
 *  3. Sends the rendered prompt to the model
 *  4. Hands off any tool calls to AgentLoop
 *  5. Optionally writes the final response to the resolved outputPath
 */
export class HookRunner {
	constructor(
		private plugin: ObsidianGemini,
		private ctx: HookFireContext
	) {}

	async run(isCancelled: () => boolean = () => false): Promise<string | undefined> {
		if (!this.plugin.sessionManager || !this.plugin.toolRegistry || !this.plugin.toolExecutionEngine) {
			throw new Error('[HookRunner] Agent services not initialised');
		}

		if (isCancelled()) return undefined;

		const { hook } = this.ctx;

		const enabledToolCategories =
			hook.enabledTools.length > 0
				? (hook.enabledTools as ToolCategory[])
				: [ToolCategory.READ_ONLY, ToolCategory.SKILLS];

		const session = await this.plugin.sessionManager.createAgentSession(`Hook: ${hook.slug}`, {
			enabledTools: enabledToolCategories,
			requireConfirmation: [] as DestructiveAction[],
		});

		if (hook.model) {
			session.modelConfig = { model: hook.model };
		}

		const toolContext: ToolExecutionContext = { plugin: this.plugin, session };
		const modelApi = GeminiClientFactory.createChatModel(this.plugin);
		const availableTools = this.plugin.toolRegistry.getEnabledTools(toolContext);

		const renderedPrompt = renderPrompt(hook.prompt, this.promptVars());
		const startedAt = formatLocalTimestamp(session.created);
		const userMessage = buildTurnPreamble(formatLocalTimestamp(new Date())) + renderedPrompt;
		const model = hook.model ?? this.plugin.settings.chatModelName;

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
			// Apply the hook's enabledSkills as a skill filter — the model API
			// uses projectSkills as its include-list when filtering the registered
			// skill set. Empty list ⇒ no filter, so the hook sees every available
			// skill (matches the documented "leave blank to inherit" semantics).
			projectSkills: hook.enabledSkills.length > 0 ? hook.enabledSkills : undefined,
		};

		if (isCancelled()) return undefined;
		const initialResponse = await modelApi.generateModelResponse(initialRequest);
		if (isCancelled()) return undefined;

		let finalText: string;
		if (initialResponse.toolCalls?.length) {
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
					maxIterations: 20,
				},
			});
			if (result.cancelled) return undefined;
			if (result.exhausted) {
				throw new Error(`[HookRunner] Hook "${hook.slug}" exhausted 20 tool iterations without producing a response`);
			}
			finalText = result.markdown;
		} else {
			finalText = initialResponse.markdown ?? '';
		}

		if (isCancelled()) return undefined;
		if (!hook.outputPath) return undefined;
		if (!finalText) return undefined;

		const outputPath = this.resolveOutputPath();
		await this.writeOutput(outputPath, finalText);
		return outputPath;
	}

	private promptVars(): Record<string, string> {
		return {
			filePath: this.ctx.filePath,
			fileName: this.ctx.fileName,
			trigger: this.ctx.trigger,
			oldPath: this.ctx.oldPath ?? '',
		};
	}

	private resolveOutputPath(): string {
		const date = formatLocalDate();
		const resolved = (this.ctx.hook.outputPath as string)
			.split('{slug}')
			.join(this.ctx.hook.slug)
			.split('{date}')
			.join(date)
			.split('{fileName}')
			.join(this.ctx.fileName);
		return normalizePath(resolved);
	}

	private async writeOutput(outputPath: string, content: string): Promise<void> {
		const parentPath = outputPath.includes('/') ? outputPath.slice(0, outputPath.lastIndexOf('/')) : null;
		if (parentPath) {
			await ensureFolderExists(this.plugin.app.vault, parentPath, 'hook output folder', this.plugin.logger);
		}

		const ranAt = new Date().toISOString();
		const header =
			`---\nhook: ${JSON.stringify(this.ctx.hook.slug)}\n` +
			`triggered_by: ${JSON.stringify(this.ctx.filePath)}\n` +
			`trigger: ${JSON.stringify(this.ctx.trigger)}\n` +
			`ran_at: ${JSON.stringify(ranAt)}\n---\n\n`;
		const fullContent = header + content;

		// Two concurrent hook fires can independently choose the same candidate
		// path (resolveUniquePath() + vault.create() is non-atomic), so retry on
		// "already exists" rejections by re-resolving each attempt. After
		// CREATE_RETRY_LIMIT collisions, fall back to a timestamp-suffixed path
		// — guaranteed unique since `Date.now()` advances on every attempt.
		const CREATE_RETRY_LIMIT = 8;
		let lastError: unknown;
		for (let attempt = 0; attempt < CREATE_RETRY_LIMIT; attempt++) {
			const candidate = this.resolveUniquePath(outputPath);
			try {
				await this.plugin.app.vault.create(candidate, fullContent);
				return;
			} catch (err) {
				lastError = err;
				if (!isAlreadyExistsError(err)) throw err;
				// Lost a race with another concurrent fire — loop and pick the
				// next free suffix. resolveUniquePath() will skip the file the
				// other writer just created.
			}
		}
		// All retries collided with concurrent writers. Try one more time with a
		// timestamp suffix that no other fire could have proposed.
		const fallback = this.resolveTimestampPath(outputPath);
		try {
			await this.plugin.app.vault.create(fallback, fullContent);
		} catch (err) {
			const inner = err instanceof Error ? err.message : String(err);
			const prior = lastError instanceof Error ? lastError.message : String(lastError);
			throw new Error(
				`[HookRunner] Failed to write hook output after ${CREATE_RETRY_LIMIT + 1} attempts: ${inner} (prior: ${prior})`
			);
		}
	}

	private resolveUniquePath(base: string): string {
		if (!this.plugin.app.vault.getAbstractFileByPath(base)) return base;

		const dotIdx = base.lastIndexOf('.');
		const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
		const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';

		for (let i = 1; i <= 99; i++) {
			const candidate = `${stem}-${i}${ext}`;
			if (!this.plugin.app.vault.getAbstractFileByPath(candidate)) return candidate;
		}
		return `${stem}-${Date.now()}${ext}`;
	}

	private resolveTimestampPath(base: string): string {
		const dotIdx = base.lastIndexOf('.');
		const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
		const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';
		return `${stem}-${Date.now()}${ext}`;
	}
}

/**
 * Obsidian's `vault.create` rejects with a generic Error when the target file
 * already exists; the message text is the only signal. Match conservatively:
 * either the canonical "already exists" string or any wrapper that includes it.
 */
function isAlreadyExistsError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return /already exists/i.test(err.message);
}
