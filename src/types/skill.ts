/**
 * Skill type definitions for Native Skills feature
 */

/**
 * Represents a parsed skill from a SKILL.md file
 */
export interface Skill {
	/** Unique identifier (from frontmatter `name` or filename) */
	name: string;

	/** Human-readable description (from frontmatter `description`) */
	description: string;

	/** List of tool names this skill can use (from frontmatter `tools`) */
	tools: string[];

	/** Source file path in vault */
	sourcePath: string;
}

/**
 * Frontmatter structure for SKILL.md files
 * Compatible with agentskills.io specification
 */
export interface SkillFrontmatter {
	name: string;
	description?: string;
	tools?: string[];
	/** Optional metadata fields from agentskills.io */
	license?: string;
	compatibility?: string[];
	metadata?: Record<string, unknown>;
}

/**
 * Result of parsing a skill file
 */
export interface SkillParseResult {
	success: boolean;
	skill?: Skill;
	error?: string;
}
