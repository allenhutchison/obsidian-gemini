import { Tool } from './types';
import { GoogleSearchTool } from './google-search-tool';
import { GoogleMapsTool } from './google-maps-tool';
import { WebFetchTool } from './web-fetch-tool';
import { DeepResearchTool } from './deep-research-tool';

/**
 * Get web-related tools
 */
export function getWebTools(): Tool[] {
	return [new GoogleSearchTool(), new GoogleMapsTool(), new WebFetchTool(), new DeepResearchTool()];
}
