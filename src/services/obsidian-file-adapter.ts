import { TFile, Vault, MetadataCache } from 'obsidian';
import {
	FileSystemAdapter,
	FileInfo,
	FileContent,
	getMimeTypeWithFallback,
	isExtensionSupportedWithFallback,
} from '@allenhutchison/gemini-utils';

/**
 * Obsidian Vault adapter for the gemini-utils FileSystemAdapter interface.
 * Allows using the shared FileUploader with Obsidian's vault system.
 */
export class ObsidianVaultAdapter implements FileSystemAdapter {
	private vault: Vault;
	private metadataCache: MetadataCache;
	private excludeFolders: string[];
	private historyFolder: string;
	private includeAttachments: boolean;
	private logError?: (message: string, ...args: unknown[]) => void;

	constructor(options: {
		vault: Vault;
		metadataCache: MetadataCache;
		excludeFolders?: string[];
		historyFolder?: string;
		includeAttachments?: boolean;
		logError?: (message: string, ...args: unknown[]) => void;
	}) {
		this.vault = options.vault;
		this.metadataCache = options.metadataCache;
		this.excludeFolders = options.excludeFolders || [];
		this.historyFolder = options.historyFolder || '';
		this.includeAttachments = options.includeAttachments || false;
		this.logError = options.logError;
	}

	/**
	 * List all files in the vault that should be indexed.
	 * If includeAttachments is true, includes PDFs and other supported file types.
	 */
	async listFiles(_basePath: string): Promise<string[]> {
		const files = this.includeAttachments ? this.vault.getFiles() : this.vault.getMarkdownFiles();
		return files.filter((file) => this.shouldIndex(file.path)).map((file) => file.path);
	}

	/**
	 * Get file info/metadata.
	 */
	async getFileInfo(filePath: string): Promise<FileInfo | null> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		const mimeResult = getMimeTypeWithFallback(filePath);
		const mimeType = mimeResult?.mimeType || 'application/octet-stream';

