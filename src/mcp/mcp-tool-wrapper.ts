import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Tool, ToolResult, ToolExecutionContext, ToolParameterSchema } from '../tools/types';
import { ToolCategory } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import { MCP_CALL_TOOL_TIMEOUT_MS } from './mcp-constants';
import { withTimeout } from '../utils/timeout';

/**
 * MCP tool definition as returned by client.listTools()
 */
interface MCPToolDefinition {
	name: string;
	description?: string;
	inputSchema?: {
		type?: string;
		properties?: Record<string, any>;
		required?: string[];
		[key: string]: any;
	};
}

/**
 * Wraps an MCP server tool as a plugin Tool, delegating execution to the MCP Client.
 */
export class MCPToolWrapper implements Tool {
	readonly name: string;
	readonly displayName: string;
	readonly category: string = ToolCategory.EXTERNAL_MCP;
	readonly classification: ToolClassification = ToolClassification.EXTERNAL;
	readonly description: string;
	readonly parameters: ToolParameterSchema;

	private client: Client;
	private originalToolName: string;

	constructor(client: Client, serverName: string, toolDef: MCPToolDefinition) {
		this.client = client;
		this.originalToolName = toolDef.name;
		this.name = enforceMaxLength(`mcp__${sanitizeName(serverName)}__${sanitizeName(toolDef.name)}`);
		this.displayName = `${serverName}: ${toolDef.name}`;
		this.description = toolDef.description || `MCP tool "${toolDef.name}" from server "${serverName}"`;
		this.parameters = convertInputSchema(toolDef.inputSchema);
	}

	async execute(params: any, _context: ToolExecutionContext): Promise<ToolResult> {
		try {
			// Bound the wait — a hung MCP server must not freeze the agent loop.
			// Timeout surfaces as `{ success: false, error }` via the catch below,
			// which is the same shape any other tool failure produces.
			const result = await withTimeout(
				this.client.callTool({
					name: this.originalToolName,
					arguments: params,
				}),
				MCP_CALL_TOOL_TIMEOUT_MS,
				`MCP tool "${this.displayName}"`
			);

			// Convert MCP CallToolResult to plugin ToolResult
			const textParts: string[] = [];
			if (Array.isArray(result.content)) {
				for (const content of result.content) {
					if (content.type === 'text' && 'text' in content) {
						textParts.push(String(content.text));
					} else if (content.type === 'image' && 'mimeType' in content) {
						textParts.push(`[Image: ${content.mimeType || 'image'}]`);
					} else if (content.type === 'resource' && 'uri' in content) {
						textParts.push(`[Resource: ${content.uri || 'unknown'}]`);
					}
				}
			}

			const isError = result.isError === true;
			return {
				success: !isError,
				data: textParts.join('\n') || (isError ? undefined : 'Tool executed successfully'),
				error: isError ? textParts.join('\n') || 'MCP tool returned an error' : undefined,
			};
		} catch (error) {
			return {
				success: false,
				error: `MCP tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	confirmationMessage(params: any): string {
		const paramSummary = Object.entries(params || {})
			.map(([key, value]) => {
				const strValue = typeof value === 'string' ? value : JSON.stringify(value);
				const truncated = strValue.length > 100 ? strValue.substring(0, 100) + '...' : strValue;
				return `  ${key}: ${truncated}`;
			})
			.join('\n');

		return `Run MCP tool "${this.displayName}"${paramSummary ? `\n${paramSummary}` : ''}`;
	}

	getProgressDescription(_params: any): string {
		return `Running ${this.displayName}...`;
	}
}

/**
 * Maximum length of a Gemini FunctionDeclaration name.
 * @see https://ai.google.dev/api/caching#FunctionDeclaration
 */
const MAX_TOOL_NAME_LENGTH = 128;

/**
 * Sanitize a name for use in a Gemini tool identifier.
 *
 * Per the Gemini API spec, FunctionDeclaration.name must be composed of
 * `a-z`, `A-Z`, `0-9`, `_`, `:`, `.`, or `-`, with a maximum length of 128.
 * This preserves MCP tool names that use dot notation (e.g. when an MCP
 * server is run with --use-dot-names), so what users see in settings
 * matches what the model sees at function call time.
 *
 * @see https://ai.google.dev/api/caching#FunctionDeclaration
 */
function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_:.-]/g, '_');
}

/**
 * Truncate a fully qualified tool name (mcp__server__tool) to fit within the
 * Gemini FunctionDeclaration.name length limit.
 *
 * Strategy: preserve both the leading `mcp__server__` prefix (so tools remain
 * recognizable as MCP-sourced and scoped to their server) and the trailing
 * portion of the tool name (which is where uniqueness comes from when multiple
 * tools share the same prefix). A short content hash in the middle guarantees
 * deterministic uniqueness even if two long-named tools collide on both ends.
 *
 * This function runs on initialization only; for typical MCP tool names it's
 * a no-op since names rarely exceed 128 chars.
 */
function enforceMaxLength(name: string): string {
	if (name.length <= MAX_TOOL_NAME_LENGTH) return name;

	// 8-char hex content hash for disambiguation; _h_ is a stable marker
	// using only characters allowed by the Gemini FunctionDeclaration.name spec.
	const hash = simpleContentHash(name);
	const marker = `_h_${hash}_`;
	const remaining = MAX_TOOL_NAME_LENGTH - marker.length;
	const headLen = Math.ceil(remaining / 2);
	const tailLen = Math.floor(remaining / 2);
	return name.slice(0, headLen) + marker + name.slice(-tailLen);
}

/**
 * Simple, deterministic 8-character hex hash of a string.
 * Not cryptographic — only used to disambiguate truncated tool names.
 */
function simpleContentHash(input: string): string {
	let h = 0;
	for (let i = 0; i < input.length; i++) {
		h = (h * 31 + input.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Convert an MCP inputSchema (JSON Schema) to the plugin's ToolParameterSchema format.
 */
function convertInputSchema(inputSchema?: MCPToolDefinition['inputSchema']): ToolParameterSchema {
	if (!inputSchema || !inputSchema.properties) {
		return { type: 'object', properties: {}, required: [] };
	}

	const properties: ToolParameterSchema['properties'] = {};

	for (const [key, schema] of Object.entries(inputSchema.properties)) {
		properties[key] = {
			type: mapJsonSchemaType(schema?.type),
			description: schema?.description || `Parameter "${key}"`,
			...(schema?.enum ? { enum: schema.enum } : {}),
			...(schema?.items ? { items: { type: mapJsonSchemaType(schema.items.type) } } : {}),
		};
	}

	return {
		type: 'object',
		properties,
		required: inputSchema.required ?? [],
	};
}

/**
 * Map JSON Schema types to the plugin's simpler type system.
 */
function mapJsonSchemaType(type: any): 'string' | 'number' | 'boolean' | 'array' {
	switch (type) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'array':
			return 'array';
		default:
			return 'string'; // Default to string for unsupported types (object, null, etc.)
	}
}
