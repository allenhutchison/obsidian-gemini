import { TFile, Notice } from 'obsidian';
import ObsidianGemini from '../main';
import { BasicGeminiConversationEntry, GeminiConversationEntry } from './database/types';
import { createHash } from 'crypto';
import * as Handlebars from 'handlebars';
// @ts-ignore
import historyEntryTemplate from './templates/historyEntry.hbs';

export class MarkdownHistory {
    private plugin: ObsidianGemini;
    private entryTemplate: Handlebars.TemplateDelegate;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
        // Register the eq helper
        Handlebars.registerHelper('eq', function(a, b) {
            return a === b;
        });
        this.entryTemplate = Handlebars.compile(historyEntryTemplate);
    }

    private getHistoryFilePath(notePath: string): string {
        const historyFolder = this.plugin.settings.historyFolder;
        // Remove .md extension if present before creating safe filename
        const pathWithoutExt = notePath.replace(/\.md$/, '');
        // Convert the note path to a safe filename by replacing path separators
        const safeFilename = pathWithoutExt.replace(/[\/\\]/g, '_');
        
        // Generate a consistent hash from the notePath
        const encoder = new TextEncoder();
        const data = encoder.encode(notePath);
        const hashArray = Array.from(new Uint8Array(createHash('sha256').update(data).digest()))
            .map(b => b.toString(16).padStart(2, '0'));
        const prefix = hashArray.join('').slice(0, 8);
        
        // Log the path generation for debugging
        console.log('Generating history file path:', {
            notePath,
            pathWithoutExt,
            safeFilename,
            prefix,
            historyFolder,
            result: `${historyFolder}/${prefix}-${safeFilename}.md`
        });
        
        return `${historyFolder}/${prefix}-${safeFilename}.md`;
    }

    async appendHistoryForFile(file: TFile, newEntry: BasicGeminiConversationEntry) {
        if (!this.plugin.gfile.isFile(file)) return;

        const historyPath = this.getHistoryFilePath(file.path);
        const entry: GeminiConversationEntry = {
            notePath: file.path,
            created_at: new Date(),
            role: newEntry.role,
            message: newEntry.message,
            model: newEntry.model,
        };

        try {
            const exists = await this.plugin.app.vault.adapter.exists(historyPath);
            if (exists) {
                let currentContent = await this.plugin.app.vault.adapter.read(historyPath);
                currentContent = currentContent.replace(/\n---\s*$/, '');
                await this.plugin.app.vault.adapter.write(historyPath, currentContent + '\n\n' + this.formatEntryAsMarkdown(entry));
            } else {
                // For new files, create with frontmatter and handle initial user query if present
                let entryMarkdown = '';
                if (newEntry.role === 'model' && newEntry.userMessage) {
                    const userEntry: GeminiConversationEntry = {
                        notePath: file.path,
                        created_at: new Date(entry.created_at.getTime() - 1000),
                        role: 'user',
                        message: newEntry.userMessage,
                    };
                    entryMarkdown = this.formatEntryAsMarkdown(userEntry, true) + '\n\n' + this.formatEntryAsMarkdown(entry);
                } else {
                    entryMarkdown = this.formatEntryAsMarkdown(entry, true);
                }
                
                // Create the file first
                await this.plugin.app.vault.createFolder(this.plugin.settings.historyFolder)
                    .catch(() => {});
                const newFile = await this.plugin.app.vault.create(historyPath, entryMarkdown);
                
                // Then add the frontmatter with proper wikilink
                await this.plugin.app.fileManager.processFrontMatter(newFile, (frontmatter) => {
                    frontmatter['source_file'] = this.plugin.gfile.getLinkText(file, file.path);
                });
            }
        } catch (error) {
            console.error('Failed to append history', error);
            new Notice('Failed to save chat history');
        }
    }

    async getHistoryForFile(file: TFile): Promise<GeminiConversationEntry[]> {
        if (!this.plugin.gfile.isFile(file)) return [];

        const historyPath = this.getHistoryFilePath(file.path);
        try {
            const exists = await this.plugin.app.vault.adapter.exists(historyPath);
            if (!exists) return [];

            const content = await this.plugin.app.vault.adapter.read(historyPath);
            return this.parseHistoryFile(content, file.path);
        } catch (error) {
            console.error('Failed to read history', error);
            return [];
        }
    }

    async clearHistoryForFile(file: TFile): Promise<number | undefined> {
        if (!this.plugin.gfile.isFile(file)) return undefined;

        const historyPath = this.getHistoryFilePath(file.path);
        try {
            const exists = await this.plugin.app.vault.adapter.exists(historyPath);
            if (exists) {
                await this.plugin.app.vault.adapter.remove(historyPath);
                return 1;
            }
            return 0;
        } catch (error) {
            console.error('Failed to clear history', error);
            return undefined;
        }
    }

    async clearHistory(): Promise<void> {
        const historyFolder = this.plugin.settings.historyFolder;
        try {
            const files = await this.plugin.app.vault.adapter.list(historyFolder);
            for (const file of files.files) {
                if (file.endsWith('.md')) {
                    await this.plugin.app.vault.adapter.remove(file);
                }
            }
        } catch (error) {
            console.error('Failed to clear all history', error);
            new Notice('Failed to clear chat history');
        }
    }

    private formatEntryAsMarkdown(entry: GeminiConversationEntry, isFirstEntry: boolean = false): string {
        const timestamp = entry.created_at.toISOString();
        const role = entry.role.charAt(0).toUpperCase() + entry.role.slice(1);
        
        // Split message into lines for the template
        const messageLines = entry.message.split('\n');

        // Get file version from metadata cache
        const activeFile = this.plugin.gfile.getActiveFile();
        const fileVersion = activeFile ? activeFile.stat.mtime.toString(16).slice(0, 8) : 'unknown';

        return this.entryTemplate({
            isFirstEntry,
            role,
            timestamp,
            model: entry.model,
            messageLines,
            pluginVersion: this.plugin.manifest.version,
            fileVersion,
            temperature: entry.metadata?.temperature,
            context: entry.metadata?.context,
        });
    }

    private async parseHistoryFile(content: string, notePath: string): Promise<GeminiConversationEntry[]> {
        const entries: GeminiConversationEntry[] = [];
        
        // Get the file object to read frontmatter
        const historyPath = this.getHistoryFilePath(notePath);
        const historyFile = this.plugin.app.vault.getAbstractFileByPath(historyPath);
        let filePath = notePath;
        
        // Debug log the raw content
        console.log('Raw history file content:', content);
        
        if (historyFile instanceof TFile) {
            const frontmatter = this.plugin.app.metadataCache.getFileCache(historyFile)?.frontmatter;
            if (frontmatter && frontmatter.source_file) {
                const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(frontmatter.source_file, historyFile.path);
                if (linkedFile instanceof TFile) {
                    // Always use the current file path from the linked file
                    filePath = linkedFile.path;
                }
            }
        }
        
        // Remove frontmatter if present
        const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
        
        // Split into sections by double newline followed by ##
        const sections = contentWithoutFrontmatter.split(/\n\n(?=## )/);
        console.log('Found sections:', sections.length);
        
        // Debug logging
        console.log('Content without frontmatter:', contentWithoutFrontmatter);
        console.log('Sections:', sections.map(s => s.substring(0, 50) + '...'));
        
        for (const section of sections) {
            if (!section.trim()) continue;

            const headerMatch = section.match(/^## (User|Model)/m);
            if (headerMatch) {
                const role = headerMatch[1].toLowerCase();
                
                // Extract metadata from the table in the metadata callout
                const timeMatch = section.match(/\|\s*Time\s*\|\s*(.*?)\s*\|/m);
                const modelMatch = section.match(/\|\s*Model\s*\|\s*(.*?)\s*\|/m);
                const timestamp = timeMatch ? new Date(timeMatch[1].trim()) : new Date();
                
                // Extract message content - look for user/assistant callout and get its content
                const messageMatch = section.match(/>\s*\[!(user|assistant)\]\+\n([\s\S]*?)(?=\n\s*---|\n\s*$)/m);
                if (messageMatch) {
                    const messageLines = messageMatch[2]
                        .split('\n')
                        .map(line => line.startsWith('> ') ? line.slice(2) : line)
                        .join('\n')
                        .trim();

                    if (messageLines) {
                        entries.push({
                            // Always use the current file path instead of the stored one
                            notePath: filePath,
                            created_at: timestamp,
                            role: role as 'user' | 'model',
                            message: messageLines,
                            model: modelMatch ? modelMatch[1].trim() : undefined,
                        });
                    }
                }
            }
        }

        return entries;
    }

    async renameHistoryFile(file: TFile, oldPath: string) {
        const historyFolder = this.plugin.settings.historyFolder;
        // Remove .md extension if present before creating safe filename
        const oldPathWithoutExt = oldPath.replace(/\.md$/, '');
        const oldSafeFilename = oldPathWithoutExt.replace(/[\/\\]/g, '_');

        try {
            const files = await this.plugin.app.vault.adapter.list(historyFolder);
            // Find the history file that ends with our old filename
            const oldHistoryFile = files.files.find(f => {
                // Remove .md extension for comparison
                const f2 = f.replace(/\.md$/, '');
                return f2.endsWith(`${oldSafeFilename}`);
            });
            
            if (oldHistoryFile) {
                // Generate new history path with new hash prefix based on new file path
                const newHistoryPath = this.getHistoryFilePath(file.path);
                
                // First update the frontmatter with the new file path
                const historyTFile = this.plugin.app.vault.getAbstractFileByPath(oldHistoryFile);
                if (historyTFile instanceof TFile) {
                    await this.plugin.app.fileManager.processFrontMatter(historyTFile, (frontmatter) => {
                        frontmatter['source_file'] = this.plugin.gfile.getLinkText(file, file.path);
                    });
                }
                
                // Log the rename operation for debugging
                console.log('Renaming history file:', {
                    from: oldHistoryFile,
                    to: newHistoryPath,
                    oldPath,
                    newPath: file.path
                });
                
                // Then rename the history file with the new hash-based path
                await this.plugin.app.vault.adapter.rename(oldHistoryFile, newHistoryPath);
            } else {
                console.log('Could not find history file to rename:', {
                    historyFolder,
                    oldSafeFilename,
                    availableFiles: files.files
                });
            }
        } catch (error) {
            console.error('Failed to rename history file', error);
        }
    }

    async deleteHistoryFile(filePath: string) {
        const historyFolder = this.plugin.settings.historyFolder;
        const safeFilename = filePath.replace(/[\/\\]/g, '_');

        try {
            const files = await this.plugin.app.vault.adapter.list(historyFolder);
            // Find the history file that ends with our filename
            const historyFile = files.files.find(f => f.endsWith(`${safeFilename}.md`));
            
            if (historyFile) {
                await this.plugin.app.vault.adapter.remove(historyFile);
            }
        } catch (error) {
            console.error('Failed to delete history file', error);
        }
    }
} 