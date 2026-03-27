import { TFile } from 'obsidian';
import type ObsidianGemini from '../main';
import { Project, ProjectConfig, ProjectSummary, PROJECT_TAG } from '../types/project';
import { ToolPermission } from '../types/tool-policy';

/** Regex to strip dataview/dataviewjs/bases fenced code blocks from body text */
const UNSUPPORTED_CODE_BLOCK_RE = /```(?:dataview|dataviewjs|bases?)[\s\S]*?```/g;

/** Map user-facing permission strings to ToolPermission enum values */
const PERMISSION_MAP: Record<string, ToolPermission> = {
	allow: ToolPermission.APPROVE,
	approve: ToolPermission.APPROVE,
	deny: ToolPermission.DENY,
	ask: ToolPermission.ASK_USER,
	ask_user: ToolPermission.ASK_USER,
};

/**
 * Discovers, parses, and caches project definitions from the vault.
 * A project is any Markdown file with the `gemini-scribe/project` tag.
 */
export class ProjectManager {
	private plugin: InstanceType<typeof ObsidianGemini>;
	private projectCache: Map<string, Project> = new Map();

	constructor(plugin: InstanceType<typeof ObsidianGemini>) {
		this.plugin = plugin;
	}

	/**
	 * Scan the vault for project files and populate the cache.
	 * Should be called from onLayoutReady() when metadataCache is ready.
	 */
	async initialize(): Promise<void> {
		this.projectCache.clear();

		const files = this.plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			if (this.isProjectFile(file)) {
				try {
					const project = await this.parseProjectFile(file);
					if (project) {
						this.projectCache.set(file.path, project);
					}
				} catch (error) {
					this.plugin.logger.warn(`Failed to parse project at ${file.path}:`, error);
				}
			}
		}

