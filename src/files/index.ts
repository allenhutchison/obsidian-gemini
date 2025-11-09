import ObsidianGemini from '../main';
import { TFile } from 'obsidian';
import { logDebugInfo } from '../api/utils/debug';
import { GeminiPrompts } from '../prompts/gemini-prompts';

export class ScribeFile {
	private plugin: ObsidianGemini;

	constructor(plugin: ObsidianGemini) {
		this.plugin = plugin;
	}

	async getCurrentFileContent(
		renderContent: boolean = false
	): Promise<string | null> {
		const activeFile = this.getActiveFile();
		if (activeFile) {
			// Just return the current file content (no link traversal)
			const content = await this.plugin.app.vault.read(activeFile);
			return content;
		} else {
			return null;
		}
	}

	async buildFileContext(
		files: TFile[],
		renderContent: boolean = false
	): Promise<string | null> {
		if (files.length === 0) {
			return null;
		}

		// Build context from explicit files only (no link traversal)
		// The agent can follow links dynamically using read_file tool
		const contextParts: string[] = [];
		const prompts = new GeminiPrompts(this.plugin);

		for (const file of files) {
			try {
				// Read file content
				const fileContent = await this.plugin.app.vault.read(file);

				// Format using context prompt template
				const contextString = prompts.contextPrompt({
					file_label: 'Context File',
					file_name: file.path,
					wikilink: this.getLinkText(file, file.path),
					file_contents: fileContent
				});

				contextParts.push(contextString);
			} catch (error) {
				console.error(`Failed to read file ${file.path}:`, error);
			}
		}

		if (contextParts.length === 0) {
			return null;
		}

		return 'The following files have been provided as context:\n\n' + contextParts.join('\n\n---\n\n');
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
