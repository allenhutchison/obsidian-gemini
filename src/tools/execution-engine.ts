import {
	Tool,
	ToolResult,
	ToolExecutionContext,
	ToolCall,
	ToolExecution,
	IConfirmationProvider,
	DiffContext,
	ConfirmationResult,
} from './types';
import { ToolRegistry } from './tool-registry';
import { ToolLoopDetector } from './loop-detector';
import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { shouldExcludePath } from '../utils/file-utils';

/**
 * Handles execution of tools with permission checks and UI feedback
 */
export class ToolExecutionEngine {
	private plugin: ObsidianGemini;
	private registry: ToolRegistry;
	private executionHistory: Map<string, ToolExecution[]> = new Map();
	private loopDetector: ToolLoopDetector;

	constructor(plugin: ObsidianGemini, registry: ToolRegistry) {
		this.plugin = plugin;
		this.registry = registry;
		this.loopDetector = new ToolLoopDetector(
			plugin.settings.loopDetectionThreshold,
			plugin.settings.loopDetectionTimeWindowSeconds
		);
	}

	/**
	 * Execute a tool call with appropriate checks and UI feedback
	 */
	async executeTool(
		toolCall: ToolCall,
		context: ToolExecutionContext,
		agentView?: IConfirmationProvider
	): Promise<ToolResult> {
		// Get agent view - use provided one or get from plugin
		const view = agentView || (this.plugin as any).agentView;

		const tool = this.registry.getTool(toolCall.name);

		if (!tool) {
			return {
				success: false,
				error: `Tool ${toolCall.name} not found`,
			};
		}

		// Validate parameters
		const validation = this.registry.validateParameters(toolCall.name, toolCall.arguments);
		if (!validation.valid) {
			return {
				success: false,
				error: `Invalid parameters: ${validation.errors?.join(', ')}`,
			};
		}

		// Check for execution loops if enabled
		if (this.plugin.settings.loopDetectionEnabled) {
			// Update loop detector config in case settings changed
			this.loopDetector.updateConfig(
				this.plugin.settings.loopDetectionThreshold,
				this.plugin.settings.loopDetectionTimeWindowSeconds
			);

			const loopInfo = this.loopDetector.getLoopInfo(context.session.id, toolCall);
			if (loopInfo.isLoop) {
				this.plugin.logger.warn(`Loop detected for tool ${toolCall.name}:`, loopInfo);
				return {
					success: false,
					error: `Execution loop detected: ${toolCall.name} has been called ${loopInfo.identicalCallCount} times with the same parameters in the last ${loopInfo.timeWindowMs / 1000} seconds. Please try a different approach.`,
				};
			}
		}

		// Check if tool is enabled for current session
		const enabledTools = this.registry.getEnabledTools(context);
		if (!enabledTools.includes(tool)) {
			return {
				success: false,
				error: `Tool ${tool.name} is not enabled for this session`,
			};
		}

		// Check if confirmation is required (project overrides → global policy)
		const requiresConfirmation = this.registry.requiresConfirmation(toolCall.name, context.projectPermissions);

		if (requiresConfirmation) {
			// Check if this tool is allowed without confirmation for this session
			// (session-level override via the in-chat "Allow" button)
			const isAllowedWithoutConfirmation = view?.isToolAllowedWithoutConfirmation?.(toolCall.name) || false;

			if (!isAllowedWithoutConfirmation) {
				// Update progress to show waiting for confirmation
				const toolDisplay = tool.displayName || tool.name;
				const confirmationMessage = `Waiting for confirmation: ${toolDisplay}`;
				view?.updateProgress?.(confirmationMessage, 'waiting');

				const result = await this.requestUserConfirmation(tool, toolCall.arguments, view);

				// Update progress back to tool execution
				view?.updateProgress?.(`Executing: ${toolDisplay}`, 'tool');

				if (!result.confirmed) {
					return {
						success: false,
						error: 'User declined tool execution',
					};
				}

				// If user edited the content in the diff view, use the edited content.
				// write_file, create_skill, and edit_skill all use `arguments.content` as the
				// full editable body, so a direct replacement works. append_content uses
				// `arguments.content` for the suffix to append; when the user edits the
				// diff we flip it into replace-mode so the tool overwrites the full file
				// with the edited content instead of appending on top of it.
				if (result.finalContent !== undefined) {
					if (tool.name === 'write_file' || tool.name === 'create_skill' || tool.name === 'edit_skill') {
						toolCall.arguments.content = result.finalContent;
						toolCall.arguments._userEdited = result.userEdited;
					} else if (tool.name === 'append_content') {
						if (result.userEdited) {
							// User edited the full-file diff, so we switch from append
							// to full overwrite with the edited content.
							toolCall.arguments.content = result.finalContent;
							toolCall.arguments._userEdited = true;
							toolCall.arguments._replaceFullContent = true;
						}
						// If user approved without editing, leave arguments unchanged
						// so the tool appends the original suffix normally.
					}
				}

				// If user allowed this action without future confirmation
				if (result.allowWithoutConfirmation && view) {
					view.allowToolWithoutConfirmation(toolCall.name);
				}
			}
		}

		// Show execution notification (disabled - now shown in chat UI)
		// const executionNotice = new Notice(`Executing ${tool.name}...`, 0);
		const executionNotice = { hide: () => {} }; // Dummy object for compatibility

		try {
			// Record the execution attempt
			this.loopDetector.recordExecution(context.session.id, toolCall);

			// Execute the tool
			const result = await tool.execute(toolCall.arguments, context);

			// Record execution in history
			const execution: ToolExecution = {
				toolName: tool.name,
				parameters: toolCall.arguments,
				result: result,
				timestamp: new Date(),
				confirmed: requiresConfirmation,
			};

			this.addToHistory(context.session.id, execution);

			// Update UI with result
			executionNotice.hide();

			// Tool execution results are now shown in the chat UI
			// No need for separate notices

			return result;
		} catch (error) {
			executionNotice.hide();
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			// Error is shown in chat UI, no need for notice

			const errorResult = {
				success: false,
				error: errorMessage,
			};

			return errorResult;
		}
	}

