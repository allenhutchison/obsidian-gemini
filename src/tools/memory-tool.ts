import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';

/**
 * Tool for updating the AGENTS.md memory file
 * Allows the agent to remember information about the vault
 */
export class UpdateMemoryTool implements Tool {
	name = 'update_memory';
	displayName = 'Update Memory';
	category = ToolCategory.VAULT_OPERATIONS;
	description = 'Update the AGENTS.md file to remember information about this vault. Use this when the user explicitly asks you to remember something, or when you discover important information about how the vault is organized or should be used. The content will be appended to the AGENTS.md file.';

	parameters = {
		type: 'object' as const,
		properties: {
			content: {
				type: 'string' as const,
				description: 'The information to remember. Should be clear, concise Markdown text that will be appended to AGENTS.md.'
			}
		},
		required: ['content']
	};

	requiresConfirmation = true;

	confirmationMessage = (params: { content: string }) => {
		return `Add the following to AGENTS.md memory:\n\n${params.content.substring(0, 200)}${params.content.length > 200 ? '...' : ''}`;
	};

	getProgressDescription(params: any): string {
		return 'Updating vault memory';
	}

	async execute(params: { content: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			// Validate content
			if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
				return {
					success: false,
					error: 'Content is required and must be a non-empty string'
				};
			}

			// Get the agents memory service
			if (!plugin.agentsMemory) {
				return {
					success: false,
					error: 'Agents memory service not available'
				};
			}

			// Append the content to AGENTS.md
			await plugin.agentsMemory.append(params.content.trim());

			const memoryPath = plugin.agentsMemory.getMemoryFilePath();

			return {
				success: true,
				data: {
					path: memoryPath,
					message: 'Memory updated successfully'
				}
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
}

/**
 * Tool for reading the AGENTS.md memory file
 */
export class ReadMemoryTool implements Tool {
	name = 'read_memory';
	displayName = 'Read Memory';
	category = ToolCategory.READ_ONLY;
	description = 'Read the current contents of the AGENTS.md file to see what information has been remembered about this vault. This file contains persistent context about the vault structure, organization, key topics, user preferences, and custom instructions.';

	parameters = {
		type: 'object' as const,
		properties: {},
		required: []
	};

	getProgressDescription(params: any): string {
		return 'Reading vault memory';
	}

	async execute(params: any, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			// Get the agents memory service
			if (!plugin.agentsMemory) {
				return {
					success: false,
					error: 'Agents memory service not available'
				};
			}

			// Read the memory file
			const content = await plugin.agentsMemory.read();

			if (!content) {
				return {
					success: true,
					data: {
						content: '',
						exists: false,
						message: 'AGENTS.md does not exist yet. Use update_memory to create it.'
					}
				};
			}

			const memoryPath = plugin.agentsMemory.getMemoryFilePath();

			return {
				success: true,
				data: {
					path: memoryPath,
					content: content,
					exists: true
				}
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to read memory: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
}

/**
 * Get all memory-related tools
 */
export function getMemoryTools(): Tool[] {
	return [
		new UpdateMemoryTool(),
		new ReadMemoryTool()
	];
}