		return {
			path: file.path,
			size: file.stat.size,
			mtime: new Date(file.stat.mtime).toISOString(),
			mimeType,
		};
	}

	/**
	 * Check if a MIME type represents a text-based format.
	 * Text types can be read with vault.read(), binary types need vault.readBinary().
	 */
	private isTextMimeType(mimeType: string): boolean {
		// All text/* types are text
		if (mimeType.startsWith('text/')) {
			return true;
		}

		// Common text-based application/* types
		const textApplicationTypes = new Set([
			'application/json',
			'application/ld+json',
			'application/xml',
			'application/javascript',
			'application/x-javascript',
			'application/x-python',
			'application/yaml',
			'application/x-yaml',
			'application/x-sh',
			'application/x-shellscript',
			'application/typescript',
			'application/x-typescript',
			'application/sql',
			'application/graphql',
		]);

		if (textApplicationTypes.has(mimeType)) {
			return true;
		}

		// Match application/*+json and application/*+xml patterns (e.g., application/vnd.api+json)
		if (mimeType.startsWith('application/') && (mimeType.endsWith('+json') || mimeType.endsWith('+xml'))) {
			return true;
		}

		// Everything else (application/pdf, application/octet-stream, etc.) is binary
		return false;
	}

	/**
	 * Read file content for upload.
	 * Handles both text files (markdown, code, etc.) and binary files (PDF, etc.).
	 */
	async readFileForUpload(filePath: string, relativePath: string): Promise<FileContent | null> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			return null;
		}

		try {
			// Determine MIME type
			const mimeResult = getMimeTypeWithFallback(filePath);
			if (!mimeResult) {
				this.logError?.(`Unsupported file type: ${filePath}`);
				return null;
			}
			const mimeType = mimeResult.mimeType;

			const hash = await this.computeHash(filePath);
			let blob: Blob;

			// Check if this is a text or binary file based on MIME type
			if (this.isTextMimeType(mimeType)) {
				// Read text content
				const content = await this.vault.read(file);

				// Skip empty or very small text files
				if (!content || content.trim().length < 10) {
					return null;
				}

				blob = new Blob([content], { type: mimeType });
			} else {
				// Read binary content (PDF, Office docs, etc.)
				const binaryContent = await this.vault.readBinary(file);
				blob = new Blob([binaryContent], { type: mimeType });
			}

			// Extract Obsidian-specific metadata (folder, tags, aliases)
			// Only extract from markdown files (others don't have frontmatter)
			const customMetadata = filePath.endsWith('.md')
				? this.extractMetadata(file)
				: [{ key: 'folder', stringValue: file.parent?.path || '' }];

			return {
				data: blob,
				mimeType,
				displayName: file.path,
				relativePath,
				hash,
				lastModified: new Date(file.stat.mtime).toISOString(),
				customMetadata,
			};
		} catch (error) {
			this.logError?.(`Failed to read file for upload: ${filePath}`, error);
			return null;
		}
	}

	/**
	 * Compute a SHA-256 hash of file content for change detection.
	 * Uses actual content hashing to reliably detect changes across restarts.
	 */
	async computeHash(filePath: string): Promise<string> {
		const file = this.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			// File doesn't exist or isn't a file - return empty to signal "not hashable"
			return '';
		}

		try {
			const content = await this.vault.readBinary(file);
			const hashBuffer = await crypto.subtle.digest('SHA-256', content);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		} catch (error) {
			// Throw error for existing files that fail to hash - prevents storing
			// empty hashes that would break change detection in smartSync
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to compute hash for ${filePath}: ${message}`);
		}
	}

	/**
	 * Check if a file should be indexed.
	 * When includeAttachments is false, only markdown files are indexed.
	 * When includeAttachments is true, any file type supported by gemini-utils is indexed.
	 */
	shouldIndex(filePath: string): boolean {
		// Check file type support
		if (this.includeAttachments) {
			// Extract extension safely - handle files without extensions or dotfiles
			// Use the filename part only to avoid matching dots in folder paths
			const filename = filePath.substring(filePath.lastIndexOf('/') + 1);
			const dotIdx = filename.lastIndexOf('.');
			if (dotIdx <= 0) {
				// No extension (dotIdx === -1) or dotfile (dotIdx === 0) - not indexable
				return false;
			}
			const ext = filename.substring(dotIdx);
			if (!isExtensionSupportedWithFallback(ext)) {
				return false;
			}
		} else {
			// Only index markdown files
			if (!filePath.endsWith('.md')) {
				return false;
			}
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
	 * This is Obsidian-specific and provides rich metadata from frontmatter and inline tags.
	 * Note: path, hash, and last_modified are added by FileUploader, so we only
	 * add Obsidian-specific metadata here (folder, tags, aliases).
	 */
	extractMetadata(file: TFile): Array<{ key: string; stringValue: string }> {
		const metadata: Array<{ key: string; stringValue: string }> = [];

		// Add folder
		metadata.push({ key: 'folder', stringValue: file.parent?.path || '' });

		// Extract from cache
		const cache = this.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;

		// Collect all tags (frontmatter + inline)
		const allTags: Set<string> = new Set();

		// Add frontmatter tags
		if (fm && Array.isArray(fm.tags)) {
			fm.tags.forEach((tag: string) => allTags.add(tag));
		}

		// Add inline tags from cache.tags (these include the # prefix)
		if (cache?.tags) {
			cache.tags.forEach((tagCache) => {
				// Remove # prefix for consistency with frontmatter tags
				const tag = tagCache.tag.startsWith('#') ? tagCache.tag.slice(1) : tagCache.tag;
				allTags.add(tag);
			});
		}

		// Add combined tags
		if (allTags.size > 0) {
			const tags = Array.from(allTags).join(', ');
			if (tags.length <= 256) {
				metadata.push({ key: 'tags', stringValue: tags });
			} else {
				metadata.push({ key: 'tags', stringValue: tags.substring(0, 253) + '...' });
			}
		}

		// Add aliases from frontmatter
		if (fm && Array.isArray(fm.aliases)) {
			const aliases = fm.aliases.join(', ');
			if (aliases.length <= 256) {
				metadata.push({ key: 'aliases', stringValue: aliases });
			} else {
				metadata.push({ key: 'aliases', stringValue: aliases.substring(0, 253) + '...' });
			}
		}

		return metadata;
	}
}
