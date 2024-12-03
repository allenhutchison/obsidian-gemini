import { TFolder, TFile } from "obsidian";
import ObsidianGemini from "../main";
import Dexie, { Table } from "dexie";
import { v4 as uuidv4 } from 'uuid';

export interface BasicGeminiConversationEntry {
    role: 'user' | 'model';
    message: string;
}

export interface GeminiConversationEntry extends BasicGeminiConversationEntry {
    id?: number;
    notePath: string;
    created_at: Date;
    metadata?: Record<string, any>;
}

interface GeminiHistoryFileMapping {
    id: string; // UUID
    notePath: string; // Path to the note
}

export class GeminiDatabase extends Dexie {
    conversations!: Table<GeminiConversationEntry, number>;
    fileMapping!: Table<GeminiHistoryFileMapping, string>;
    private plugin: ObsidianGemini;
    private vaultFolder: TFolder;

    constructor(plugin: ObsidianGemini) {
        super('GeminiDatabase');
        this.version(2).stores({
            conversations: '++id, notePath, [notePath+created_at], created_at, role, message',
            fileMapping: 'id, notePath',
        });
        this.plugin = plugin;
    }

    async setupDatabase() {
        console.debug('Setting up database');
        this.vaultFolder = await this.getVaultFolder();
        await this.conversations.clear();
        await this.fileMapping.clear();
        await this.importMarkdownToDatabase(this.conversations);
    }

    async setupDatabaseCommands() {
        try {
            this.plugin.addCommand({
                id: 'gemini-scribe-export-conversations',
                name: 'Export Conversations to Vault',
                callback: async () => {
                    await this.exportDatabaseToMarkdown(this.conversations);
                },
            });

            this.plugin.addCommand({
                id: 'gemini-scribe-import-conversations',
                name: 'Import Conversations from Vault',
                callback: async () => {
                    await this.importMarkdownToDatabase(this.conversations);
                },
            });

            this.plugin.addCommand({
                id: 'gemini-scribe-clear-conversations',
                name: 'Clear All Conversations',
                callback: async () => {
                    await this.conversations.clear();
                },
            });
        } catch (error) {
            console.error('Failed to add export command', error);
        }
    }

    // Obsidian doesn't sync the database, so we need to export the conversations to the vault
    async exportDatabaseToMarkdown(db: Dexie.Table<GeminiConversationEntry, any>): Promise<void> {
        const conversations = await db.orderBy('notePath').toArray();
        const vaultPath = (await this.getVaultFolder()).path;
    
        // Group conversations by notePath
        const groupedConversations = conversations.reduce((acc, item) => {
            acc[item.notePath] = acc[item.notePath] || [];
            acc[item.notePath].push(item);
            return acc;
        }, {} as Record<string, GeminiConversationEntry[]>);
    
        for (const notePath in groupedConversations) {
            const messages = groupedConversations[notePath];
    
            // Look up or create a UUID mapping
            let mapping = await this.fileMapping.get({ notePath });
            if (!mapping) {
                const uuid = uuidv4();
                mapping = { id: uuid, notePath };
                await this.fileMapping.add(mapping);
            }
    
            const filePath = `${vaultPath}/${mapping.id}.md`;
            const markdownContent = this.convertToMarkdownWithFrontmatter(messages, notePath, filePath);
            await this.plugin.app.vault.adapter.write(filePath, markdownContent);
        }
    }
    
    // Helper to convert conversations to Markdown with frontmatter
    private convertToMarkdownWithFrontmatter(messages: GeminiConversationEntry[], notePath: string, filePath: string): string {
        const noteFile = this.plugin.app.vault.getAbstractFileByPath(notePath);
        if (!(noteFile instanceof TFile)) {
            throw new Error(`Note file not found: ${notePath}`);
        } else {
            const noteKey = this.plugin.settings.historyFrontmatterKey;
            const noteLink = this.plugin.app.metadataCache.fileToLinktext(noteFile, filePath);
            const frontmatter = `---\n${noteKey}: "[[${noteLink}]]"\n---\n\n`;
            const body = messages
                .map(
                    (msg) =>
                        `## ${msg.created_at.toISOString()}\n**${msg.role}**:\n${msg.message}\n`
                )
                .join('\n');
            return frontmatter + `# Conversation History for [[${noteLink}]]\n\n` + body;
        }
    }

