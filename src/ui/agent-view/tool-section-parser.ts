/**
 * Pure parsing helpers for tool-execution messages rendered in the agent view.
 *
 * Extracted from `agent-view-messages.ts` (issue #1072) so the string-only
 * detection/splitting logic is directly unit-testable, separate from the
 * DOM-building that consumes it. No Obsidian API dependency.
 */

/** Marker embedded in persisted tool-execution messages. */
const TOOL_EXECUTION_MARKER = 'Tool Execution Results:';

/** A single `### <name>` delimited tool section with its trimmed content. */
export interface ToolSection {
	toolName: string;
	content: string;
}

/** Result of splitting a formatted tool-execution message into sections. */
export interface ParsedToolSections {
	/**
	 * Whether the message split into `### `-delimited sections at all. This is
	 * distinct from `sections` being empty: a `### name` heading with empty
	 * content produces `hasSections === true` but contributes no section, and
	 * the caller must still render only the intro (never the whole message) in
	 * that case — preserving the original `toolSections.length > 1` behavior.
	 */
	hasSections: boolean;
	/** Trimmed text preceding the first `### ` section. */
	intro: string;
	/** Sections with a non-empty name and non-empty (trimmed) content. */
	sections: ToolSection[];
}

/**
 * Whether a message should be treated as a tool-execution message.
 *
 * Mirrors the original inline check: a history entry carrying `toolName`
 * metadata, or a message body containing the `Tool Execution Results:` marker.
 */
export function isToolExecutionMessage(message: string, hasToolNameMetadata: boolean): boolean {
	return hasToolNameMetadata || message.includes(TOOL_EXECUTION_MARKER);
}

/**
 * Split a formatted tool-execution message into an intro plus per-tool sections.
 *
 * The message is split on `### <name>` headings. Content for each section is
 * trimmed; sections whose name or trimmed content is empty are dropped (matching
 * the original `if (toolName && toolContent)` guard). When no headings are found
 * (`hasSections === false`), the caller renders the message normally.
 */
export function parseToolSections(formattedMessage: string): ParsedToolSections {
	const parts = formattedMessage.split(/### ([^\n]+)/);
	const hasSections = parts.length > 1;
	const intro = parts[0].trim();
	const sections: ToolSection[] = [];

	for (let i = 1; i < parts.length; i += 2) {
		const toolName = parts[i];
		const content = parts[i + 1]?.trim() || '';
		if (toolName && content) {
			sections.push({ toolName, content });
		}
	}

	return { hasSections, intro, sections };
}
