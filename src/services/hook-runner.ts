import { App, TFile } from 'obsidian';
import type { ObsidianGemini } from '../types/plugin';
import { resolveOutputPath, writeHeadlessOutput } from './headless-run-output';
import { formatLocalDate } from '../utils/format-utils';
import { GeminiSummary } from '../summary';
import { SelectionRewriter } from '../rewrite-selection';
import { renderPrompt } from './hook-types';
import type { HookFireContext } from './hook-types';
import { runHeadlessAgentTurn } from './headless-agent-turn';

/**
 * Runs a single hook fire headlessly:
 *  1. Renders the prompt template with the trigger context
 *  2. Drives one headless agent turn via `runHeadlessAgentTurn` (temporary
 *     session scoped to the hook's tool/skill list, one model request, and the
 *     AgentLoop tool-execution loop)
 *  3. Optionally writes the final response to the resolved outputPath
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
				throw new Error(`[HookRunner] Unknown action "${String(hook.action)}" for hook "${hook.slug}"`);
		}
	}

	// ── agent-task action ────────────────────────────────────────────────────

	private async runAgentTask(isCancelled: () => boolean): Promise<string | undefined> {
		const { hook } = this.ctx;

		const finalText = await runHeadlessAgentTurn(
			this.plugin,
			{
				sessionLabel: `Hook: ${hook.slug}`,
				logPrefix: '[HookRunner]',
				subjectNoun: 'Hook',
				subjectName: hook.slug,
				// The hook's prompt is a template — render it against the trigger
				// context before the shared driver sends it.
				prompt: renderPrompt(hook.prompt, this.promptVars()),
				toolPolicy: hook.toolPolicy,
				model: hook.model,
				maxIterations: hook.maxIterations,
				// Apply the hook's enabledSkills as a skill filter.
				projectSkills: hook.enabledSkills,
			},
			isCancelled
		);

		// `undefined` means the run was cancelled mid-turn — nothing to write.
		if (finalText === undefined) return undefined;

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
		return resolveOutputPath(this.ctx.hook.outputPath as string, {
			slug: this.ctx.hook.slug,
			date: formatLocalDate(),
			fileName: this.ctx.fileName,
		});
	}

	private async writeOutput(outputPath: string, content: string): Promise<void> {
		const ranAt = new Date().toISOString();
		const header =
			`---\nhook: ${JSON.stringify(this.ctx.hook.slug)}\n` +
			`triggered_by: ${JSON.stringify(this.ctx.filePath)}\n` +
			`trigger: ${JSON.stringify(this.ctx.trigger)}\n` +
			`ran_at: ${JSON.stringify(ranAt)}\n---\n\n`;

		// Two concurrent hook fires can independently choose the same candidate
		// path (resolve-unique + vault.create is non-atomic), so use the shared
		// writer's retry policy: re-resolve on "already exists" rejections, then
		// fall back to a timestamp-suffixed path after the retry budget.
		await writeHeadlessOutput({
			vault: this.plugin.app.vault,
			outputPath,
			header,
			content,
			folderLabel: 'hook output folder',
			logger: this.plugin.logger,
			retry: { limit: 8, label: '[HookRunner]', outputNoun: 'hook output' },
		});
	}
}
