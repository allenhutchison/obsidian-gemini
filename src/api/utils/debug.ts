/**
 * Utility for logging debug info for Gemini APIs.
 * @param debugMode Whether debug mode is enabled
 * @param title Title for the debug output
 * @param data Data to log (will be stringified)
 */
// Recursively strip linked file contents from a file-context object for debug output
function stripFileContextNode(node: any, isRoot = true): any {
  if (!node || typeof node !== 'object') return node;
  // If it looks like a FileContextNode
  if ('path' in node && 'content' in node && 'wikilink' in node && 'links' in node) {
    const newNode: any = {
      ...node,
      content: isRoot ? node.content : `[Linked file: ${node.wikilink || node.path}]`,
      // Recursively process links (which may be a Map or object)
      links: {},
    };
    // Support both Map and plain object for links
    const linksObj = node.links instanceof Map ? Object.fromEntries(node.links) : node.links;
    for (const key in linksObj) {
      if (Object.prototype.hasOwnProperty.call(linksObj, key)) {
        newNode.links[key] = stripFileContextNode(linksObj[key], false);
      }
    }
    return newNode;
  }
  // Fallback: recursively process arrays and objects
  if (Array.isArray(node)) {
    return node.map((item) => stripFileContextNode(item, isRoot));
  } else {
    const newObj: any = {};
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        newObj[key] = stripFileContextNode(node[key], isRoot);
      }
    }
    return newObj;
  }
}

function stripLinkedFileContents(obj: any): any {
  // If this is a file-context object or contains one, use the new logic
  if (obj && typeof obj === 'object' && ('path' in obj && 'content' in obj && 'wikilink' in obj && 'links' in obj)) {
    return stripFileContextNode(obj, true);
  }
  // Otherwise, fallback to old logic
  if (Array.isArray(obj)) {
    return obj.map(stripLinkedFileContents);
  } else if (obj && typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = stripLinkedFileContents(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}

function redactLinkedFileSections(prompt: string): string {
  // Split by file section header
  const sectionRegex = /(=+\nFile Label: [^\n]+\nFile Name: [^\n]+\nWikiLink: [^\n]+\n=+\n\n)/g;
  const parts = prompt.split(sectionRegex);
  if (parts.length <= 2) return prompt; // Only current file

  let result = '';
  let sectionCount = 0;
  for (let i = 0; i < parts.length; i++) {
    // Even indices: text between sections (usually empty or trailing newlines)
    // Odd indices: section header
    if (i % 2 === 0) {
      result += parts[i];
    } else {
      // Section header
      result += parts[i];
      sectionCount++;
      if (sectionCount === 1) {
        // Current file: keep following content
        // Find the next section or end
        const nextSectionIdx = parts[i + 2] !== undefined ? i + 2 : parts.length;
        result += parts[i + 1] || '';
        i++; // Skip content for current file
      } else {
        // Linked file: redact content
        // Try to extract WikiLink from the header
        const wikilinkMatch = parts[i].match(/WikiLink: \[\[(.*?)\]\]/);
        const wikilink = wikilinkMatch ? wikilinkMatch[1] : 'Unknown';
        result += `[Linked file: [[${wikilink}]]]\n\n`;
        i++; // Skip actual content
      }
    }
  }
  return result;
}

export function logDebugInfo(debugMode: boolean, title: string, data: any) {
  if (!debugMode) return;
  let sanitizedData: any;
  if (typeof data === 'string' && data.includes('File Label:')) {
    sanitizedData = redactLinkedFileSections(data);
    console.log(`[GeminiAPI Debug] ${title}:\n${sanitizedData}`);
  } else {
    sanitizedData = stripLinkedFileContents(data);
    console.log(`[GeminiAPI Debug] ${title}:`, JSON.stringify(sanitizedData, null, 2));
  }
}

