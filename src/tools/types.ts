import { TFile } from 'obsidian';
import { ChatSession } from '../types/agent';

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
	properties: Record<string, {
		type: 'string' | 'number' | 'boolean' | 'array';
		description: string;
		required?: boolean;
		enum?: any[];
		items?: { type: string };
	}>;
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
 * Tool call format from AI models
 */
export interface ToolCall {
	name: string;
	arguments: Record<string, any>;
}

/**
 * Tool choice configuration for AI requests
 */
export interface ToolChoice {
	type: 'auto' | 'none' | 'any' | 'tool';
	toolName?: string; // When type is 'tool'
}