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

    async clearHistory() {
        try {
            const oldCount = await this.conversations.count();
            await this.conversations.clear();
            const newCount = await this.conversations.count();
            if (newCount > 0) {
                console.error(`Failed to clear history, ${newCount} entries remaining`);
            }
            console.debug(`Cleared history, ${oldCount} entries removed`);
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    }

    async exportDatabaseToVault(): Promise<void> {
        if (!this.plugin.settings.chatHistory) {
            return;
        }

        console.debug('Exporting history to vault...');
        
        // Get ALL conversations and sort
        const conversations = await this.conversations
            .orderBy('notePath')
            .toArray();

        // Group and deduplicate
        const groupedConversations = conversations.reduce((acc, item) => {
            const { id, notePath, created_at, role, message, metadata } = item;
            
            // Initialize array for this notePath if it doesn't exist
            if (!acc[notePath]) {
                acc[notePath] = new Map();
            }
            
            // Create unique key from timestamp and message
            const key = `${created_at.getTime()}-${role}-${message}`;
            
            // Only add if not already present
            if (!acc[notePath].has(key)) {
                acc[notePath].set(key, {
                    notePath,
                    created_at,
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
            
            // Clear existing data before import
            await this.clearHistory();
            
            // Import all conversations
            for (const [notePath, messages] of Object.entries(importData.conversations)) {
                await this.conversations.bulkAdd(messages);
            }
            
            this.lastExportChecksum = importData.metadata?.checksum ?? null;
            console.debug('History import complete');
            return true;
        } catch (error) {
            if (!(error instanceof Error && error.message.includes('file not found'))) {
                console.error('Import failed:', error);
            }
            return false;
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
