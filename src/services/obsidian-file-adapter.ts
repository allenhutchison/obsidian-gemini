import { TFile, Vault, MetadataCache } from 'obsidian';
import { FileSystemAdapter, FileInfo, FileContent } from '@allenhutchison/gemini-utils';

/**
 * Obsidian Vault adapter for the gemini-utils FileSystemAdapter interface.
 * Allows using the shared FileUploader with Obsidian's vault system.
 */
export class ObsidianVaultAdapter implements FileSystemAdapter {
	private vault: Vault;
	private metadataCache: MetadataCache;
	private excludeFolders: string[];
	private historyFolder: string;

	constructor(options: {
		vault: Vault;
		metadataCache: MetadataCache;
		excludeFolders?: string[];
		historyFolder?: string;
	}) {
		this.vault = options.vault;
		this.metadataCache = options.metadataCache;
		this.excludeFolders = options.excludeFolders || [];
		this.historyFolder = options.historyFolder || '';
	}

	/**
	 * List all markdown files in the vault that should be indexed.
	 */
	async listFiles(_basePath: string): Promise<string[]> {
		const files = this.vault.getMarkdownFiles();
		return files
			.filter(file => this.shouldIndex(file.path))
			.map(file => file.path);
	}

	/**
	 * Get file info/metadata.
	 */
	async getFileInfo(filePath: string): Promise<FileInfo | null> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		return {
			path: file.path,
			size: file.stat.size,
			mtime: new Date(file.stat.mtime).toISOString(),
			mimeType: 'text/markdown',
		};
	}

	/**
	 * Read file content for upload.
	 */
	async readFileForUpload(filePath: string, relativePath: string): Promise<FileContent | null> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		try {
			const content = await this.vault.read(file);

			// Skip empty or very small files
			if (!content || content.trim().length < 10) {
				return null;
			}

			const hash = await this.computeHash(filePath);

			// Create a Blob from the content
			const blob = new Blob([content], { type: 'text/markdown' });

			// Extract Obsidian-specific metadata (folder, tags, aliases)
			const customMetadata = this.extractMetadata(file);

			return {
				data: blob,
				mimeType: 'text/markdown',
				displayName: file.path,
				relativePath,
				hash,
				lastModified: new Date(file.stat.mtime).toISOString(),
				customMetadata,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Compute a hash for change detection.
	 * Uses mtime:size for fast comparison (matching existing rag-indexing behavior).
	 */
	async computeHash(filePath: string): Promise<string> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return '';
		}

		return `${file.stat.mtime}:${file.stat.size}`;
	}

	/**
	 * Check if a file should be indexed.
	 */
	shouldIndex(filePath: string): boolean {
		// Only index markdown files
		if (!filePath.endsWith('.md')) {
			return false;
		}

		// Exclude system folders
		if (filePath.startsWith('.obsidian/')) {
			return false;
		}

		// Exclude history folder
		if (this.historyFolder && filePath.startsWith(this.historyFolder + '/')) {
			return false;
		}

		// Check user-configured exclude folders
		for (const folder of this.excludeFolders) {
			if (filePath.startsWith(folder + '/') || filePath === folder) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Extract metadata from a file for indexing.
	 * This is Obsidian-specific and provides rich metadata from frontmatter.
	 * Note: path, hash, and last_modified are added by FileUploader, so we only
	 * add Obsidian-specific metadata here (folder, tags, aliases).
	 */
	extractMetadata(file: TFile): Array<{ key: string; stringValue: string }> {
		const metadata: Array<{ key: string; stringValue: string }> = [];

		// Add folder
		metadata.push({ key: 'folder', stringValue: file.parent?.path || '' });

		// Extract frontmatter
		const cache = this.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		if (fm) {
			// Add tags
			if (Array.isArray(fm.tags)) {
				const tags = fm.tags.join(', ');
				if (tags.length <= 256) {
					metadata.push({ key: 'tags', stringValue: tags });
				} else {
					metadata.push({ key: 'tags', stringValue: tags.substring(0, 253) + '...' });
				}
			}

			// Add aliases
			if (Array.isArray(fm.aliases)) {
				const aliases = fm.aliases.join(', ');
				if (aliases.length <= 256) {
					metadata.push({ key: 'aliases', stringValue: aliases });
				} else {
					metadata.push({ key: 'aliases', stringValue: aliases.substring(0, 253) + '...' });
				}
			}
		}

		return metadata;
	}
}
