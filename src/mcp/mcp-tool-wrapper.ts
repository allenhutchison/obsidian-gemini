import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Tool, ToolResult, ToolExecutionContext, ToolParameterSchema } from '../tools/types';
import { ToolCategory } from '../types/agent';

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
	readonly description: string;
	readonly parameters: ToolParameterSchema;
	requiresConfirmation: boolean;

	private client: Client;
	private originalToolName: string;

	constructor(client: Client, serverName: string, toolDef: MCPToolDefinition, trusted: boolean) {
		this.client = client;
		this.originalToolName = toolDef.name;
		this.name = `mcp__${sanitizeName(serverName)}__${sanitizeName(toolDef.name)}`;
		this.displayName = `${serverName}: ${toolDef.name}`;
		this.description = toolDef.description || `MCP tool "${toolDef.name}" from server "${serverName}"`;
		this.parameters = convertInputSchema(toolDef.inputSchema);
		this.requiresConfirmation = !trusted;
	}

	async execute(params: any, _context: ToolExecutionContext): Promise<ToolResult> {
		try {
			const result = await this.client.callTool({
				name: this.originalToolName,
				arguments: params,
			});

			// Convert MCP CallToolResult to plugin ToolResult
			const textParts: string[] = [];
			if (Array.isArray(result.content)) {
				for (const content of result.content) {
					if (content.type === 'text') {
						textParts.push(content.text as string);
					} else if (content.type === 'image') {
						textParts.push(`[Image: ${(content as any).mimeType || 'image'}]`);
					} else if (content.type === 'resource') {
						textParts.push(`[Resource: ${(content as any).uri || 'unknown'}]`);
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
 * Sanitize a name for use in tool identifiers.
 * Replaces non-alphanumeric characters with underscores.
 */
function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '_');
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
			required: inputSchema.required?.includes(key),
			...(schema?.enum ? { enum: schema.enum } : {}),
			...(schema?.items ? { items: { type: mapJsonSchemaType(schema.items.type) } } : {}),
		};
	}

	return {
		type: 'object',
		properties,
		required: inputSchema.required,
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