	/**
	 * Execute multiple tool calls in sequence
	 */
	async executeToolCalls(
		toolCalls: ToolCall[],
		context: ToolExecutionContext,
		agentView?: IConfirmationProvider
	): Promise<ToolResult[]> {
		const results: ToolResult[] = [];

		for (const toolCall of toolCalls) {
			const result = await this.executeTool(toolCall, context, agentView);
			results.push(result);

			// Stop execution chain if a tool fails (unless configured otherwise)
			if (!result.success && this.plugin.settings.stopOnToolError !== false) {
				break;
			}
		}

		return results;
	}

	/**
	 * Request user confirmation for tool execution
	 */
	private async requestUserConfirmation(
		tool: Tool,
		parameters: any,
		agentView?: IConfirmationProvider
	): Promise<ConfirmationResult> {
		// Use provided agentView or get from plugin as fallback
		const view = agentView || (this.plugin as any).agentView;

		if (!view) {
			// Fallback: if no agent view available, deny by default
			this.plugin.logger?.warn('No agent view available for confirmation');
			return { confirmed: false, allowWithoutConfirmation: false };
		}

		// Generate unique execution ID for tracking
		const executionId = `tool-confirm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		// Build diff context based on the tool's shape
		const diffContext = await this.buildDiffContext(tool, parameters);

		// Show confirmation in chat instead of modal
		return view.showConfirmationInChat(tool, parameters, executionId, diffContext);
	}

	/**
	 * Build a diff context for the confirmation UI when the tool modifies file content.
	 *
	 * Supported tools:
	 * - write_file: originalContent = current file (or empty for new), proposedContent = parameters.content
	 * - append_content: originalContent = current file, proposedContent = current + parameters.content
	 * - create_skill: originalContent = empty (new SKILL.md body), proposedContent = parameters.content
	 * - edit_skill: originalContent = current SKILL.md body, proposedContent = parameters.content
	 */
	private async buildDiffContext(tool: Tool, parameters: any): Promise<DiffContext | undefined> {
		const plugin = this.plugin as ObsidianGemini;

		if (tool.name === 'write_file' && parameters.path && parameters.content !== undefined) {
			const normalizedPath = normalizePath(parameters.path);
			if (shouldExcludePath(normalizedPath, plugin.settings.historyFolder)) return undefined;

			const file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			const originalContent = file instanceof TFile ? await this.safeReadFile(file) : '';
			return {
				filePath: parameters.path,
				originalContent,
				proposedContent: parameters.content,
				isNewFile: !file,
			};
		}

		if (tool.name === 'append_content' && parameters.path && parameters.content !== undefined) {
			const normalizedPath = normalizePath(parameters.path);
			if (shouldExcludePath(normalizedPath, plugin.settings.historyFolder)) return undefined;

			// Resolve the file the same way AppendContentTool does so the diff
			// matches what will actually be written: direct path, then .md suffix,
			// then wikilink resolution via the metadata cache.
			let file = plugin.app.vault.getAbstractFileByPath(normalizedPath);
			if (!file && !normalizedPath.endsWith('.md')) {
				file = plugin.app.vault.getAbstractFileByPath(normalizedPath + '.md');
			}
			if (!file) {
				const linkPath = parameters.path.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/\.md$/, '');
				const resolved = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, '');
				if (resolved) file = resolved;
			}
			if (!(file instanceof TFile)) return undefined; // Tool will return its own error

			const originalContent = await this.safeReadFile(file);
			// Mirror the newline-insertion logic from AppendContentTool.execute()
			let contentToAppend = parameters.content;
			if (originalContent.length > 0 && !originalContent.endsWith('\n') && !contentToAppend.startsWith('\n')) {
				contentToAppend = '\n' + contentToAppend;
			}
			return {
				filePath: file.path,
				originalContent,
				proposedContent: originalContent + contentToAppend,
				isNewFile: false,
			};
		}

		if (tool.name === 'create_skill' && parameters.name && parameters.content !== undefined) {
			// Normalize name the same way CreateSkillTool.execute() does
			const normalizedName = parameters.name.trim().toLowerCase();
			const proposedBody = parameters.content.trim();
			return {
				filePath: this.getSkillFilePath(normalizedName),
				originalContent: '',
				proposedContent: proposedBody,
				isNewFile: true,
			};
		}

		if (tool.name === 'edit_skill' && parameters.name) {
			// Normalize name the same way EditSkillTool.execute() does
			const normalizedName = parameters.name.trim().toLowerCase();
			const proposedContent = parameters.content?.trim();
			const proposedDescription = parameters.description?.trim();

			// Skip diff if neither content nor description is provided
			if (!proposedContent && !proposedDescription) return undefined;

			// Read the current skill body (excluding frontmatter) for the original side
			// of the diff. If the file can't be found, skip diff context — the tool will
			// surface its own not-found error at execution time.
			const originalBody = plugin.skillManager ? ((await plugin.skillManager.loadSkill(normalizedName)) ?? '') : '';

			// For content edits, show the body diff. For description-only edits,
			// show the body unchanged (diff will be empty, but confirmation still triggers).
			return {
				filePath: this.getSkillFilePath(normalizedName),
				originalContent: originalBody,
				proposedContent: proposedContent ?? originalBody,
				isNewFile: false,
			};
		}

		return undefined;
	}

	/**
	 * Build the SKILL.md file path for a given skill name, matching the path
	 * layout that SkillManager uses (`{historyFolder}/Skills/{name}/SKILL.md`).
	 * Used for diff context display only.
	 */
	private getSkillFilePath(skillName: string): string {
		const plugin = this.plugin as ObsidianGemini;
		if (plugin.skillManager) {
			return normalizePath(`${plugin.skillManager.getSkillsFolderPath()}/${skillName}/SKILL.md`);
		}
		return normalizePath(`${plugin.settings.historyFolder}/Skills/${skillName}/SKILL.md`);
	}

	/**
	 * Read a file's content, swallowing errors and returning empty string.
	 * Used when building diff context where a read failure shouldn't block execution.
	 */
	private async safeReadFile(file: TFile): Promise<string> {
		try {
			return await (this.plugin as ObsidianGemini).app.vault.read(file);
		} catch (error) {
			(this.plugin as any).logger?.warn(`Failed to read file for diff context: ${file.path}`, error);
			return '';
		}
	}

	/**
	 * Add execution to history
	 */
	private addToHistory(sessionId: string, execution: ToolExecution) {
		const history = this.executionHistory.get(sessionId) || [];
		history.push(execution);
		this.executionHistory.set(sessionId, history);
	}

	/**
	 * Get execution history for a session
	 */
	getExecutionHistory(sessionId: string): ToolExecution[] {
		return this.executionHistory.get(sessionId) || [];
	}

	/**
	 * Clear execution history for a session
	 */
	clearExecutionHistory(sessionId: string) {
		this.executionHistory.delete(sessionId);
		this.loopDetector.clearSession(sessionId);
	}

	/**
	 * Format tool results for display in chat
	 */
	formatToolResult(execution: ToolExecution): string {
		const icon = execution.result.success ? '✓' : '✗';
		const status = execution.result.success ? 'Success' : 'Failed';

		let formatted = `### Tool Execution: ${execution.toolName}\n\n`;
		formatted += `**Status:** ${icon} ${status}\n\n`;

		if (execution.result.data) {
			formatted += `**Result:**\n\`\`\`json\n${JSON.stringify(execution.result.data, null, 2)}\n\`\`\`\n`;
		}

		if (execution.result.error) {
			formatted += `**Error:** ${execution.result.error}\n`;
		}

		return formatted;
	}

	/**
	 * Get available tools for the current context as formatted descriptions
	 */
	getAvailableToolsDescription(context: ToolExecutionContext): string {
		const tools = this.registry.getEnabledTools(context);

		if (tools.length === 0) {
			return 'No tools are currently available.';
		}

		let description = '## Available Tools\n\n';

		for (const tool of tools) {
			description += `### ${tool.name}\n`;
			description += `${tool.description}\n\n`;

			if (tool.parameters.properties && Object.keys(tool.parameters.properties).length > 0) {
				description += '**Parameters:**\n';
				for (const [param, schema] of Object.entries(tool.parameters.properties)) {
					const required = tool.parameters.required?.includes(param) ? ' (required)' : '';
					description += `- \`${param}\` (${schema.type})${required}: ${schema.description}\n`;
				}
				description += '\n';
			}
		}

		return description;
	}
}
