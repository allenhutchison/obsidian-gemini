import { Vault, normalizePath } from 'obsidian';
import { ensureFolderExists } from '../utils/file-utils';
import { getRawErrorMessage } from '../utils/error-utils';
import type { Logger } from '../utils/logger';

/**
 * Shared output helpers for the headless agent-run pipeline used by both
 * `ScheduledTaskRunner` and `HookRunner`. Both runners resolve a token-based
 * output path, guarantee it is unique in the vault, and write a YAML-headed
 * markdown file. Keeping the mechanical path/write logic here means a change to
 * how headless output is placed on disk is made in one spot instead of two.
 *
 * The frontmatter *content* still belongs to each runner (their header fields
 * differ), so callers build the `header` string and hand it in.
 */

/**
 * Substitute `{token}` placeholders in an output-path template and normalize the
 * result. Uses split/join rather than `String.prototype.replace` so a token
 * value containing `$&` / `$$` (or any other special replacement sequence) is
 * inserted verbatim.
 *
 * @param template output-path template, e.g. `reports/{slug}/{date}.md`
 * @param tokens   map of token name (without braces) → replacement value
 */
export function resolveOutputPath(template: string, tokens: Record<string, string>): string {
	let resolved = template;
	for (const [token, value] of Object.entries(tokens)) {
		resolved = resolved.split(`{${token}}`).join(value);
	}
	return normalizePath(resolved);
}

/**
 * Return a path that does not already exist in the vault.
 * If `base` is taken, appends -1, -2, … before the extension until a free
 * slot is found (e.g. `2026-04-20.md` → `2026-04-20-1.md`). After 99 collisions
 * it falls back to a timestamp suffix, which advances on every call.
 */
export function resolveUniquePath(vault: Vault, base: string): string {
	if (!vault.getAbstractFileByPath(base)) return base;

	const dotIdx = base.lastIndexOf('.');
	const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
	const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';

	for (let i = 1; i <= 99; i++) {
		const candidate = `${stem}-${i}${ext}`;
		if (!vault.getAbstractFileByPath(candidate)) return candidate;
	}
	// Fallback: timestamp suffix guarantees uniqueness
	return resolveTimestampPath(base);
}

/**
 * Return `base` with a `Date.now()` suffix before the extension. Used as the
 * last-resort unique path when every numbered candidate collided with a
 * concurrent writer — `Date.now()` advances on every attempt so no other fire
 * could have proposed the same name.
 */
export function resolveTimestampPath(base: string): string {
	const dotIdx = base.lastIndexOf('.');
	const stem = dotIdx >= 0 ? base.slice(0, dotIdx) : base;
	const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';
	return `${stem}-${Date.now()}${ext}`;
}

/**
 * Retry policy for concurrent-write races. When supplied to
 * {@link writeHeadlessOutput}, a `vault.create` that rejects with an
 * "already exists" error is retried up to `limit` times (re-resolving a unique
 * path each attempt), then once more with a timestamp-suffixed path. `label`
 * and `outputNoun` shape the final failure message
 * (`<label> Failed to write <outputNoun> after <limit+1> attempts: …`).
 */
export interface WriteRetryPolicy {
	limit: number;
	label: string;
	outputNoun: string;
}

export interface WriteHeadlessOutputParams {
	vault: Vault;
	/** Fully resolved (token-substituted, normalized) output path. */
	outputPath: string;
	/** YAML frontmatter block, including the leading/trailing `---` and blank line. */
	header: string;
	/** Markdown body appended after the header. */
	content: string;
	/** Human-readable folder label for `ensureFolderExists` logging. */
	folderLabel: string;
	logger?: Logger;
	/**
	 * When set, `vault.create` is retried on concurrent-write "already exists"
	 * races. When omitted, a single unique path is resolved and created, and any
	 * error propagates unchanged.
	 */
	retry?: WriteRetryPolicy;
}

/**
 * Ensure the parent folder exists, resolve a unique path, and write
 * `header + content` to it. Returns the path actually written (which may carry a
 * `-N`/timestamp suffix if the resolved path was taken).
 */
export async function writeHeadlessOutput(params: WriteHeadlessOutputParams): Promise<string> {
	const { vault, outputPath, header, content, folderLabel, logger, retry } = params;

	const parentPath = outputPath.includes('/') ? outputPath.slice(0, outputPath.lastIndexOf('/')) : null;
	if (parentPath) {
		await ensureFolderExists(vault, parentPath, folderLabel, logger);
	}

	const fullContent = header + content;

	if (!retry) {
		// Resolve a unique path — day-granular {date} tokens mean interval tasks
		// or multiple manual runs on the same day would otherwise overwrite each
		// other. Any create error propagates to the caller.
		const uniquePath = resolveUniquePath(vault, outputPath);
		await vault.create(uniquePath, fullContent);
		return uniquePath;
	}

	// Two concurrent fires can independently choose the same candidate path
	// (resolveUniquePath() + vault.create() is non-atomic), so retry on
	// "already exists" rejections by re-resolving each attempt. After
	// `retry.limit` collisions, fall back to a timestamp-suffixed path —
	// guaranteed unique since `Date.now()` advances on every attempt.
	let lastError: unknown;
	for (let attempt = 0; attempt < retry.limit; attempt++) {
		const candidate = resolveUniquePath(vault, outputPath);
		try {
			await vault.create(candidate, fullContent);
			return candidate;
		} catch (err) {
			lastError = err;
			if (!isAlreadyExistsError(err)) throw err;
			// Lost a race with another concurrent fire — loop and pick the next
			// free suffix. resolveUniquePath() will skip the file the other
			// writer just created.
		}
	}
	// All retries collided with concurrent writers. Try one more time with a
	// timestamp suffix that no other fire could have proposed.
	const fallback = resolveTimestampPath(outputPath);
	try {
		await vault.create(fallback, fullContent);
		return fallback;
	} catch (err) {
		const inner = getRawErrorMessage(err);
		const prior = getRawErrorMessage(lastError);
		throw new Error(
			`${retry.label} Failed to write ${retry.outputNoun} after ${retry.limit + 1} attempts: ${inner} (prior: ${prior})`
		);
	}
}

/**
 * Obsidian's `vault.create` rejects with a generic Error when the target file
 * already exists; the message text is the only signal. Match conservatively:
 * either the canonical "already exists" string or any wrapper that includes it.
 */
export function isAlreadyExistsError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return /already exists/i.test(err.message);
}
