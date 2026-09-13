import { Tool } from './types';
import { GoogleSearchTool } from './google-search-tool';
import { GoogleMapsTool } from './google-maps-tool';
import { WebFetchTool } from './web-fetch-tool';
import { DeepResearchTool } from './deep-research-tool';

/**
 * Get the `webSearch`-gated tools: Google Search and URL fetch (URL context).
 * Maps and Deep Research have their own gating and their own accessors below
 * (settings redesign §2.7 — the old single `'web'` tool source is split three
 * ways).
 */
export function getWebTools(): Tool[] {
	return [new GoogleSearchTool(), new WebFetchTool()];
}

/** Google Maps grounding — provider-bound (gated on the Gemini provider being configured), not a routed feature. */
export function getMapsTools(): Tool[] {
	return [new GoogleMapsTool()];
}

/** Deep Research — gated on the `deepResearch` feature. */
export function getDeepResearchTools(): Tool[] {
	return [new DeepResearchTool()];
}
