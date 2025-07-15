import { Tool } from './types';
import { GoogleSearchTool } from './google-search-tool';
import { WebFetchTool } from './web-fetch-tool';

/**
 * Get web-related tools
 */
export function getWebTools(): Tool[] {
	return [
		new GoogleSearchTool(),
		new WebFetchTool()
	];
}