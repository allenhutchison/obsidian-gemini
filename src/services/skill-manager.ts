import { TFile, TFolder, normalizePath, EventRef } from 'obsidian';
import type ObsidianGemini from '../main';
import type { Skill, SkillFrontmatter, SkillParseResult } from '../types/skill';
import { DEFAULT_SKILL_STRUCTURES } from './default-skills';

/**
 * Manages skill discovery, parsing, and registration.
 * Skills are markdown files with YAML frontmatter following the agentskills.io spec.
 */
export class SkillManager {
	private skills: Map<string, Skill> = new Map();
	private readonly plugin: InstanceType<typeof ObsidianGemini>;
	private initialized = false;
	private watchers: EventRef[] = [];

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
	}

	/**
	 * Initialize the skill manager by loading all skills from the configured folder
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;
		await this.ensureDefaultSkills();
		await this.loadSkills();
		this.registerFileWatcher();
		this.initialized = true;
	}

	/**
	 * Check if the manager has been initialized
	 */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Unload the skill manager and clean up event listeners
	 */
	unload(): void {
		this.skills.clear();
		// Unregister file watchers
		for (const ref of this.watchers) {
			this.plugin.app.vault.offref(ref);
		}
		this.watchers = [];
		this.initialized = false;
	}

	/**
	 * Ensure default skills exist in the skills folder
	 * Creates folder structure per agentskills.io: skill-name/SKILL.md + references/
	 */
	private async ensureDefaultSkills(): Promise<void> {
		const skillsFolder = this.getSkillsFolder();
		if (!skillsFolder) return;

		// Ensure root skills folder exists
		await this.ensureFolderExists(skillsFolder);

		// Create each skill with its references
		for (const skillStructure of DEFAULT_SKILL_STRUCTURES) {
			const skillFolderPath = normalizePath(`${skillsFolder}/${skillStructure.skillName}`);
			const skillFilePath = normalizePath(`${skillFolderPath}/SKILL.md`);
			const referencesFolderPath = normalizePath(`${skillFolderPath}/references`);

			// Create skill folder
			await this.ensureFolderExists(skillFolderPath);

			// Create SKILL.md if it doesn't exist
			await this.createFileIfNotExists(skillFilePath, skillStructure.skillMd);

			// Create references folder and files
			if (Object.keys(skillStructure.references).length > 0) {
				await this.ensureFolderExists(referencesFolderPath);

				for (const [filename, content] of Object.entries(skillStructure.references)) {
					const refFilePath = normalizePath(`${referencesFolderPath}/${filename}`);
					await this.createFileIfNotExists(refFilePath, content);
				}
			}

			this.plugin.logger.log(`[SkillManager] Ensured default skill: ${skillStructure.skillName}`);
		}
	}

	/**
	 * Helper: Ensure a folder exists
	 */
	private async ensureFolderExists(path: string): Promise<void> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(path);
		if (folder) {
			if (!(folder instanceof TFolder)) {
				this.plugin.logger.warn(`[SkillManager] Cannot create folder ${path}: File with same name exists`);
			}
			return;
		}

		try {
			await this.plugin.app.vault.createFolder(path);
		} catch (e) {
			// Ignore if already exists (race condition)
		}
	}

	/**
	 * Helper: Create file if it doesn't exist
	 */
	private async createFileIfNotExists(path: string, content: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!file) {
			try {
				await this.plugin.app.vault.create(path, content);
			} catch (error) {
				this.plugin.logger.warn(`[SkillManager] Failed to create file ${path}: ${error}`);
			}
		}
	}

	/**
	 * Load all skills from the skills folder
	 * Per agentskills.io: each skill is a subfolder with SKILL.md inside
	 */
	async loadSkills(): Promise<void> {
		this.skills.clear();

		const skillsFolder = this.getSkillsFolder();
		if (!skillsFolder) {
			this.plugin.logger.log('[SkillManager] Skills folder not configured or does not exist');
			return;
		}

		const folder = this.plugin.app.vault.getAbstractFileByPath(skillsFolder);
		if (!(folder instanceof TFolder)) {
			this.plugin.logger.log(`[SkillManager] Skills folder does not exist: ${skillsFolder}`);
			return;
		}

		// Scan subfolders for SKILL.md files (per agentskills.io protocol)
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				// Look for SKILL.md inside the skill folder
				const skillFilePath = `${child.path}/SKILL.md`;
				const skillFile = this.plugin.app.vault.getAbstractFileByPath(skillFilePath);

				if (skillFile instanceof TFile) {
					const result = await this.parseSkillFile(skillFile);
					if (result.success && result.skill) {
						this.skills.set(result.skill.name, result.skill);
						this.plugin.logger.log(`[SkillManager] Loaded skill: ${result.skill.name}`);
					} else if (result.error) {
						this.plugin.logger.warn(`[SkillManager] Failed to parse skill ${skillFile.path}: ${result.error}`);
					}
				}
			}
		}

		this.plugin.logger.log(`[SkillManager] Loaded ${this.skills.size} skills`);
	}

	/**
	 * Parse a skill file and extract frontmatter + instructions
	 */
	async parseSkillFile(file: TFile): Promise<SkillParseResult> {
		try {
			const content = await this.plugin.app.vault.read(file);
			return this.parseSkillContent(content, file.path);
		} catch (error) {
			return {
				success: false,
				error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Parse skill content (frontmatter)
	 */
	parseSkillContent(content: string, sourcePath: string): SkillParseResult {
		if (!content || content.trim().length === 0) {
			return { success: false, error: 'Empty file' };
		}

		// Extract frontmatter
		const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

		let frontmatter: SkillFrontmatter;

		if (frontmatterMatch) {
			try {
				frontmatter = this.parseYamlFrontmatter(frontmatterMatch[1]);
			} catch (error) {
				return {
					success: false,
					error: `Invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		} else {
			// No frontmatter - treat as invalid skill since metadata is required for discovery
			return {
				success: false,
				error: 'Missing YAML frontmatter (required for Agent Skills)',
			};
		}

		// Validate required fields
		if (!frontmatter.name || frontmatter.name.trim().length === 0) {
			const filename = sourcePath.split('/').pop()?.replace('.md', '') || 'unknown';
			frontmatter.name = filename;
		}

		const skill: Skill = {
			name: frontmatter.name.trim().toLowerCase().replace(/\s+/g, '-'),
			description: frontmatter.description || '',
			tools: frontmatter.tools || [],
			sourcePath,
		};

		return { success: true, skill };
	}

	/**
	 * Parse YAML frontmatter into SkillFrontmatter object
	 * Simple parser for common YAML patterns
	 */
	private parseYamlFrontmatter(yaml: string): SkillFrontmatter {
		const result: SkillFrontmatter = { name: '' };
		const lines = yaml.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(/^(\w+):\s*(.*)$/);
			if (!match) continue;

			const [, key, value] = match;

			switch (key) {
				case 'name':
					result.name = value.trim().replace(/^["']|["']$/g, '');
					break;
				case 'description':
					result.description = value.trim().replace(/^["']|["']$/g, '');
					break;
				case 'tools': {
					// Handle array format: [tool1, tool2]
					const trimmedValue = value.trim();
					if (trimmedValue.startsWith('[')) {
						result.tools = trimmedValue
							.slice(1, -1)
							.split(',')
							.map((t) => t.trim().replace(/^["']|["']$/g, ''))
							.filter((t) => t.length > 0);
					} else {
						// Handle list format:
						// tools:
						//   - tool1
						//   - tool2
						const tools: string[] = [];
						// Check subsequent lines
						let j = i + 1;
						while (j < lines.length) {
							const nextLine = lines[j];
							const listMatch = nextLine.match(/^\s*-\s+(.+)$/);
							if (listMatch) {
								tools.push(listMatch[1].trim().replace(/^["']|["']$/g, ''));
								j++;
							} else if (nextLine.trim() === '' || nextLine.trim().startsWith('#')) {
								j++; // Skip empty lines or comments
							} else {
								break; // End of list
							}
						}
						if (tools.length > 0) {
							result.tools = tools;
							i = j - 1; // Advance main loop
						} else if (trimmedValue.length > 0) {
							// Single inline value: tools: read_file
							result.tools = [trimmedValue.replace(/^["']|["']$/g, '')];
						}
					}
					break;
				}
				case 'license':
					result.license = value.trim().replace(/^["']|["']$/g, '');
					break;
			}
		}

		return result;
	}

	/**
	 * Register file watcher for skills folder
	 */
	private registerFileWatcher(): void {
		const skillsFolder = this.getSkillsFolder();
		if (!skillsFolder) return;

		// Watch for file creation
		const createRef = this.plugin.app.vault.on('create', async (file) => {
			if (file instanceof TFile && this.isInSkillsFolder(file)) {
				const result = await this.parseSkillFile(file);
				if (result.success && result.skill) {
					this.skills.set(result.skill.name, result.skill);
					this.plugin.logger.log(`[SkillManager] Added skill: ${result.skill.name}`);
				}
			}
		});
		this.watchers.push(createRef);
		this.plugin.registerEvent(createRef);

		// Watch for file modification
		const modifyRef = this.plugin.app.vault.on('modify', async (file) => {
			if (file instanceof TFile && this.isInSkillsFolder(file)) {
				// Remove any existing skill with this source path (handles name changes)
				for (const [name, skill] of this.skills) {
					if (skill.sourcePath === file.path) {
						this.skills.delete(name);
						break;
					}
				}
				const result = await this.parseSkillFile(file);
				if (result.success && result.skill) {
					this.skills.set(result.skill.name, result.skill);
					this.plugin.logger.log(`[SkillManager] Updated skill: ${result.skill.name}`);
				}
			}
		});
		this.watchers.push(modifyRef);
		this.plugin.registerEvent(modifyRef);

		// Watch for file deletion
		const deleteRef = this.plugin.app.vault.on('delete', async (file) => {
			if (file instanceof TFile && this.isInSkillsFolder(file)) {
				// Find and remove the skill by source path
				for (const [name, skill] of this.skills) {
					if (skill.sourcePath === file.path) {
						this.skills.delete(name);
						this.plugin.logger.log(`[SkillManager] Removed skill: ${name}`);
						break;
					}
				}
			}
		});
		this.watchers.push(deleteRef);
		this.plugin.registerEvent(deleteRef);

		// Watch for file rename
		const renameRef = this.plugin.app.vault.on('rename', async (file, oldPath) => {
			if (file instanceof TFile) {
				// Remove old skill if it was in skills folder
				for (const [name, skill] of this.skills) {
					if (skill.sourcePath === oldPath) {
						this.skills.delete(name);
						break;
					}
				}
				// Add new skill if new location is in skills folder
				if (this.isInSkillsFolder(file)) {
					const result = await this.parseSkillFile(file);
					if (result.success && result.skill) {
						this.skills.set(result.skill.name, result.skill);
						this.plugin.logger.log(`[SkillManager] Renamed skill: ${result.skill.name}`);
					}
				}
			}
		});
		this.watchers.push(renameRef);
		this.plugin.registerEvent(renameRef);
	}

	/**
	 * Check if a file is in the skills folder
	 */
	private isInSkillsFolder(file: TFile): boolean {
		const skillsFolder = this.getSkillsFolder();
		if (!skillsFolder) return false;

		// Check if file is anywhere within the skills folder tree (including subfolders)
		const normalizedSkillsFolder = normalizePath(skillsFolder);
		return file.path.startsWith(normalizedSkillsFolder + '/') && file.extension === 'md';
	}

	/**
	 * Get the configured skills folder path
	 */
	private getSkillsFolder(): string | null {
		const folder = this.plugin.settings.skillsFolder;
		return folder && folder.trim().length > 0 ? folder : null;
	}

	/**
	 * Get all available skills
	 */
	getAvailableSkills(): Skill[] {
		return Array.from(this.skills.values());
	}

	/**
	 * Generate XML prompt for AI skill discovery per Agent Skills spec.
	 * The AI uses this to autonomously discover and activate relevant skills.
	 * @see https://agentskills.io/integrate-skills
	 */
	getSkillsPromptXML(): string | null {
		const skills = this.getAvailableSkills();
		if (skills.length === 0) {
			return null;
		}

		const skillEntries = skills
			.map((skill) => {
				const toolsList =
					skill.tools.length > 0 ? `\n    <tools>${this.escapeXml(skill.tools.join(', '))}</tools>` : '';
				return `  <skill>
    <name>${this.escapeXml(skill.name)}</name>
    <description>${this.escapeXml(skill.description)}</description>
    <location>${this.escapeXml(skill.sourcePath)}</location>${toolsList}
  </skill>`;
			})
			.join('\n');

		return `<available_skills>
${skillEntries}
</available_skills>

When a user's request matches a skill's description, read the skill file using read_file to load its full instructions, then follow those instructions.`;
	}

	/**
	 * Escape XML special characters
	 */
	private escapeXml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&apos;');
	}

	/**
	 * Get a skill by name
	 */
	getSkill(name: string): Skill | undefined {
		return this.skills.get(name.toLowerCase());
	}

	/**
	 * Check if a skill exists
	 */
	hasSkill(name: string): boolean {
		return this.skills.has(name.toLowerCase());
	}

	/**
	 * Clear all skills (for testing)
	 */
	clear(): void {
		this.skills.clear();
	}

	/**
	 * Validate that a skill's tools are available in the registry
	 * Returns list of invalid tool names
	 */
	validateSkillTools(skill: Skill): string[] {
		const invalidTools: string[] = [];

		for (const toolName of skill.tools) {
			if (!this.plugin.toolRegistry?.getTool(toolName)) {
				invalidTools.push(toolName);
			}
		}

		return invalidTools;
	}
}
