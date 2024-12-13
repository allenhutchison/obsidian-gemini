import { TFolder, TFile } from "obsidian";
import ObsidianGemini from "../main";
import Dexie, { Table } from "dexie";
import { createHash } from 'crypto';

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

interface DatabaseExport {
    version: number;
    conversations: Record<string, GeminiConversationEntry[]>;
    metadata: {
        exportedAt: string;
        pluginVersion: string;
        checksum?: string;
    };
}

export class GeminiDatabase extends Dexie {
    conversations!: Table<GeminiConversationEntry, number>;
    private plugin: ObsidianGemini;
    private lastExportChecksum: string | null = null;
    private isImporting = false;
    private isExporting = false;

    constructor(plugin: ObsidianGemini) {
        super('GeminiDatabase');
        this.version(2).stores({
            conversations: '++id, notePath, [notePath+created_at], created_at, role, message',
        });
        this.plugin = plugin;
    }

    private generateChecksum(data: string): string {
        return createHash('md5').update(data).digest('hex');
    }

    async setupDatabase() {
        console.debug('Setting up database...');
        if (this.plugin.settings.chatHistory) {
            try {
                // Try to import existing history first
                const imported = await this.importDatabaseFromVault();
                if (!imported) {
                    console.debug('No existing history found or import failed');
                }
            } catch (error) {
                console.error('Error importing history:', error);
            }
        }
    }

    async clearHistory(): Promise<boolean> {
        try {
            const oldCount = await this.conversations.count();

            // Wrap the clear operation in a transaction
            await this.transaction('rw', this.conversations, async () => {
                await this.conversations.clear();
            });

            // Verify that the conversations table is empty
            const newCount = await this.conversations.count();
            if (newCount > 0) {
                console.error(`Failed to clear history, ${newCount} entries remaining`);
                return false;
            }

            console.debug(`Cleared history, ${oldCount} entries removed`);
            return true;
        } catch (error) {
            console.error('Failed to clear history:', error);
            return false;
        }
    }

    async exportDatabaseToVault(): Promise<void> {
        if (this.isExporting) {
            console.debug('Export operation is already in progress.');
            return;
        }
        this.isExporting = true;
        try {
            if (!this.plugin.settings.chatHistory) {
                return;
            }

            console.debug('Exporting history to vault...');
            
            const conversations = await this.conversations
                .orderBy('notePath')
                .toArray();

            const groupedConversations = conversations.reduce((acc, item) => {
                const { id, notePath, created_at, role, message, metadata } = item;
                
                if (!acc[notePath]) {
                    acc[notePath] = new Map();
                }
                
                // Handle date conversion
                const timestamp = created_at instanceof Date 
                    ? created_at.getTime()
                    : new Date(created_at).getTime();
                
                const key = `${timestamp}-${role}-${message}`;
                
                if (!acc[notePath].has(key)) {
                    acc[notePath].set(key, {
                        notePath,
                        created_at: created_at instanceof Date ? created_at : new Date(created_at),
                        role,
                        message,
                        metadata
                    });
                }
                
                return acc;
            }, {} as Record<string, Map<string, Omit<GeminiConversationEntry, 'id'>>>);

            // Convert Map values to arrays
            const cleanedConversations = Object.fromEntries(
                Object.entries(groupedConversations).map(([key, value]) => [
                    key,
                    Array.from(value.values())
                ])
            );

            const exportData: DatabaseExport = {
                version: 1,
                conversations: cleanedConversations,
                metadata: {
                    exportedAt: new Date().toISOString(),
                    pluginVersion: this.plugin.manifest.version
                }
            };

            const jsonData = JSON.stringify(exportData, null, 2);
            this.lastExportChecksum = this.generateChecksum(jsonData);
            exportData.metadata.checksum = this.lastExportChecksum;

            const folder = await this.getVaultFolder();
            const filePath = `${folder.path}/gemini-scribe-history.json`;
            
            await this.plugin.app.vault.adapter.write(
                filePath, 
                JSON.stringify(exportData, null, 2)
            );
            
            console.debug('History export complete');
        } catch (error) {
            console.error('Export failed:', error);
        } finally {
            this.isExporting = false;
        }
    }

    async hasFileChanged(content: string): Promise<boolean> {
        const importData: DatabaseExport = JSON.parse(content);
        const currentChecksum = importData.metadata?.checksum;
        
        if (!currentChecksum || currentChecksum !== this.lastExportChecksum) {
            console.debug(`File changed - checksums differ (${currentChecksum} vs ${this.lastExportChecksum})`);
            return true;
        }
        
        console.debug('File unchanged based on checksum');
        return false;
    }

    async importDatabaseFromVault(): Promise<boolean> {
        if (this.isImporting) {
            console.warn('Import operation is already in progress.');
            return false;
        }
        this.isImporting = true;
        try {
            if (!this.plugin.settings.chatHistory) {
                console.debug('Chat history disabled, skipping import');
                return false;
            }
            
            try {
                const folder = await this.getVaultFolder();
                const filePath = `${folder.path}/gemini-scribe-history.json`;
                const content = await this.plugin.app.vault.adapter.read(filePath);
                
                const importData: DatabaseExport = JSON.parse(content);
                
                if (!await this.hasFileChanged(content)) {
                    console.debug('No changes in history file');
                    return false;
                }

                console.debug('Importing history from vault...');
                
                // Attempt to clear existing data
                const cleared = await this.clearHistory();
                if (!cleared) {
                    console.error('Failed to clear history before import. Aborting import to prevent duplicates.');
                    return false; // Abort import if clearHistory fails
                }
                
                // Process each conversation group
                for (const [notePath, messages] of Object.entries(importData.conversations)) {
                    // Create a Map to deduplicate messages
                    const uniqueMessages = new Map();
                    
                    messages.forEach(msg => {
                        const timestamp = new Date(msg.created_at).getTime();
                        const key = `${timestamp}-${msg.role}-${msg.message}`;
                        if (!uniqueMessages.has(key)) {
                            uniqueMessages.set(key, {
                                notePath: msg.notePath,
                                created_at: new Date(msg.created_at),
                                role: msg.role,
                                message: msg.message,
                                metadata: msg.metadata
                            });
                        }
                    });

                    // Sort and import unique messages
                    const sortedMessages = Array.from(uniqueMessages.values())
                        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
                    
                    await this.conversations.bulkAdd(sortedMessages);
                }

                this.lastExportChecksum = importData.metadata?.checksum ?? null;
                console.debug('History import complete');
                return true;
            } catch (error) {
                console.error('Import failed:', error);
                return false;
            }
        } catch (error) {
            console.error('Import failed:', error);
            return false;
        } finally {
            this.isImporting = false;
        }
    }

    async getVaultFolder(): Promise<TFolder> {
        const folderName = this.plugin.settings.historyFolder;
        let folder = this.plugin.app.vault.getAbstractFileByPath(folderName);
        if (folder instanceof TFolder) {
            return folder;
        } else {
            try {
                return await this.plugin.app.vault.createFolder(folderName);
            } catch (error) {
                console.error(`Failed to create folder ${folderName}:`, error);
                throw error;
            }
        }
    }
}
