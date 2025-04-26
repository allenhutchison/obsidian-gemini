/**
 * Utility for logging debug info for Gemini APIs.
 * @param debugMode Whether debug mode is enabled
 * @param title Title for the debug output
 * @param data Data to log (will be stringified)
 */
export function logDebugInfo(debugMode: boolean, title: string, data: any) {
  if (debugMode) {
    console.log(`[GeminiAPI Debug] ${title}:`, JSON.stringify(data, null, 2));
  }
}
