import { ChatSession } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';

// Re-export ToolCall from its canonical definition in model-api
export type { ToolCall } from '../api/interfaces/model-api';

/**
 * Result from a tool execution
 */
export interface ToolResult {
	success: boolean;
	data?: any;
	error?: string;
	requiresConfirmation?: boolean;
}

/**
 * Context provided to tools during execution
 */
export interface ToolExecutionContext {
	session: ChatSession;
	plugin: any; // Will be typed to ObsidianGemini
}

/**
 * Schema for tool parameters
 */
export interface ToolParameterSchema {
	type: 'object';
	properties: Record<
		string,
		{
			type: 'string' | 'number' | 'boolean' | 'array';
			description: string;
			required?: boolean;
			enum?: any[];
			items?: { type: string };
		}
	>;
	required?: string[];
}

/**
 * Definition of a tool that can be executed
 */
export interface Tool {
	/** Unique identifier for the tool */
	name: string;

	/** Human-friendly display name */
	displayName?: string;

	/** Category this tool belongs to */
	category: string;

	/** Risk classification for the permission policy system */
	classification: ToolClassification;

	/** Human-readable description */
	description: string;

	/** Schema defining the tool's parameters */
	parameters: ToolParameterSchema;

	/** Execute the tool with given parameters */
	execute(params: any, context: ToolExecutionContext): Promise<ToolResult>;

	/** Whether this tool requires user confirmation before execution */
	requiresConfirmation?: boolean;

	/** Custom confirmation message (if requiresConfirmation is true) */
	confirmationMessage?: (params: any) => string;

	/** Get a human-friendly description of this tool execution for progress display */
	getProgressDescription?: (params: any) => string;
}

/**
 * Tool execution record for history
 */
export interface ToolExecution {
	toolName: string;
	parameters: any;
	result: ToolResult;
	timestamp: Date;
	confirmed?: boolean;
}

/**
 * Tool choice configuration for AI requests
 */
export interface ToolChoice {
	type: 'auto' | 'none' | 'any' | 'tool';
	toolName?: string; // When type is 'tool'
}

/**
 * Context for displaying a diff view when write_file is called
 */
export interface DiffContext {
	filePath: string;
	originalContent: string;
	proposedContent: string;
	isNewFile: boolean;
}

/**
 * Result from a confirmation request, optionally including edited content from the diff view
 */
export interface ConfirmationResult {
	confirmed: boolean;
	allowWithoutConfirmation: boolean;
	finalContent?: string;
	userEdited?: boolean;
}

/**
 * Interface for components that can provide in-chat confirmation UI
 */
export interface IConfirmationProvider {
	/** Show a confirmation request in the chat UI */
	showConfirmationInChat(
		tool: Tool,
		parameters: any,
		executionId: string,
		diffContext?: DiffContext
	): Promise<ConfirmationResult>;

	/** Check if a tool is allowed without confirmation for this session */
	isToolAllowedWithoutConfirmation(toolName: string): boolean;

	/** Allow a tool without confirmation for this session */
	allowToolWithoutConfirmation(toolName: string): void;

	/** Update progress display (optional) */
	updateProgress?(message: string, status: string): void;
}
