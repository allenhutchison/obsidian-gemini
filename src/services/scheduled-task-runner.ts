import type { ObsidianGemini } from '../types/plugin';
import type { ScheduledTask } from './scheduled-tasks/types';
import { resolveOutputPath, writeHeadlessOutput, markIncompleteOutput } from './headless-run-output';
import { formatLocalDate } from '../utils/format-utils';
import { runHeadlessAgentTurn } from './headless-agent-turn';

/**
 * Runs a single scheduled task headlessly:
 *  1. Drives one headless agent turn via `runHeadlessAgentTurn` (temporary
 *     session under the task's tool policy, one model request, and the
 *     AgentLoop tool-execution loop)
 *  2. Writes the final response text to the resolved outputPath
 *  3. Returns the vault path so BackgroundTaskManager can surface an "Open result" link
 */
export class ScheduledTaskRunner {
	constructor(
		private plugin: ObsidianGemini,
		private task: ScheduledTask
	) {}

	async run(isCancelled: () => boolean): Promise<string | undefined> {
		const turn = await runHeadlessAgentTurn(
			this.plugin,
			{
				sessionLabel: `Scheduled: ${this.task.slug}`,
				logPrefix: '[ScheduledTaskRunner]',
				subjectNoun: 'Task',
				subjectName: this.task.slug,
				prompt: this.task.prompt,
				toolPolicy: this.task.toolPolicy,
				model: this.task.model,
				maxIterations: this.task.maxIterations,
			},
			isCancelled
		);

		// `undefined` means the run was cancelled mid-turn — nothing to write.
		if (turn === undefined) return undefined;

		if (isCancelled()) return undefined;

		if (!turn.text) {
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
		let header = `---\nscheduled_task: ${JSON.stringify(this.task.slug)}\nran_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n`;
		let content = turn.text;
		// A loop-generated notice (empty-twice fallback or loop-detector abort)
		// must never read as the run's real result — mark the note instead (#1268).
		if (turn.notice) {
			({ header, content } = markIncompleteOutput(header, content, turn.notice));
		}
		await writeHeadlessOutput({
			vault: this.plugin.app.vault,
			outputPath,
			header,
			content,
			folderLabel: 'scheduled task output folder',
			logger: this.plugin.logger,
		});
		return outputPath;
	}
}
