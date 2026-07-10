import { Logger } from '../../utils/logger';
import type { BaseModelRequest, ExtendedModelRequest } from '../interfaces/model-api';

/**
 * Utility for logging debug info for Gemini APIs.
 * @param logger Logger instance from the plugin
 * @param title Title for the debug output
 * @param data Data to log (will be stringified)
 */
// Recursively strip linked file contents from a file-context object for debug output
export function stripFileContextNode(node: unknown, isRoot = true): unknown {
	if (!node || typeof node !== 'object') return node;
	const record = node as Record<string, unknown>;
	// If it looks like a FileContextNode
	if ('path' in record && 'content' in record && 'wikilink' in record && 'links' in record) {
		// Support both Map and plain object for links
		const linksObj: Record<string, unknown> =
			record.links instanceof Map
				? Object.fromEntries(record.links as Map<string, unknown>)
				: (record.links as Record<string, unknown>);
		const newLinks: Record<string, unknown> = {};
		for (const key in linksObj) {
			if (Object.prototype.hasOwnProperty.call(linksObj, key)) {
				newLinks[key] = stripFileContextNode(linksObj[key], false);
			}
		}
		const newNode: Record<string, unknown> = {
			...record,
			content: isRoot ? record.content : `[Linked file: ${String(record.wikilink || record.path)}]`,
			// Recursively processed links (which may originate from a Map or object)
			links: newLinks,
		};
		return newNode;
	}
	// Fallback: recursively process arrays and objects
	if (Array.isArray(node)) {
		return node.map((item) => stripFileContextNode(item, isRoot));
	} else {
		const newObj: Record<string, unknown> = {};
		for (const key in record) {
			if (Object.prototype.hasOwnProperty.call(record, key)) {
				newObj[key] = stripFileContextNode(record[key], isRoot);
			}
		}
		return newObj;
	}
}

export function stripLinkedFileContents(obj: unknown): unknown {
	// If this is a file-context object or contains one, use the new logic
	if (obj && typeof obj === 'object' && 'path' in obj && 'content' in obj && 'wikilink' in obj && 'links' in obj) {
		return stripFileContextNode(obj, true);
	}
	// Otherwise, fallback to old logic
	if (Array.isArray(obj)) {
		return obj.map(stripLinkedFileContents);
	} else if (obj && typeof obj === 'object') {
		const record = obj as Record<string, unknown>;
		const newObj: Record<string, unknown> = {};
		for (const key in record) {
			if (Object.prototype.hasOwnProperty.call(record, key)) {
				newObj[key] = stripLinkedFileContents(record[key]);
			}
		}
		return newObj;
	}
	return obj;
}

export function redactLinkedFileSections(prompt: string): string {
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

// Helper to detect BaseModelRequest. Structural (not `kind`-based) on purpose:
// this logs arbitrary debug payloads that may predate or omit the discriminant.
export function isBaseModelRequest(obj: unknown): obj is BaseModelRequest {
	return !!(obj && typeof obj === 'object' && typeof (obj as { prompt?: unknown }).prompt === 'string');
}

// Helper to detect ExtendedModelRequest
export function isExtendedModelRequest(obj: unknown): obj is ExtendedModelRequest {
	if (!isBaseModelRequest(obj)) return false;
	const extended = obj as { conversationHistory?: unknown; userMessage?: unknown };
	return Array.isArray(extended.conversationHistory) && typeof extended.userMessage === 'string';
}

export function formatBaseModelRequest(req: BaseModelRequest): string {
	return [`Model: ${req.model ?? '[default]'}\n`, `Prompt: ${JSON.stringify(req.prompt, null, 2)}\n`].join('');
}

export function formatExtendedModelRequest(req: ExtendedModelRequest): string {
	return [
		`Model: ${req.model ?? '[default]'}\n`,
		`Prompt: ${JSON.stringify(req.prompt, null, 2)}\n`,
		`User Message: ${JSON.stringify(req.userMessage, null, 2)}\n`,
		`Conversation History:`,
		JSON.stringify(req.conversationHistory, null, 2),
		req.renderContent !== undefined ? `\nRender Content: ${req.renderContent}` : '',
	].join('\n');
}

export function logDebugInfo(logger: Logger, title: string, data: unknown) {
	if (isExtendedModelRequest(data)) {
		logger.log(`[GeminiAPI Debug] ${title} (ExtendedModelRequest):\n${formatExtendedModelRequest(data)}`);
		return;
	}
	if (isBaseModelRequest(data)) {
		logger.log(`[GeminiAPI Debug] ${title} (BaseModelRequest):\n${formatBaseModelRequest(data)}`);
		return;
	}
	if (typeof data === 'string' && data.includes('File Label:')) {
		logger.log(`[GeminiAPI Debug] ${title}:\n${redactLinkedFileSections(data)}`);
	} else {
		logger.log(`[GeminiAPI Debug] ${title}:`, JSON.stringify(stripLinkedFileContents(data), null, 2));
	}
}
