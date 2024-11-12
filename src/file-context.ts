import ObsidianGemini from '../main';
import { MarkdownRenderer, TFile } from 'obsidian';

// File node interface to represent each document and its links
interface FileContextNode {
    path: string;
    content: string;
    links: Map<string, FileContextNode>; // Map of file path to FileContextNode
}

// Class to manage the file structure
export class FileContextTree {
    private root: FileContextNode | null = null;
    private plugin: ObsidianGemini;
    private maxDepth: number;
    private readonly MAX_TOTAL_CHARS = 500000; // TODO(adh): Make this configurable

    constructor(plugin: ObsidianGemini, depth?: number) {
        this.plugin = plugin;
        this.maxDepth = depth ?? this.plugin.settings.maxContextDepth;
    }

    async buildStructure(file: TFile, currentDepth: number = 0, renderContent: boolean): Promise<FileContextNode | null> {
        if (!file || currentDepth > this.maxDepth) {
            return null;
        }

        // Create new node
        const node: FileContextNode = {
            path: file.path,
            content: await this.getFileContent(file, renderContent),
            links: new Map()
        };

        // Get all links from file
        const fileCache = this.plugin.app.metadataCache.getFileCache(file);
        const inlineLinks = fileCache?.links || [];
        const frontmatterLinks = fileCache?.frontmatterLinks || [];
        const embedLinks = fileCache?.embeds || [];

        // Combine all link types
        const allLinks = [
            ...inlineLinks,
            ...frontmatterLinks,
            ...embedLinks
        ];

        // Process each link
        for (const link of allLinks) {
            const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
            if (linkedFile && linkedFile instanceof TFile) {
                const linkedNode = await this.buildStructure(linkedFile, currentDepth + 1, renderContent);
                if (linkedNode) {
                    node.links.set(linkedFile.path, linkedNode);
                }
            }
        }

        return node;
    }

    async initialize(startFile: TFile, renderContent: boolean): Promise<void> {
        this.root = await this.buildStructure(startFile, 0, renderContent);
    }

    toString(maxCharsPerFile: number = 50000): string {
        if (!this.root) {
            return "No file structure built";
        }
        return this.nodeToString(this.root, 0, maxCharsPerFile, 0).text;
    }

    private nodeToString(node: FileContextNode, 
                         depth: number, 
                         maxCharsPerFile: number,
                         currentTotal: number): { text: string; total: number } {
        const indent = "  ".repeat(depth);
        const separator = "\n==============================\n";
        
        // Truncate content if too long
        const truncatedContent = node.content.length > maxCharsPerFile 
            ? node.content.substring(0, maxCharsPerFile) + "\n[Remaining content truncated...]"
            : node.content;

        let result = depth == 0 
            ? "This is the content of the current file and the files that it links to:" 
            : separator;
        const fileLabel = depth == 0 ? "Current File:" : "Linked File:";
        result += `${indent}${fileLabel} ${node.path}${separator}${truncatedContent}${separator}`;
        let total = currentTotal + result.length;

        // Add linked files if we haven't exceeded total limit
        if (node.links.size > 0 && total < this.MAX_TOTAL_CHARS) {
            result += `${indent}LINKED FILES:\n`;
            for (const [path, linkedNode] of node.links) {
                if (total >= this.MAX_TOTAL_CHARS) {
                    result += `${indent}[Additional links truncated...]\n`;
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
        const fileContent = await this.plugin.app.vault.read(file) || '';
        if (render) {
            const el = document.createElement('div');
            await MarkdownRenderer.render(this.plugin.app, fileContent, el, file.path, this.plugin);
            return el.innerHTML;
        } else {
            return fileContent;
        }
    }
}