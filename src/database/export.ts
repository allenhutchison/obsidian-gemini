import { createHash } from 'crypto';
import { DatabaseQueue } from "./queue";
import { DatabaseExport, GeminiConversationEntry } from "./types";
import { Table } from "dexie";
import ObsidianGemini from "../../main";
import { getVaultFolder, generateChecksum } from "./utils";
import { DatabaseOperations } from './operations';

export class DatabaseExporter {
    private lastExportChecksum: string | null = null;
    private isImporting = false;
    private isExporting = false;

    constructor(
        private conversations: Table<GeminiConversationEntry, number>,
        private queue: DatabaseQueue,
        private plugin: ObsidianGemini,
        private operations: DatabaseOperations
    ) {}

    async clearHistory(): Promise<boolean> {
        return this.operations.clearHistory();
    }

    private async hasFileChanged(content: string): Promise<boolean> {
        const checksum = generateChecksum(content);
        const changed = checksum !== this.lastExportChecksum;
        console.debug(`File changed - checksums differ (${checksum} vs ${this.lastExportChecksum})`);
        return changed;
    }

    async exportDatabaseToVault(): Promise<void> {
        return this.queue.enqueue(async () => {
            if (this.isExporting) {
                console.debug('Export operation is already in progress.');
                return;
            }
            this.isExporting = true;
            
            try {
                if (!this.plugin.settings.chatHistory) {
                    return;
                }

                // Get current conversations
                const conversations = await this.conversations
                    .orderBy('notePath')
                    .toArray();

                // Safety check - don't write empty file if we have existing data
                if (conversations.length === 0) {
                    try {
                        const folder = await getVaultFolder(this.plugin);
                        const filePath = `${folder.path}/gemini-scribe-history.json`;
                        const existingContent = await this.plugin.app.vault.adapter.read(filePath);
                        const existingData = JSON.parse(existingContent);
                        
                        // If existing file has data but DB is empty, abort export
                        if (existingData.conversations && 
                            Object.keys(existingData.conversations).length > 0) {
                            console.error('Preventing export of empty database over existing data');
                            return;
                        }
                    } catch (error) {
                        // File doesn't exist or can't be read - ok to proceed with empty export
                    }
                }

                // Process conversations
                const groupedConversations = this.processConversations(conversations);

                // Create export data
                const exportData: DatabaseExport = {
                    version: 1,
                    conversations: groupedConversations,
                    metadata: {
                        exportedAt: new Date().toISOString(),
                        pluginVersion: this.plugin.manifest.version,
                        conversationsCount: conversations.length
                    }
                };

                // Generate and set checksum
                const jsonData = JSON.stringify(exportData, null, 2);
                this.lastExportChecksum = generateChecksum(jsonData);
                exportData.metadata.checksum = this.lastExportChecksum;

                // Write file atomically
                const folder = await getVaultFolder(this.plugin);
                const filePath = `${folder.path}/gemini-scribe-history.json`;
                const backupPath = `${folder.path}/gemini-scribe-history.backup.json`;

                // Backup existing file if it exists
                try {
                    const existing = await this.plugin.app.vault.adapter.read(filePath);
                    await this.plugin.app.vault.adapter.write(backupPath, existing);
                } catch (error) {
                    // No existing file to backup
                }

                // Write new file
                await this.plugin.app.vault.adapter.write(filePath, jsonData);
                console.debug(`History export complete. Saved ${conversations.length} conversations`);

            } catch (error) {
                console.error('Export failed:', error);
                throw error;
            } finally {
                this.isExporting = false;
            }
        });
    }

    private processConversations(conversations: GeminiConversationEntry[]) {
        return Object.fromEntries(
            Object.entries(
                conversations.reduce((acc, item) => {
                    const { id, notePath, created_at, role, message, metadata } = item;
                    
                    if (!acc[notePath]) {
                        acc[notePath] = new Map();
                    }
                    
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
                }, {} as Record<string, Map<string, Omit<GeminiConversationEntry, 'id'>>>)
            ).map(([key, value]) => [
                key,
                Array.from(value.values())
            ])
        );
    }

    async importDatabaseFromVault(): Promise<boolean> {
        return await this.queue.enqueue(async () => {
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
                    const folder = await getVaultFolder(this.plugin);
                    const filePath = `${folder.path}/gemini-scribe-history.json`;
                    const content = await this.plugin.app.vault.adapter.read(filePath);

                    const importData: DatabaseExport = JSON.parse(content);

                    if (!await this.hasFileChanged(content)) {
                        console.debug('No changes in history file');
                        return false;
                    }

                    console.debug('Importing history from vault...');

                    const cleared = await this.clearHistory();
                    if (!cleared) {
                        console.error('Failed to clear history before import. Aborting import to prevent duplicates.');
                        return false;
                    }

                    for (const [notePath, messages] of Object.entries(importData.conversations)) {
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

                        const sortedMessages = Array.from(uniqueMessages.values())
                            .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

                        await this.conversations.bulkAdd(sortedMessages);
                    }

                    this.lastExportChecksum = importData.metadata?.checksum ?? null;
                    console.debug('History import complete');
                    return true;
                } catch (error) {
                    console.error('Inner import failed:', error);
                    return false;
                }
            } catch (error) {
                console.error('Outer import failed:', error);
                return false;
            } finally {
                this.isImporting = false;
            }
        });
    }
}