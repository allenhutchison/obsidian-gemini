import { TFile, TFolder, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { ensureFolderExists } from '../utils/file-utils';
import { BundledSkillRegistry } from './bundled-skills';

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
 * Find the byte offset of the closing `---` of a YAML frontmatter block in a file's content.
 * Returns the offset AFTER the closing delimiter (inclusive of its trailing newline if present),
 * or undefined if the content does not begin with a valid frontmatter block.
 *
 * Unlike a naive `---[\s\S]*?---` regex, this walks the content line-by-line so that
 * `---` sequences appearing inside multi-line YAML string values (or body content) do
 * not prematurely terminate the frontmatter match.
 */
export function findFrontmatterEndOffset(content: string): number | undefined {
	// Frontmatter must begin on line 1 with a `---` marker.
	if (!/^---(\r?\n|$)/.test(content)) return undefined;

	// Walk character by character tracking line starts. We look for a line that
	// is exactly `---` (or `...`) as a closing marker per the YAML spec.
	let i = 0;
	const len = content.length;
	// Skip the opening `---` and its line terminator.
	i = content.indexOf('\n', 0);
	if (i === -1) return undefined;
	i += 1;

	while (i < len) {
		// Find end of current line.
		let lineEnd = content.indexOf('\n', i);
		if (lineEnd === -1) lineEnd = len;
		let line = content.slice(i, lineEnd);
		// Strip trailing CR for CRLF files.
		if (line.endsWith('\r')) line = line.slice(0, -1);
		if (line === '---' || line === '...') {
			// Closing marker — return offset just after it (before the newline).
			return i + line.length;
		}
		i = lineEnd + 1;
	}
	return undefined;
}

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
		return normalizePath(`${this.plugin.settings.historyFolder}/Skills`);
	}

	/**
	 * Discover all skills in the skills directory.
	 * Scans for subdirectories containing SKILL.md and parses their frontmatter.
	 */
	async discoverSkills(): Promise<SkillMetadata[]> {
		const skillsDir = this.getSkillsFolderPath();
		const folder = this.plugin.app.vault.getAbstractFileByPath(skillsDir);

		const skills: SkillMetadata[] = [];

		if (folder instanceof TFolder) {
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
		}

		// Merge bundled skills (vault takes priority)
		const vaultNames = new Set(skills.map((s) => s.name));
		for (const summary of BundledSkillRegistry.getSummaries()) {
			if (!vaultNames.has(summary.name)) {
				skills.push({
					name: summary.name,
					description: summary.description,
					path: 'bundled',
				});
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
			// Fall back to bundled skills
			return BundledSkillRegistry.loadSkill(name);
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
			// Fall back to bundled skill resources
			return BundledSkillRegistry.readResource(skillName, relativePath);
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
			// Fall back to bundled skill resources
			return BundledSkillRegistry.listResources(skillName);
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

		// Check for duplicates
		const skillDir = normalizePath(`${this.getSkillsFolderPath()}/${name}`);
		const existing = this.plugin.app.vault.getAbstractFileByPath(skillDir);
		if (existing) {
			throw new Error(`Skill "${name}" already exists`);
		}

		// Create skill directory
		await ensureFolderExists(this.plugin.app.vault, skillDir, `skill "${name}"`, this.plugin.logger);

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
	 * Update an existing skill's SKILL.md content and/or description
	 */
	async updateSkill(name: string, description?: string, content?: string): Promise<string> {
		// Validate name
		const nameValidation = this.validateSkillName(name);
		if (!nameValidation.valid) {
			throw new Error(nameValidation.error!);
		}

		// Reject no-op updates at the service boundary
		if (description === undefined && content === undefined) {
			throw new Error('At least one of description or content must be provided');
		}

		const skillMdPath = normalizePath(`${this.getSkillsFolderPath()}/${name}/${SKILL_MD_FILENAME}`);
		const file = this.plugin.app.vault.getAbstractFileByPath(skillMdPath);

		if (!(file instanceof TFile)) {
			throw new Error(`Skill "${name}" not found`);
		}

		// Update body content if provided
		if (content !== undefined) {
			const fullContent = await this.plugin.app.vault.read(file);
			const cache = this.plugin.app.metadataCache.getFileCache(file);

			// Prefer the metadata cache position — it's authoritative. Fall back to
			// a line-based scan only when the cache is unavailable (e.g. file was
			// just written). A naive non-greedy regex like /---[\s\S]*?---/ can
			// incorrectly match `---` delimiters that appear inside multi-line YAML
			// string values, so we do a proper line walk: line 1 must be `---` and
			// the next `---` on its own line closes the frontmatter block.
			const cachedFrontmatterEnd = cache?.frontmatterPosition?.end.offset;
			const frontmatterEnd = cachedFrontmatterEnd ?? findFrontmatterEndOffset(fullContent);

			const trimmedContent = content.trim();
			const newFullContent =
				frontmatterEnd !== undefined
					? `${fullContent.slice(0, frontmatterEnd).trimEnd()}\n\n${trimmedContent}`
					: trimmedContent;

			await this.plugin.app.vault.modify(file, newFullContent);
		}

		// Update description in frontmatter if provided
		if (description !== undefined) {
			await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter.name ??= name;
				frontmatter.description = description;
			});
		}

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
