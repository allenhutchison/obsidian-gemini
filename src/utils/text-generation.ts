import type ObsidianGemini from '../main';

/**
 * Generate a human-friendly description of a tool call using templates
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
		// Template-based descriptions for common tools
		switch (toolName) {
			case 'read_file':
				if (toolArguments.path) {
					return `Reading ${toolArguments.path}`;
				}
				return 'Reading file';

			case 'write_file':
				if (toolArguments.path) {
					return `Writing to ${toolArguments.path}`;
				}
				return 'Writing file';

			case 'list_files':
				if (toolArguments.path) {
					const folder = toolArguments.path === '/' ? 'vault' : toolArguments.path;
					return `Listing files in ${folder}`;
				}
				return 'Listing files';

			case 'create_folder':
				if (toolArguments.path) {
					return `Creating folder ${toolArguments.path}`;
				}
				return 'Creating folder';

			case 'delete_file':
				if (toolArguments.path) {
					return `Deleting ${toolArguments.path}`;
				}
				return 'Deleting file';

			case 'move_file':
				if (toolArguments.sourcePath && toolArguments.targetPath) {
					// Extract just the filename for brevity
					const source = toolArguments.sourcePath.split('/').pop() || toolArguments.sourcePath;
					const target = toolArguments.targetPath.split('/').pop() || toolArguments.targetPath;
					return `Moving ${source} to ${target}`;
				}
				return 'Moving file';

			case 'search_files':
				if (toolArguments.query) {
					return `Searching for "${toolArguments.query}"`;
				}
				return 'Searching files';

			case 'get_active_file':
				return 'Getting active file';

			case 'google_search':
				if (toolArguments.query) {
					// Truncate long queries
					const query = toolArguments.query.length > 30
						? toolArguments.query.substring(0, 27) + '...'
						: toolArguments.query;
					return `Searching Google for "${query}"`;
				}
				return 'Searching Google';

			case 'web_fetch':
				if (toolArguments.url) {
					// Extract domain for brevity
					try {
						const domain = new URL(toolArguments.url).hostname.replace('www.', '');
						return `Fetching from ${domain}`;
					} catch {
						return 'Fetching web page';
					}
				}
				return 'Fetching web page';

			case 'deep_research':
				if (toolArguments.topic) {
					const topic = toolArguments.topic.length > 30
						? toolArguments.topic.substring(0, 27) + '...'
						: toolArguments.topic;
					return `Researching "${topic}"`;
				}
				return 'Conducting research';

			case 'update_memory':
				return 'Updating vault memory';

			case 'read_memory':
				return 'Reading vault memory';

			case 'generate_image':
				if (toolArguments.prompt) {
					const prompt = toolArguments.prompt.length > 25
						? toolArguments.prompt.substring(0, 22) + '...'
						: toolArguments.prompt;
					return `Generating image: "${prompt}"`;
				}
				return 'Generating image';

			default:
				return fallback;
		}
	} catch (error) {
		plugin.logger.debug('Failed to generate tool description:', error);
		return fallback;
	}
}
