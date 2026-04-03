import { TFile } from 'obsidian';
import type ObsidianGemini from '../main';
import { HandlerPriority } from '../types/agent-events';
import { ToolResult } from '../tools/types';
import { ChatSession } from '../types/agent';

/** Map tool names to the key parameter to display in summaries */
const KEY_PARAM_MAP: Record<string, string> = {
	read_file: 'path',
	write_file: 'path',
	delete_file: 'path',
	create_folder: 'path',
	update_frontmatter: 'path',
	append_content: 'path',
	move_file: 'sourcePath',
	list_files: 'path',
	search_files: 'pattern',
	search_file_contents: 'query',
	get_workspace_state: '',
	google_search: 'query',
	fetch_url: 'url',
	vault_semantic_search: 'query',
	deep_research: 'topic',
	generate_image: 'prompt',
	activate_skill: 'name',
	create_skill: 'name',
};

interface ToolLogEntry {
	toolName: string;
	args: Record<string, unknown>;
	result: ToolResult;
	durationMs: number;
}

/**
 * Subscribes to agent event bus hooks and logs tool execution summaries
 * to session history files as collapsible callout blocks.
 */
export class ToolExecutionLogger {
	private plugin: ObsidianGemini;
	private pendingLogs: ToolLogEntry[] = [];
	private unsubscribers: (() => void)[] = [];

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;

		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'toolExecutionComplete',
				async (payload) => {
					this.pendingLogs.push({
						toolName: payload.toolName,
						args: payload.args as Record<string, unknown>,
						result: payload.result,
						durationMs: payload.durationMs,
					});
				},
				HandlerPriority.INTERNAL
			)
		);

		this.unsubscribers.push(
			plugin.agentEventBus.on(
				'toolChainComplete',
				async (payload) => {
					if (this.pendingLogs.length === 0) return;
					const lines = this.pendingLogs.map((entry) => formatToolLine(entry));
					this.pendingLogs = [];
					const block = formatToolBlock(lines);
					await this.appendToHistory(payload.session, block);
				},
				HandlerPriority.INTERNAL
			)
		);
	}

	/**
	 * Unsubscribe from event bus.
	 */
	destroy(): void {
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
		this.pendingLogs = [];
	}

	private async appendToHistory(session: ChatSession, block: string): Promise<void> {
		if (!this.plugin.settings.chatHistory) return;

		const file = this.plugin.app.vault.getAbstractFileByPath(session.historyPath);
		if (!(file instanceof TFile)) return;

		try {
			await this.plugin.app.vault.process(file, (content) => {
				return mergeToolBlock(content, block);
			});
		} catch (error) {
			this.plugin.logger.error('ToolExecutionLogger: Failed to append to history:', error);
		}
	}
}

/**
 * Format a single tool execution line.
 */
export function formatToolLine(entry: ToolLogEntry): string {
	const { toolName, args, result, durationMs } = entry;

	const keyParam = extractKeyParam(toolName, args);
	const paramStr = keyParam ? ` ${keyParam.key}="${keyParam.value}"` : '';
	const status = result.success ? 'success' : `error: ${truncate(result.error || 'unknown', 60)}`;

	return `🔧 \`${toolName}\`${paramStr} → ${status} (${durationMs}ms)`;
}

/**
 * Wrap tool log lines in a collapsible callout block.
 */
export function formatToolBlock(lines: string[]): string {
	const quoted = lines.map((line) => `> ${line}`).join('\n');
	return `> [!tools]- Tool Execution\n${quoted}`;
}

/**
 * Extract the key parameter for a tool's summary line.
 */
function extractKeyParam(toolName: string, args: Record<string, unknown>): { key: string; value: string } | null {
	const paramName = KEY_PARAM_MAP[toolName];
	if (paramName && typeof args[paramName] === 'string') {
		return { key: paramName, value: args[paramName] as string };
	}

	// Fallback: use first string arg
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === 'string') {
			return { key, value };
		}
	}

	return null;
}

/**
 * Merge new tool lines into an existing callout block at the end of content,
 * or append as a new block if no existing callout is found.
 */
export function mergeToolBlock(content: string, block: string): string {
	const trimmed = content.trimEnd();
	// Check if content ends with an existing tools callout block
	const calloutPattern = /^> \[!tools\]- Tool Execution$/m;
	// Find the last callout in the content
	const lines = trimmed.split('\n');
	let calloutStart = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (calloutPattern.test(lines[i])) {
			calloutStart = i;
			break;
		}
		// If we hit a non-blockquote, non-empty line, stop searching
		if (lines[i].trim() !== '' && !lines[i].startsWith('>')) {
			break;
		}
	}

	if (calloutStart === -1) {
		// No existing callout — append new block
		return content + '\n' + block + '\n';
	}

	// Extract just the new tool lines (skip the callout header)
	const newLines = block.split('\n').filter((line) => line !== '> [!tools]- Tool Execution');

	return trimmed + '\n' + newLines.join('\n') + '\n';
}

function truncate(str: string, maxLen: number): string {
	const normalized = str.replace(/[\r\n]+/g, ' ');
	return normalized.length > maxLen ? normalized.slice(0, maxLen) + '...' : normalized;
}
