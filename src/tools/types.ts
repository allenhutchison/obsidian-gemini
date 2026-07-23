import { ChatSession } from '../types/agent';
import { ToolClassification } from '../types/tool-policy';
import type { ObsidianGemini } from '../types/plugin';
import type { TFile } from 'obsidian';

// Re-export ToolCall from its canonical definition in model-api
export type { ToolCall } from '../api/interfaces/model-api';

/**
 * Parameters passed to a tool, parsed from a model function call. The model
 * supplies an arbitrary JSON object, so this is the honest static type; tools
 * narrow individual fields at their execution boundary.
 */
export type ToolParams = Record<string, unknown>;

/**
 * Result from a tool execution
 */
export interface ToolResult {
	success: boolean;
	// Per-tool payload: each tool returns a differently-shaped object (and the ~40
	// consumer sites narrow it by runtime shape), so this is a genuine dynamic
	// boundary. Kept as `any` deliberately.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-tool payload is a genuine dynamic boundary
	data?: any;
	error?: string;
	requiresConfirmation?: boolean;
	/** Binary attachments to inject as inlineData parts alongside the functionResponse */
	inlineData?: Array<{ base64: string; mimeType: string }>;
	/**
	 * Set when the engine blocked this call because the loop detector fired.
	 * AgentLoop reads this to track how many times the detector has tripped in
	 * the current turn; after enough fires, the loop aborts the turn entirely.
	 */
	loopDetected?: boolean;
}

/**
 * Side effects a tool may trigger on the agent view that owns its session.
 *
 * Implemented by `AgentView` and injected into {@link ToolExecutionContext} by
 * the UI layer, so a tool in `src/tools/` can request view updates without
 * importing `AgentView` (which would create a tools→ui layering edge) or
 * reaching for the active workspace leaf. Currently used by `write_file` to add
 * a newly-created file to the session shelf and refresh the header. Headless
 * callers leave it unset, so these calls become no-ops.
 */
export interface IToolHostView {
	getCurrentSessionForToolExecution(): ChatSession | null;
	addContextFileToShelf(file: TFile): void;
	updateSessionHeader(): void;
	updateSessionMetadata(): Promise<void>;
}

/**
 * Context provided to tools during execution
 */
export interface ToolExecutionContext {
	session: ChatSession;
	plugin: ObsidianGemini;
	/** When set, discovery tools default their search scope to this directory */
	projectRootPath?: string;
	/**
	 * Side effects on the agent view that owns this session (shelf updates, header
	 * refresh). Set by the UI when an agent view drives the turn; unset for headless
	 * callers, where the tool simply skips the view updates.
	 */
	viewActions?: IToolHostView;
	/**
	 * Feature-level tool policy applied on top of the global plugin policy.
	 * Used by Projects, Scheduled Tasks, Hooks, and Sessions to narrow or open
	 * the tool surface for a single run. When unset, only the global policy
	 * applies.
	 */
	featureToolPolicy?: import('../types/tool-policy').FeatureToolPolicy;
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
			enum?: unknown[];
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
	execute(params: ToolParams, context: ToolExecutionContext): Promise<ToolResult>;

	/** Whether this tool requires user confirmation before execution */
	requiresConfirmation?: boolean;

	/** Custom confirmation message (if requiresConfirmation is true) */
	confirmationMessage?(params: ToolParams): string;

	/** Get a human-friendly description of this tool execution for progress display */
	getProgressDescription?(params: ToolParams): string;

	/**
	 * Build a diff-preview context for the confirmation UI when this tool
	 * modifies file content. The engine calls this polymorphically before
	 * requesting confirmation, so the engine never needs to know a tool's
	 * private write contract. A tool without an editable diff omits this hook
	 * and the engine falls back to a non-diff confirmation.
	 */
	buildDiffContext?(params: ToolParams, context: ToolExecutionContext): Promise<DiffContext | undefined>;

	/**
	 * Fold user-edited diff content back into this tool's own arguments after a
	 * confirmation in which the user edited the proposed content. Called (with
	 * `params` mutated in place) only when the confirmation returned
	 * `finalContent`. A tool without an editable diff omits this hook.
	 */
	applyConfirmedEdit?(params: ToolParams, result: ConfirmationResult): void;
}

/**
 * Tool execution record for history
 */
export interface ToolExecution {
	toolName: string;
	parameters: ToolParams;
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
		parameters: ToolParams,
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
