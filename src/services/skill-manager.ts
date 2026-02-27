import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';

/**
 * Metadata parsed from a SKILL.md frontmatter
 */
export interface SkillMetadata {
	/** Skill name (must match directory name) */
	name: string;
	/** Description of what the skill does and when to use it */
	description: string;
	/** Optional license */
	license?: string;
	/** Optional compatibility notes */
	compatibility?: string;
	/** Optional key-value metadata */
	metadata?: Record<string, string>;
	/** Path to the skill directory */
	path: string;
}

/**
 * Summary of a skill for system prompt injection (progressive disclosure - level 1)
 */
export interface SkillSummary {
	name: string;
	description: string;
}

/** Regex for validating skill names per the agentskills.io spec */
const SKILL_NAME_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;
const SKILL_NAME_MAX_LENGTH = 64;
const SKILL_MD_FILENAME = 'SKILL.md';

/**
 * Manages agent skills following the agentskills.io specification.
 *
 * Skills are stored in [state-folder]/skills/ and follow the directory structure:
 *   skills/
 *     skill-name/
 *       SKILL.md       # Required - frontmatter + instructions
 *       references/    # Optional - detailed reference docs
 *       assets/        # Optional - templates, data files
 *       scripts/       # Optional - read-only reference (no execution in Obsidian)
 */
