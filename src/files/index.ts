import ObsidianGemini from '../main';
import { FileContextTree } from './file-context';
import { TFile } from 'obsidian';
import { logDebugInfo } from '../api/utils/debug';

export class ScribeFile {
	private plugin: ObsidianGemini;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	async getCurrentFileContent(
		depth: number = this.plugin.settings.maxContextDepth,
		renderContent: boolean = false
	): Promise<string | null> {
		if (!this.plugin.settings.sendContext) {
			return null;
		}
		const activeFile = this.getActiveFile();
		if (activeFile) {
			const fileContext = new FileContextTree(this.plugin, depth);
			await fileContext.initialize(activeFile, renderContent);
			return fileContext.toString();
		} else {
			return null;
		}
	}

	async buildFileContext(
		files: TFile[],
		depth: number = this.plugin.settings.maxContextDepth,
		renderContent: boolean = false
	): Promise<string | null> {
		if (!this.plugin.settings.sendContext || files.length === 0) {
			return null;
		}

		// Build context from multiple files
		const contextParts: string[] = [];
		
		for (const file of files) {
			const fileContext = new FileContextTree(this.plugin, depth);
			await fileContext.initialize(file, renderContent);
			const contextString = fileContext.toString();
			if (contextString) {
				contextParts.push(contextString);
			}
		}

		return contextParts.join('\n\n---\n\n');
	}

	async addToFrontMatter(key: string, value: string) {
		const activeFile = this.getActiveFile();
		if (activeFile) {
			// Use processFrontMatter to add or update the summary in the frontmatter
			this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
				frontmatter[key] = value;
			});
		}
	}

	async replaceTextInActiveFile(newText: string) {
		const activeFile = this.getActiveFile();
		const vault = this.plugin.app.vault;

		if (activeFile) {
			vault.modify(activeFile, newText);
		}
	}

	getActiveFile(): TFile | null {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (this.isFile(activeFile)) {
			return activeFile;
		} else {
			logDebugInfo(this.plugin.settings.debugMode, 'File System', 'No active file found.');
			return null;
		}
	}

	isFile(file: TFile | null): boolean {
		if (file && file instanceof TFile) {
			return true;
		} else {
			return false;
		}
	}

	isMarkdownFile(file: TFile | null): boolean {
		if (file && this.isFile(file) && file.extension === 'md') {
			return true;
		} else {
			return false;
		}
	}

	getLinkText(file: TFile, linkPath: string): string {
		const link = this.plugin.app.metadataCache.fileToLinktext(file, linkPath, true);
		return `[[${link}]]`;
	}

	normalizePath(linkPath: string, file: TFile): TFile | null {
		const path = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
		if (this.isMarkdownFile(path)) {
			return path; // This is already the normalized path
		} else {
			return null; // Path refers to a folder or doesn't exist
		}
	}

	normalizeLinkPathsFromMetadata(file: TFile): { links: TFile[]; embeds: TFile[]; frontmatterLinks: TFile[] } {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const normalizedLinks: TFile[] = [];
		const normalizedEmbeds: TFile[] = [];
		const normalizedFrontmatterLinks: TFile[] = [];

		if (cache) {
			if (cache.links) {
				for (const link of cache.links) {
					const normalizedPath = this.normalizePath(link.link, file);
					if (normalizedPath) {
						normalizedLinks.push(normalizedPath);
					} else {
						logDebugInfo(
							this.plugin.settings.debugMode,
							'Link Normalization Warning',
							`Link "${link.link}" in file "${file.path}" could not be normalized.`
						);
					}
				}
			}

			if (cache.embeds) {
				for (const embed of cache.embeds) {
					const normalizedPath = this.normalizePath(embed.link, file);
					if (normalizedPath) {
						normalizedEmbeds.push(normalizedPath);
					} else {
						logDebugInfo(
							this.plugin.settings.debugMode,
							'Link Normalization Warning',
							`Embed "${embed.link}" in file "${file.path}" could not be normalized.`
						);
					}
				}
			}

			if (cache.frontmatterLinks) {
				for (const link of cache.frontmatterLinks) {
					const normalizedPath = this.normalizePath(link.link, file);
					if (normalizedPath) {
						normalizedFrontmatterLinks.push(normalizedPath);
					} else {
						logDebugInfo(
							this.plugin.settings.debugMode,
							'Link Normalization Warning',
							`Frontmatter link "${link.link}" in file "${file.path}" could not be normalized.`
						);
					}
				}
			}

			if (cache.frontmatter) {
				if (cache.frontmatter.links) {
					if (Array.isArray(cache.frontmatter.links)) {
						cache.frontmatter.links.forEach((link) => {
							const normalizedPath = this.normalizePath.call(this, link);
							if (normalizedPath) {
								normalizedFrontmatterLinks.push(normalizedPath);
							} else {
								logDebugInfo(
									this.plugin.settings.debugMode,
									'Link Normalization Warning',
									`Frontmatter link "${link}" in file "${file.path}" could not be normalized.`
								);
							}
						});
					} else if (typeof cache.frontmatter.links === 'string') {
						const normalizedPath = this.normalizePath.call(this, cache.frontmatter.links);
						if (normalizedPath) {
							normalizedFrontmatterLinks.push(normalizedPath);
						} else {
							logDebugInfo(
								this.plugin.settings.debugMode,
								'Link Normalization Warning',
								`Frontmatter link "${cache.frontmatter.links}" in file "${file.path}" could not be normalized.`
							);
						}
					}
				}
			}
		}

		return { links: normalizedLinks, embeds: normalizedEmbeds, frontmatterLinks: normalizedFrontmatterLinks };
	}

	getUniqueLinks(file: TFile): Set<TFile> {
		const { links, embeds, frontmatterLinks } = this.normalizeLinkPathsFromMetadata(file);
		const allLinks = new Set([...links, ...embeds, ...frontmatterLinks]);
		return allLinks;
	}
}
