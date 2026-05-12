import { App, TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { DestructiveAction } from '../types/agent';
import type { ConfirmationResult, DiffContext, IConfirmationProvider, Tool } from '../tools/types';
import { ToolExecutionContext } from '../tools/types';
import { ModelClientFactory } from '../api';
import { ExtendedModelRequest } from '../api/interfaces/model-api';
import { ensureFolderExists } from '../utils/file-utils';
import { formatLocalDate, formatLocalTimestamp } from '../utils/format-utils';
import { buildTurnPreamble } from '../utils/turn-preamble';
import { AgentLoop } from '../agent/agent-loop';
import { GeminiSummary } from '../summary';
import { SelectionRewriter } from '../rewrite-selection';
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
		if (isCancelled()) return undefined;

		const { hook } = this.ctx;
		switch (hook.action) {
			case 'agent-task':
				return this.runAgentTask(isCancelled);
			case 'summarize':
				return this.runSummarize(isCancelled);
			case 'rewrite':
				return this.runRewrite(isCancelled);
			case 'command':
				return this.runCommand(isCancelled);
			default:
				throw new Error(`[HookRunner] Unknown action "${hook.action}" for hook "${hook.slug}"`);
		}
	}

	// ── agent-task action ────────────────────────────────────────────────────

	private async runAgentTask(isCancelled: () => boolean): Promise<string | undefined> {
		if (!this.plugin.sessionManager || !this.plugin.toolRegistry || !this.plugin.toolExecutionEngine) {
			throw new Error('[HookRunner] Agent services not initialised');
		}

		const { hook } = this.ctx;

		const session = await this.plugin.sessionManager.createAgentSession(`Hook: ${hook.slug}`, {
			toolPolicy: hook.toolPolicy,
			requireConfirmation: [] as DestructiveAction[],
		});

		if (hook.model) {
			session.modelConfig = { model: hook.model };
		}

		const toolContext: ToolExecutionContext = {
			plugin: this.plugin,
			session,
			featureToolPolicy: hook.toolPolicy,
		};
		const modelApi = ModelClientFactory.createChatModel(this.plugin);
		// Headless hook fires auto-approve confirmations, so only expose
		// APPROVE tools — ASK_USER tools would otherwise execute unattended.
		// To allow an ASK_USER tool in a hook, the hook's toolPolicy must
		// explicitly upgrade it (preset or per-tool override).
		const availableTools = this.plugin.toolRegistry.getAutoApprovedTools(toolContext);

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
					featureToolPolicy: hook.toolPolicy,
					headless: true,
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

	// ── summarize action ─────────────────────────────────────────────────────

	private async runSummarize(isCancelled: () => boolean): Promise<string | undefined> {
		if (isCancelled()) return undefined;
		const file = this.resolveTriggerFile();
		if (!file) return undefined;
		// Existing summary feature only supports markdown — non-md fires are a
		// silent no-op rather than a failure, so a hook with a broad pathGlob
		// that catches images doesn't pollute the failure counter.
		if (file.extension !== 'md') {
			this.plugin.logger.log(
				`[HookRunner] Hook "${this.ctx.hook.slug}" — summarize: skipping non-markdown file ${file.path}`
			);
			return undefined;
		}
		if (isCancelled()) return undefined;
		const summarizer = this.plugin.summarizer ?? new GeminiSummary(this.plugin);
		await summarizer.summarizeFile(file);
		// summarize writes back to frontmatter on the original file rather
		// than producing a new output file, so there's nothing meaningful to
		// return as an outputPath.
		return undefined;
	}

	// ── rewrite action ───────────────────────────────────────────────────────

	private async runRewrite(isCancelled: () => boolean): Promise<string | undefined> {
		if (isCancelled()) return undefined;
		const file = this.resolveTriggerFile();
		if (!file) return undefined;
		if (file.extension !== 'md') {
			this.plugin.logger.log(
				`[HookRunner] Hook "${this.ctx.hook.slug}" — rewrite: skipping non-markdown file ${file.path}`
			);
			return undefined;
		}
		if (isCancelled()) return undefined;
		const instructions = renderPrompt(this.ctx.hook.prompt, this.promptVars());
		const rewriter = new SelectionRewriter(this.plugin);
		await rewriter.rewriteFile(file, instructions);
		return undefined;
	}

	// ── command action ───────────────────────────────────────────────────────

	private async runCommand(isCancelled: () => boolean): Promise<string | undefined> {
		if (isCancelled()) return undefined;
		const { hook } = this.ctx;
		const commandId = hook.commandId;
		if (!commandId) {
			throw new Error(`[HookRunner] Hook "${hook.slug}" has action=command but no commandId`);
		}

		// Optional focus step: editor-scoped commands like `editor:save-file`
		// run against whatever workspace state is active when dispatched, not
		// against ctx.filePath. When the hook opts in via `focusFile: true`,
		// we open the trigger file first so the command targets it. If the
		// file is gone (file-deleted, renamed away, etc.) we skip the
		// dispatch with a log entry rather than fire on the wrong file.
		if (hook.focusFile) {
			const file = this.resolveTriggerFile();
			if (!file) {
				// Warn-level: the user explicitly opted into focusFile, so a
				// silent skip would mask why the command didn't fire. Per
				// AGENTS.md, logger.log only surfaces in debug mode.
				this.plugin.logger.warn(
					`[HookRunner] Hook "${hook.slug}" — command: focusFile is on but ${this.ctx.filePath} is not present; skipping dispatch`
				);
				return undefined;
			}
			await this.plugin.app.workspace.openLinkText(this.ctx.filePath, '', false);
			if (isCancelled()) return undefined;
		}

		// `executeCommandById` is part of the Obsidian Commands API. It's not
		// in the public types but it's a documented runtime surface every
		// plugin uses (no other way to fire a registered command by id). It
		// returns true when the command exists and was dispatched; false when
		// the id is unknown. We surface the false case as a hook failure so
		// a typo doesn't silently no-op.
		const commands = (this.plugin.app as App & { commands?: { executeCommandById?: (id: string) => boolean } })
			.commands;
		if (!commands || typeof commands.executeCommandById !== 'function') {
			throw new Error('[HookRunner] Obsidian Commands API not available');
		}
		const dispatched = commands.executeCommandById(commandId);
		if (!dispatched) {
			throw new Error(`[HookRunner] Command "${commandId}" not found or refused to run`);
		}
		return undefined;
	}

	private resolveTriggerFile(): TFile | undefined {
		// `file-deleted` hooks don't have a TFile to act on (the file is
		// gone). Skip silently rather than fail. The agent-task path
		// tolerates this because it just renders a prompt with the path
		// string, but summarize / rewrite need the file to exist.
		const f = this.plugin.app.vault.getAbstractFileByPath(this.ctx.filePath);
		if (f instanceof TFile) return f;
		this.plugin.logger.log(
			`[HookRunner] Hook "${this.ctx.hook.slug}" — file ${this.ctx.filePath} is not present (deleted, renamed away, or never existed); skipping`
		);
		return undefined;
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