export class SkillManager {
	private plugin: InstanceType<typeof ObsidianGemini>;

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
	}

	/**
	 * Get the skills folder path within the plugin state folder
	 */
	getSkillsFolderPath(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/skills`);
	}

	/**
	 * Ensure the skills directory exists, creating it if needed
	 */
	async ensureSkillsDirectory(): Promise<void> {
		// Ensure base state folder exists
		await this.plugin.app.vault.createFolder(this.plugin.settings.historyFolder).catch(() => {});

		const skillsDir = this.getSkillsFolderPath();
		const folder = this.plugin.app.vault.getAbstractFileByPath(skillsDir);

		if (!folder || !(folder instanceof TFolder)) {
			await this.plugin.app.vault.createFolder(skillsDir);
		}
	}

	/**
	 * Discover all skills in the skills directory.
	 * Scans for subdirectories containing SKILL.md and parses their frontmatter.
	 */
	async discoverSkills(): Promise<SkillMetadata[]> {
		const skillsDir = this.getSkillsFolderPath();
		const folder = this.plugin.app.vault.getAbstractFileByPath(skillsDir);

		if (!(folder instanceof TFolder)) {
			return [];
		}

		const skills: SkillMetadata[] = [];

		for (const child of folder.children) {
			if (!(child instanceof TFolder)) continue;

			const skillMdPath = normalizePath(`${child.path}/${SKILL_MD_FILENAME}`);
			const skillFile = this.plugin.app.vault.getAbstractFileByPath(skillMdPath);

			if (!(skillFile instanceof TFile)) continue;

			try {
				const metadata = await this.parseSkillMetadata(skillFile, child.name);
				if (metadata) {
					skills.push(metadata);
				}
			} catch (error) {
				this.plugin.logger.warn(`Failed to parse skill at ${child.path}:`, error);
			}
		}

		return skills;
	}

	/**
	 * Parse metadata from a SKILL.md file using Obsidian's metadata cache
	 */
	private async parseSkillMetadata(file: TFile, dirName: string): Promise<SkillMetadata | null> {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		if (!frontmatter || !frontmatter.name || !frontmatter.description) {
			this.plugin.logger.warn(`Skill at ${file.path} missing required frontmatter (name, description)`);
			return null;
		}

		// Validate that frontmatter name matches directory name
		// Always use dirName as the canonical name to ensure loadSkill() can resolve it
		if (frontmatter.name !== dirName) {
			this.plugin.logger.warn(
				`Skill name "${frontmatter.name}" does not match directory name "${dirName}" at ${file.path}. Using directory name.`
			);
		}

		return {
			name: dirName,
			description: frontmatter.description,
			license: frontmatter.license || undefined,
			compatibility: frontmatter.compatibility || undefined,
			metadata: frontmatter.metadata || undefined,
			path: file.parent?.path || '',
		};
	}

	/**
	 * Load the full SKILL.md body content for a specific skill (progressive disclosure - level 2)
	 */
	async loadSkill(name: string): Promise<string | null> {
		// Validate name to prevent path traversal
		const nameValidation = this.validateSkillName(name);
		if (!nameValidation.valid) {
			return null;
		}

		const skillMdPath = normalizePath(`${this.getSkillsFolderPath()}/${name}/${SKILL_MD_FILENAME}`);
		const file = this.plugin.app.vault.getAbstractFileByPath(skillMdPath);

		if (!(file instanceof TFile)) {
			return null;
		}

		const fullContent = await this.plugin.app.vault.read(file);
		const cache = this.plugin.app.metadataCache.getFileCache(file);

		// Strip frontmatter, return only body content
		if (cache?.frontmatterPosition) {
			return fullContent.slice(cache.frontmatterPosition.end.offset).trim();
		}

		return fullContent;
	}

	/**
	 * Read a resource file from within a skill directory (progressive disclosure - level 3)
	 *
	 * @param skillName - Name of the skill
	 * @param relativePath - Path relative to the skill directory (e.g., "references/REFERENCE.md")
	 */
	async readSkillResource(skillName: string, relativePath: string): Promise<string | null> {
		// Validate skill name to prevent path traversal
		const nameValidation = this.validateSkillName(skillName);
		if (!nameValidation.valid) {
			return null;
		}

		// Validate relativePath doesn't escape the skill directory
		if (relativePath.includes('..') || relativePath.startsWith('/')) {
			return null;
		}

		const resourcePath = normalizePath(`${this.getSkillsFolderPath()}/${skillName}/${relativePath}`);

		// Verify resolved path stays within the skill directory
		const skillDir = normalizePath(`${this.getSkillsFolderPath()}/${skillName}`);
		if (!resourcePath.startsWith(skillDir + '/')) {
			return null;
		}

		const file = this.plugin.app.vault.getAbstractFileByPath(resourcePath);

		if (!(file instanceof TFile)) {
			return null;
		}

		return await this.plugin.app.vault.read(file);
	}

	/**
	 * List available resources within a skill directory
	 */
	async listSkillResources(skillName: string): Promise<string[]> {
		// Validate skill name to prevent path traversal
		const nameValidation = this.validateSkillName(skillName);
		if (!nameValidation.valid) {
			return [];
		}

		const skillDir = normalizePath(`${this.getSkillsFolderPath()}/${skillName}`);
		const folder = this.plugin.app.vault.getAbstractFileByPath(skillDir);

		if (!(folder instanceof TFolder)) {
			return [];
		}

		const resources: string[] = [];
		this.collectFiles(folder, skillDir, resources);
		return resources;
	}

	/**
	 * Recursively collect file paths relative to a base directory
	 */
	private collectFiles(folder: TFolder, basePath: string, results: string[]): void {
		for (const child of folder.children) {
			if (child instanceof TFile) {
				// Get path relative to the skill directory
				const relativePath = child.path.slice(basePath.length + 1);
				// Skip SKILL.md itself
				if (relativePath !== SKILL_MD_FILENAME) {
					results.push(relativePath);
				}
			} else if (child instanceof TFolder) {
				this.collectFiles(child, basePath, results);
			}
		}
	}

	/**
	 * Get skill summaries for system prompt injection (name + description only)
	 */
	async getSkillSummaries(): Promise<SkillSummary[]> {
		const skills = await this.discoverSkills();
		return skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
		}));
	}

	/**
	 * Create a new skill with a SKILL.md file
	 */
	async createSkill(name: string, description: string, content: string): Promise<string> {
		// Validate name
		const nameValidation = this.validateSkillName(name);
		if (!nameValidation.valid) {
			throw new Error(nameValidation.error!);
		}

		// Ensure skills directory exists
		await this.ensureSkillsDirectory();

		// Check for duplicates
		const skillDir = normalizePath(`${this.getSkillsFolderPath()}/${name}`);
		const existing = this.plugin.app.vault.getAbstractFileByPath(skillDir);
		if (existing) {
			throw new Error(`Skill "${name}" already exists`);
		}

		// Create skill directory
		await this.plugin.app.vault.createFolder(skillDir);

		// Create SKILL.md with empty frontmatter block, then use processFrontMatter for safe YAML
		const skillMdPath = normalizePath(`${skillDir}/${SKILL_MD_FILENAME}`);
		const file = await this.plugin.app.vault.create(skillMdPath, `---\n---\n\n${content}`);
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.name = name;
			frontmatter.description = description;
		});

		return skillMdPath;
	}

	/**
	 * Validate a skill name per the agentskills.io specification:
	 * - 1-64 characters
	 * - Lowercase alphanumeric and hyphens only
	 * - Must not start or end with hyphen
	 * - Must not contain consecutive hyphens
	 */
	validateSkillName(name: string): { valid: boolean; error?: string } {
		if (!name || typeof name !== 'string') {
			return { valid: false, error: 'Skill name is required' };
		}

		if (name.length > SKILL_NAME_MAX_LENGTH) {
			return { valid: false, error: `Skill name must be ${SKILL_NAME_MAX_LENGTH} characters or fewer` };
		}

		if (name.includes('--')) {
			return { valid: false, error: 'Skill name must not contain consecutive hyphens (--)' };
		}

		if (!SKILL_NAME_REGEX.test(name)) {
			return {
				valid: false,
				error:
					'Skill name must contain only lowercase alphanumeric characters and hyphens, and must not start or end with a hyphen',
			};
		}

		return { valid: true };
	}
}