    async importMarkdownToDatabase(db: Dexie.Table<GeminiConversationEntry, any>): Promise<void> {
        const folderPath = (await this.getVaultFolder()).path;
        const files = await this.plugin.app.vault.adapter.list(folderPath);
    
        for (const file of files.files) {
            if (file.endsWith('.md')) {
                const uuid = file.replace(`${folderPath}/`, '').replace('.md', '');
                const content = await this.plugin.app.vault.adapter.read(file);
                const { notePath, messages } = await this.parseMarkdownWithFrontmatter(content);
    
                if (!notePath) {
                    console.log(`Skipping file ${file}: Missing notePath in frontmatter.`);
                    continue;
                }
    
                // Add or update the mapping
                let mapping = await this.fileMapping.get({ id: uuid });
                if (!mapping) {
                    await this.fileMapping.add({ id: uuid, notePath });
                }
    
                // Clear existing records for the notePath and add the new ones
                await db.where('notePath').equals(notePath).delete();
                await db.bulkAdd(messages);
            }
        }
    }
    
    // Helper to parse Markdown with frontmatter
    private async parseMarkdownWithFrontmatter(content: string): Promise<{ notePath: string | null; messages: GeminiConversationEntry[] }> {
        const frontmatterMatch = content.match(/---\n([\s\S]*?)\n---/);
        let notePath: string | null = null;
        if (frontmatterMatch) {
            const frontmatterKey = this.plugin.settings.historyFrontmatterKey;
            const frontmatter = frontmatterMatch[1];
            const match = frontmatter.match(new RegExp(`${frontmatterKey}:\\s*"\\[\\[(.+)\\]\\]"`));
            if (match) {
                notePath = match[1].trim();
                const vaultPath = (await this.getVaultFolder()).path;
                const file = this.plugin.app.metadataCache.getFirstLinkpathDest(notePath, vaultPath);
                notePath = file instanceof TFile ? file.path : null;
            }
        }
    
        const messages: GeminiConversationEntry[] = [];
        const body = content.replace(/---[\s\S]*?---\n/, ''); // Remove frontmatter
        const lines = body.split('\n');
    
        let currentRole: 'user' | 'model' | null = null;
        let currentMessage: string = '';
        let createdAt: Date | null = null;
    
        lines.forEach((line) => {
            if (line.startsWith('## ')) {
                // Start of a new message
                if (currentRole && currentMessage && createdAt) {
                    messages.push({
                        notePath: notePath || '',
                        created_at: createdAt,
                        role: currentRole,
                        message: currentMessage.trim(),
                    });
                }
                createdAt = new Date(line.slice(3).trim());
                currentRole = null;
                currentMessage = '';
            } else if (line.startsWith('**user**:')) {
                currentRole = 'user';
                currentMessage = line.replace('**user**:', '').trim();
            } else if (line.startsWith('**model**:')) {
                currentRole = 'model';
                currentMessage = line.replace('**model**:', '').trim();
            } else {
                currentMessage += '\n' + line.trim();
            }
        });
    
        if (currentRole && currentMessage && createdAt) {
            messages.push({
                notePath: notePath || '',
                created_at: createdAt,
                role: currentRole,
                message: currentMessage.trim(),
            });
        }
    
        return { notePath, messages };
    }

    async getVaultFolder(): Promise<TFolder> {
        const folderName = this.plugin.settings.historyFolder;
        let folder = this.plugin.app.vault.getAbstractFileByPath(folderName);
        if (folder instanceof TFolder) {
            return folder;
        } else {
            return await this.plugin.app.vault.createFolder(folderName);
        }
    }
}
