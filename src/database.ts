import { TFolder, TFile } from "obsidian";
import ObsidianGemini from "../main";
import Dexie, { Table } from "dexie";

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
    };
}

export class GeminiDatabase extends Dexie {
    conversations!: Table<GeminiConversationEntry, number>;
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        super('GeminiDatabase');
        this.version(2).stores({
            conversations: '++id, notePath, [notePath+created_at], created_at, role, message',
        });
        this.plugin = plugin;
    }

    async setupDatabase() {
        await this.clearHistory();
        await this.importDatabaseFromVault();
    }

    async clearHistory() {
        await this.conversations.clear();
    }

    async exportDatabaseToVault(): Promise<void> {
        if (!this.plugin.settings.chatHistory) {
            console.debug('Chat history disabled, skipping export');
            return;
        }
        const conversations = await this.conversations.orderBy('notePath').toArray();
        const vaultPath = (await this.getVaultFolder()).path;

        // Group conversations by notePath
        const groupedConversations = conversations.reduce((acc, item) => {
            acc[item.notePath] = acc[item.notePath] || [];
            acc[item.notePath].push(item);
            return acc;
        }, {} as Record<string, GeminiConversationEntry[]>);

        const exportData: DatabaseExport = {
            version: 1,
            conversations: groupedConversations,
            metadata: {
                exportedAt: new Date().toISOString(),
                pluginVersion: this.plugin.manifest.version
            }
        };

        const filePath = `${vaultPath}/gemini-scribe-history.json`;
        await this.plugin.app.vault.adapter.write(
            filePath, 
            JSON.stringify(exportData, null, 2)
        );
    }

    async importDatabaseFromVault(): Promise<void> {
        if (!this.plugin.settings.chatHistory) {
            console.debug('Chat history disabled, skipping import');
            return;
        }
        try {
            const folder = await this.getVaultFolder();
            const filePath = `${folder.path}/gemini-scribe-history.json`;
            const content = await this.plugin.app.vault.adapter.read(filePath);
            const importData: DatabaseExport = JSON.parse(content);

            if (importData.version !== 1) {
                console.warn(`Unknown version in history file: ${importData.version}`);
            }

            await this.clearHistory();

            // Import all conversations
            for (const notePath in importData.conversations) {
                await this.conversations.bulkPut(importData.conversations[notePath]);
            }
        } catch (error) {
            if (!(error instanceof Error && error.message.includes('file not found'))) {
                console.error('Failed to import history:', error);
            }
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