		this.plugin.logger.log(`ProjectManager: Discovered ${this.projectCache.size} project(s)`);
	}

	/**
	 * Get lightweight summaries of all discovered projects.
	 */
	discoverProjects(): ProjectSummary[] {
		return Array.from(this.projectCache.values()).map((p) => ({
			name: p.config.name,
			filePath: p.file.path,
			rootPath: p.rootPath,
		}));
	}

	/**
	 * Get a fully resolved project by its file path.
	 */
	async getProject(filePath: string): Promise<Project | null> {
		const cached = this.projectCache.get(filePath);
		if (cached) return cached;

		// Try to parse on demand
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return null;

		const project = await this.parseProjectFile(file);
		if (project) {
			this.projectCache.set(filePath, project);
		}
		return project;
	}

	/**
	 * Find the project that contains a given file path.
	 * Returns the most specific (deepest rootPath) match.
	 */
	getProjectForPath(path: string): Project | null {
		let bestMatch: Project | null = null;
		let bestLength = -1;

		for (const project of this.projectCache.values()) {
			const root = project.rootPath;
			// Root '' matches everything; otherwise check prefix with trailing /
			const isMatch = root === '' ? true : path.startsWith(root + '/') || path === root;
			if (isMatch && root.length > bestLength) {
				bestMatch = project;
				bestLength = root.length;
			}
		}

		return bestMatch;
	}

	/**
	 * Update a project's frontmatter config fields.
	 */
	async updateProjectConfig(filePath: string, updates: Partial<ProjectConfig>): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
			if (updates.name !== undefined) frontmatter.name = updates.name;
			if (updates.skills !== undefined) frontmatter.skills = updates.skills;
			if (updates.permissions !== undefined) {
				// Convert ToolPermission enum values back to user-friendly strings
				const permObj: Record<string, string> = {};
				for (const [tool, perm] of Object.entries(updates.permissions)) {
					permObj[tool] = perm;
				}
				frontmatter.permissions = permObj;
			}
		});

		// Refresh cache
		await this.refreshProject(filePath);
	}

	/**
	 * Register vault event listeners to keep the cache current.
	 */
	registerVaultEvents(): void {
		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					// Defer slightly to let metadataCache index the new file
					setTimeout(() => this.onFileCreateOrModify(file), 500);
				}
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					// Defer to let metadataCache update
					setTimeout(() => this.onFileCreateOrModify(file), 500);
				}
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.projectCache.delete(file.path);
				}
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.projectCache.delete(oldPath);
					if (file.extension === 'md') {
						setTimeout(() => this.onFileCreateOrModify(file), 500);
					}
				}
			})
		);
	}

	/**
	 * Parse a project definition file into a Project object.
	 */
	async parseProjectFile(file: TFile): Promise<Project | null> {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;

		if (!frontmatter || !this.hasTags(frontmatter.tags, PROJECT_TAG)) {
			return null;
		}

		// Parse config from frontmatter
		const config = this.parseConfig(frontmatter, file.basename);

		// Extract body text (strip frontmatter)
		const fullContent = await this.plugin.app.vault.read(file);
		let body = fullContent;
		if (cache?.frontmatterPosition) {
			body = fullContent.slice(cache.frontmatterPosition.end.offset).trim();
		}

		// Strip unsupported code blocks
		const instructions = body.replace(UNSUPPORTED_CODE_BLOCK_RE, '').trim();

		// Resolve wikilinks and embeds
		const contextFiles = this.resolveLinks(cache?.links, file.path);
		const embedFiles = this.resolveLinks(cache?.embeds, file.path);

		const rootPath = file.parent?.path ?? '';

		return { file, config, rootPath, instructions, contextFiles, embedFiles };
	}

	// --- Private helpers ---

	private isProjectFile(file: TFile): boolean {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		return this.hasTags(cache?.frontmatter?.tags, PROJECT_TAG);
	}

	private hasTags(tags: unknown, target: string): boolean {
		if (Array.isArray(tags)) {
			return tags.some((t) => typeof t === 'string' && t === target);
		}
		if (typeof tags === 'string') {
			return tags === target;
		}
		return false;
	}

	private parseConfig(frontmatter: any, defaultName: string): ProjectConfig {
		const name = typeof frontmatter.name === 'string' ? frontmatter.name : defaultName;
		const skills = Array.isArray(frontmatter.skills)
			? frontmatter.skills.filter((s: any) => typeof s === 'string')
			: [];
		const permissions = this.parsePermissions(frontmatter.permissions);

		return { name, skills, permissions };
	}

	private parsePermissions(raw: unknown): Record<string, ToolPermission> {
		if (!raw || typeof raw !== 'object') return {};

		const result: Record<string, ToolPermission> = {};
		for (const [tool, value] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof value !== 'string') continue;
			const mapped = PERMISSION_MAP[value.toLowerCase()];
			if (mapped) {
				result[tool] = mapped;
			} else {
				this.plugin.logger.warn(
					`ProjectManager: Unknown permission value '${value}' for tool '${tool}', defaulting to ask_user`
				);
				result[tool] = ToolPermission.ASK_USER;
			}
		}
		return result;
	}

	private resolveLinks(links: Array<{ link: string }> | undefined, sourcePath: string): TFile[] {
		if (!links) return [];

		const resolved: TFile[] = [];
		for (const link of links) {
			const file = this.plugin.app.metadataCache.getFirstLinkpathDest(link.link, sourcePath);
			if (file instanceof TFile) {
				resolved.push(file);
			}
		}
		return resolved;
	}

	private async onFileCreateOrModify(file: TFile): Promise<void> {
		if (this.isProjectFile(file)) {
			try {
				const project = await this.parseProjectFile(file);
				if (project) {
					this.projectCache.set(file.path, project);
				}
			} catch (error) {
				this.plugin.logger.warn(`ProjectManager: Failed to parse project at ${file.path}:`, error);
			}
		} else {
			// Tag may have been removed — evict if cached
			this.projectCache.delete(file.path);
		}
	}

	private async refreshProject(filePath: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.onFileCreateOrModify(file);
		}
	}
}
