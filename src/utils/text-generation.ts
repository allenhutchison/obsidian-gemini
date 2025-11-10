import type ObsidianGemini from '../main';

/**
 * Generate a human-friendly description of a tool call using templates
 *
 * This function serves as a generic fallback for tools that do not
 * implement their own `getProgressDescription` method.
 *
 * @param plugin - Plugin instance for logging
 * @param toolName - Name of the tool being executed
 * @param toolArguments - Arguments passed to the tool
 * @param displayName - Display name of the tool
 * @returns Human-friendly description
 */
export function generateToolDescription(
	plugin: ObsidianGemini,
	toolName: string,
	toolArguments: Record<string, any>,
	displayName: string
): string {
	const fallback = `Executing: ${displayName}`;

	try {
		// This function serves as a generic fallback for tools that do not
		// implement their own `getProgressDescription` method.
		plugin.logger.debug(
			`Using fallback tool description for '${toolName}'. Consider adding getProgressDescription to this tool.`
		);
		return fallback;
	} catch (error) {
		plugin.logger.debug('Failed to generate tool description:', error);
		return fallback;
	}
}
