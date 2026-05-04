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

	async run(): Promise<string | undefined> {
		if (!this.plugin.sessionManager || !this.plugin.toolRegistry || !this.plugin.toolExecutionEngine) {
			throw new Error('[HookRunner] Agent services not initialised');
		}

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
		};

		const initialResponse = await modelApi.generateModelResponse(initialRequest);

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
					isCancelled: () => false,
					confirmationProvider: new HeadlessConfirmationProvider(),
					maxIterations: 20,
				},
			});
			if (result.exhausted) {
				throw new Error(`[HookRunner] Hook "${hook.slug}" exhausted 20 tool iterations without producing a response`);
			}
			finalText = result.markdown;
		} else {
			finalText = initialResponse.markdown ?? '';
		}

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
		const uniquePath = this.resolveUniquePath(outputPath);

		const parentPath = uniquePath.includes('/') ? uniquePath.slice(0, uniquePath.lastIndexOf('/')) : null;
		if (parentPath) {
			await ensureFolderExists(this.plugin.app.vault, parentPath, 'hook output folder', this.plugin.logger);
		}

		const ranAt = new Date().toISOString();
		const header =
			`---\nhook: ${JSON.stringify(this.ctx.hook.slug)}\n` +
			`triggered_by: ${JSON.stringify(this.ctx.filePath)}\n` +
			`trigger: ${JSON.stringify(this.ctx.trigger)}\n` +
			`ran_at: ${JSON.stringify(ranAt)}\n---\n\n`;

		await this.plugin.app.vault.create(uniquePath, header + content);
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
}
