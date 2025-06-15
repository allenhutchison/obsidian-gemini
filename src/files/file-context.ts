import ObsidianGemini from '../../main';
import { MarkdownRenderer, TFile } from 'obsidian';
import { ScribeDataView } from './dataview-utils';
import { ScribeFile } from '.';
import { GeminiPrompts } from '../prompts';

// File node interface to represent each document and its links
interface FileContextNode {
	path: string;
	content: string;
	wikilink: string; // New property for wikilink
	links: Map<string, FileContextNode>; // Map of file path to FileContextNode
}

// Class to manage the file structure
export class FileContextTree {
	private root: FileContextNode | null = null;
	private visited: Set<string> = new Set();
	private plugin: ObsidianGemini;
	private maxDepth: number;
	private readonly MAX_TOTAL_CHARS = 500000; // TODO(adh): Make this configurable
	private fileHelper: ScribeFile;
	private dataViewHelper: ScribeDataView;
	private prompts: GeminiPrompts;

	constructor(plugin: ObsidianGemini, depth?: number) {
		this.plugin = plugin;
		if (!this.plugin.settings.sendContext) {
			this.maxDepth = 0;
		} else {
			this.maxDepth = depth ?? this.plugin.settings.maxContextDepth;
		}
		this.fileHelper = new ScribeFile(plugin);
		this.dataViewHelper = new ScribeDataView(this.fileHelper, this.plugin);
		this.prompts = new GeminiPrompts(plugin);
	}

	async buildStructure(
		file: TFile,
		currentDepth: number = 0,
		renderContent: boolean,
		visited: Set<string>,
		baseFile: TFile // New parameter to propagate current file for relative link resolution
	): Promise<FileContextNode | null> {
		// Return null if file is in the history folder
		if (
			!file ||
			currentDepth > this.maxDepth ||
			visited.has(file.path) ||
			file.path.startsWith(this.plugin.settings.historyFolder + '/')
		) {
			return null;
		}

		visited.add(file.path);

		const linktext = this.fileHelper.getLinkText(file, baseFile.path);
		const node: FileContextNode = {
			path: file.path,
			content: await this.getFileContent(file, renderContent),
			wikilink: linktext,
			links: new Map(),
		};

		// Get all links from file
		const fileCacheLinks = this.fileHelper.getUniqueLinks(file);
		const backlinks = (await this.dataViewHelper.getBacklinks(file)) || new Set();
		const dataviewLinks = (await this.dataViewHelper.getLinksFromDataviewBlocks(file)) || new Set();

		// Combine all link types
		const allLinks = fileCacheLinks;
		backlinks.forEach((link) => allLinks.add(link));
		dataviewLinks.forEach((link) => allLinks.add(link));

		// Process each link
		for (const fileLink of allLinks) {
			const linkedNode = await this.buildStructure(fileLink, currentDepth + 1, renderContent, visited, baseFile);
			if (linkedNode) {
				node.links.set(fileLink.path, linkedNode);
			}
		}
		return node;
	}

	async initialize(startFile: TFile, renderContent: boolean): Promise<void> {
		this.visited.clear();
		// Pass startFile as the baseFile for relative link resolution
		this.root = await this.buildStructure(startFile, 0, renderContent, this.visited, startFile);
	}

	toString(maxCharsPerFile: number = 50000): string {
		if (!this.root) {
			return 'No file structure built';
		}
		return this.nodeToString(this.root, 0, maxCharsPerFile, 0).text;
	}

	private nodeToString(
		node: FileContextNode,
		depth: number,
		maxCharsPerFile: number,
		currentTotal: number
	): { text: string; total: number } {
		// Truncate content if too long
		const truncatedContent =
			node.content.length > maxCharsPerFile
				? node.content.substring(0, maxCharsPerFile) + '\n[Remaining content truncated...]'
				: node.content;

		let result = depth == 0 ? 'This is the content of the current file and the files that it links to:\n' : '';
		const fileLabel = depth == 0 ? 'Current File' : 'Linked File';
		// Updated to add wikilink property to the context prompt
		result += this.prompts.contextPrompt({
			file_label: fileLabel,
			file_name: node.path,
			wikilink: node.wikilink,
			file_contents: truncatedContent,
		});
		let total = currentTotal + result.length;
		// Add linked files if we haven't exceeded total limit
		if (node.links.size > 0 && total < this.MAX_TOTAL_CHARS) {
			for (const [path, linkedNode] of node.links) {
				if (total >= this.MAX_TOTAL_CHARS) {
					result += `[Additional links truncated...]\n`;
					break;
				}
				const linkedResult = this.nodeToString(linkedNode, depth + 1, maxCharsPerFile, total);
				result += linkedResult.text;
				total = linkedResult.total;
			}
		}

		return { text: result, total };
	}

	private async getFileContent(file: TFile, render: boolean): Promise<string> {
		const fileContent = (await this.plugin.app.vault.read(file)) || '';
		if (render) {
			const el = document.createElement('div');
			await MarkdownRenderer.render(this.plugin.app, fileContent, el, file.path, this.plugin);
			return el.innerHTML;
		} else {
			return fileContent;
		}
	}
}
