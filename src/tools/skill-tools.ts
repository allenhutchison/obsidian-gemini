import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';

/**
 * Tool for activating (loading) a skill's full instructions or resources
 *
 * Follows the agentskills.io progressive disclosure model:
 * - Without resource_path: loads full SKILL.md body (level 2)
 * - With resource_path: loads a specific resource file (level 3)
 */
export class ActivateSkillTool implements Tool {
	name = 'activate_skill';
	displayName = 'Activate Skill';
	category = ToolCategory.SKILLS;
	description =
		'Load a skill\'s full instructions or a specific resource file. Use this when you need the detailed instructions from an available skill. Call with just the skill name to get the full SKILL.md instructions, or include a resource_path to read a specific file from the skill directory (e.g., "references/REFERENCE.md" or "assets/template.hbs").';

	parameters = {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string' as const,
				description: 'The name of the skill to activate (e.g., "code-review", "data-analysis")',
			},
			resource_path: {
				type: 'string' as const,
				description:
					'Optional path to a specific resource file within the skill directory, relative to the skill root (e.g., "references/REFERENCE.md", "assets/template.hbs"). If omitted, returns the full SKILL.md body content.',
			},
		},
		required: ['name'],
	};

	getProgressDescription(params: { name: string; resource_path?: string }): string {
		if (params.resource_path) {
			return `Loading skill resource: ${params.name}/${params.resource_path}`;
		}
		return `Activating skill: ${params.name}`;
	}

	async execute(params: { name: string; resource_path?: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			if (!plugin.skillManager) {
				return {
					success: false,
					error: 'Skill manager service not available',
				};
			}

			if (!params.name || typeof params.name !== 'string') {
				return {
					success: false,
					error: 'Skill name is required',
				};
			}

			// If resource_path is provided, load specific resource
			if (params.resource_path) {
				const content = await plugin.skillManager.readSkillResource(params.name, params.resource_path);
				if (content === null) {
					// Try listing available resources to help
					const resources = await plugin.skillManager.listSkillResources(params.name);
					return {
						success: false,
						error: `Resource "${params.resource_path}" not found in skill "${params.name}"`,
						data: resources.length > 0 ? { availableResources: resources } : undefined,
					};
				}

				return {
					success: true,
					data: {
						skillName: params.name,
						resourcePath: params.resource_path,
						content: content,
					},
				};
			}

			// Load full SKILL.md body content
			const content = await plugin.skillManager.loadSkill(params.name);
			if (content === null) {
				// List available skills to help
				const summaries = await plugin.skillManager.getSkillSummaries();
				return {
					success: false,
					error: `Skill "${params.name}" not found`,
					data:
						summaries.length > 0
							? { availableSkills: summaries.map((s) => s.name) }
							: { message: 'No skills are currently installed' },
				};
			}

			// Also list available resources so the AI knows what's available
			const resources = await plugin.skillManager.listSkillResources(params.name);

			return {
				success: true,
				data: {
					skillName: params.name,
					content: content,
					availableResources: resources.length > 0 ? resources : undefined,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to activate skill: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
}

/**
 * Tool for creating a new skill
 *
 * Creates a properly structured skill directory with SKILL.md following
 * the agentskills.io specification.
 */
export class CreateSkillTool implements Tool {
	name = 'create_skill';
	displayName = 'Create Skill';
	category = ToolCategory.SKILLS;
	description =
		'Create a new agent skill with a SKILL.md file following the agentskills.io specification. The skill will be saved in the plugin skills directory and will be available for future use via activate_skill.';

	parameters = {
		type: 'object' as const,
		properties: {
			name: {
				type: 'string' as const,
				description:
					'The name of the skill (1-64 chars, lowercase alphanumeric and hyphens only, e.g., "code-review", "meeting-notes")',
			},
			description: {
				type: 'string' as const,
				description:
					'A description of what this skill does and when to use it. Should include keywords that help identify relevant tasks.',
			},
			content: {
				type: 'string' as const,
				description:
					'The full markdown body content of the SKILL.md file. Should include step-by-step instructions, examples, and edge cases.',
			},
		},
		required: ['name', 'description', 'content'],
	};

	requiresConfirmation = true;

	confirmationMessage = (params: { name: string; description: string }) => {
		return `Create new skill "${params.name}":\n\n${params.description.substring(0, 200)}${params.description.length > 200 ? '...' : ''}`;
	};

	getProgressDescription(params: { name: string }): string {
		return `Creating skill: ${params.name}`;
	}

	async execute(
		params: { name: string; description: string; content: string },
		context: ToolExecutionContext
	): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;

		try {
			if (!plugin.skillManager) {
				return {
					success: false,
					error: 'Skill manager service not available',
				};
			}

			// Validate required params
			if (!params.name || typeof params.name !== 'string' || params.name.trim().length === 0) {
				return {
					success: false,
					error: 'Skill name is required and must be a non-empty string',
				};
			}

			if (!params.description || typeof params.description !== 'string' || params.description.trim().length === 0) {
				return {
					success: false,
					error: 'Skill description is required and must be a non-empty string',
				};
			}

			if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
				return {
					success: false,
					error: 'Skill content is required and must be a non-empty string',
				};
			}

			const normalizedName = params.name.trim();
			const normalizedDescription = params.description.trim();
			const normalizedContent = params.content.trim();

			const skillPath = await plugin.skillManager.createSkill(normalizedName, normalizedDescription, normalizedContent);

			return {
				success: true,
				data: {
					path: skillPath,
					name: normalizedName,
					message: `Skill "${normalizedName}" created successfully. It will be available via activate_skill in future sessions.`,
				},
			};
		} catch (error) {
			return {
				success: false,
				error: `Failed to create skill: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
}

/**
 * Get all skill-related tools
 */
export function getSkillTools(): Tool[] {
	return [new ActivateSkillTool(), new CreateSkillTool()];
}
