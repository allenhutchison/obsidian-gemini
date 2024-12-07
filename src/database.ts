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

interface ConversationExport {
    version: number;  // For future schema migrations
    notePath: string;
    conversations: GeminiConversationEntry[];
    metadata?: {
        exportedAt: string;
        pluginVersion: string;
    };
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
        console.debug('Setting up history database');
        this.vaultFolder = await this.getVaultFolder();
        await this.clearHistory();
        await this.importDatabaseFromVault(this.conversations);
    }

    async clearHistory() {
        await this.conversations.clear();
        await this.fileMapping.clear();
    }

    // Obsidian doesn't sync the database, so we need to export the conversations to the vault
    async exportDatabaseToVault(db: Dexie.Table<GeminiConversationEntry, any>): Promise<void> {
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
            const markdownContent = this.convertToMarkdownWithJson(messages, notePath, filePath);
            await this.plugin.app.vault.adapter.write(filePath, markdownContent);
        }
    }
    

    private convertToMarkdownWithJson(
        messages: GeminiConversationEntry[], 
        notePath: string, 
        filePath: string
    ): string {
        const noteFile = this.plugin.app.vault.getAbstractFileByPath(notePath);
        if (!(noteFile instanceof TFile)) {
            throw new Error(`Note file not found: ${notePath}`);
        }

        // Create export object
        const exportData: ConversationExport = {
            version: 1,
            notePath,
            conversations: messages,
            metadata: {
                exportedAt: new Date().toISOString(),
                pluginVersion: this.plugin.manifest.version
            }
        };

        // Create markdown with frontmatter and JSON
        const noteKey = this.plugin.settings.historyFrontmatterKey;
        const noteLink = this.plugin.app.metadataCache.fileToLinktext(noteFile, filePath);
        
        return [
            '---',
            `${noteKey}: "[[${noteLink}]]"`,
            '---',
            '',
            '```json',
            JSON.stringify(exportData, null, 2),
            '```'
        ].join('\n');
    }

    async importDatabaseFromVault(db: Dexie.Table<GeminiConversationEntry, any>): Promise<void> {
        const folder = await this.getVaultFolder();
        const files = folder.children;
        
        if (!files) return;

        for (const file of files) {
            if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') continue;

            const content = await this.plugin.app.vault.read(file);
            const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
            
            if (!jsonMatch) {
                console.debug(`No JSON found in ${file.path}`);
                continue;
            }

            try {
                const exportData: ConversationExport = JSON.parse(jsonMatch[1]);
                
                // Version check & migration could go here
                if (exportData.version !== 1) {
                    console.warn(`Unknown version in ${file.path}: ${exportData.version}`);
                }

                // Import conversations
                await db.bulkPut(exportData.conversations);
                
            } catch (error) {
                console.error(`Failed to import ${file.path}:`, error);
            }
        }
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
