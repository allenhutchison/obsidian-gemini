import { ToolResult } from '../tools/types';

/** Tools where result.data.path represents a targeted file access */
const TRACKED_TOOLS = new Set([
	'read_file',
	'write_file',
	'create_folder',
	'delete_file',
	'move_file',
	'update_frontmatter',
	'append_content',
]);

interface ToolResultEntry {
	toolName: string;
	toolArguments: unknown;
	result: ToolResult;
}

/**
 * Read a string property from a tool's per-tool `data` payload, which is a
 * genuine dynamic boundary (`ToolResult.data` is `any`). Returns the value only
 * when the key is present and holds a string, otherwise `undefined`.
 */
function readStringProp(data: unknown, key: string): string | undefined {
	if (data && typeof data === 'object' && key in data) {
		const value = (data as Record<string, unknown>)[key];
		return typeof value === 'string' ? value : undefined;
	}
	return undefined;
}

/**
 * Extract accessed file paths from a batch of tool results.
 * Returns paths in encounter order (duplicates may remain); deduplication
 * occurs in agent-view-tools.ts when paths are added to the session Set.
 * Search/list tools are excluded to avoid noise.
 */
export function extractAccessedPaths(toolResults: readonly ToolResultEntry[]): string[] {
	const paths: string[] = [];

	for (const tr of toolResults) {
		if (!tr.result.success || !TRACKED_TOOLS.has(tr.toolName)) continue;

		if (tr.toolName === 'move_file') {
			const sourcePath = readStringProp(tr.result.data, 'sourcePath');
			const targetPath = readStringProp(tr.result.data, 'targetPath');
			if (sourcePath) paths.push(sourcePath);
			if (targetPath) paths.push(targetPath);
		} else {
			const path = readStringProp(tr.result.data, 'path');
			if (path) paths.push(path);
		}
	}

	return paths;
}

/**
 * Convert a file path to the wikilink basename format used in frontmatter.
 * Matches the existing context_files format: [[basename]] without .md extension.
 * Non-md files keep their extension: images/photo.png → [[photo.png]]
 */
export function pathToWikilink(path: string): string {
	const filename = path.substring(path.lastIndexOf('/') + 1);
	const basename = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
	return `[[${basename}]]`;
}
