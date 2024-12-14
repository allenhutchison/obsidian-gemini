import { TFolder } from "obsidian";
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

/** Database interface for Gemini conversations */
export interface IGeminiDatabase {
    /** Add a new conversation entry */
    addConversation(conversation: GeminiConversationEntry): Promise<number>;
    /** Get all conversations for a specific note */
    getConversations(notePath: string): Promise<GeminiConversationEntry[]>;
    /** Clear conversations for a specific note */
    clearConversations(notePath: string): Promise<number>;
    /** Clear all conversation history */
    clearHistory(): Promise<boolean>;
    /** Export database to vault file */
    exportDatabaseToVault(): Promise<void>;
    /** Import database from vault file */
    importDatabaseFromVault(): Promise<boolean>;
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

class DatabaseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DatabaseError';
    }
}

class QueueError extends DatabaseError {
    constructor(message: string) {
        super(message);
        this.name = 'QueueError';
    }
}

export class GeminiDatabase extends Dexie implements IGeminiDatabase {
    conversations!: Table<GeminiConversationEntry, number>;
    private plugin: ObsidianGemini;
    private dbQueue: (() => Promise<any>)[] = [];
    private isProcessingQueue = false;
    private lastProcessingStartTime: number | null = null;
    private readonly QUEUE_TIMEOUT = 5000;
    private lastExportChecksum: string | null = null;
    private isImporting = false;
    private isExporting = false;
    private operationId = 0;

    constructor(plugin: ObsidianGemini) {
        super('GeminiDatabase');
        this.version(2).stores({
            conversations: '++id, notePath, [notePath+created_at], created_at, role, message',
        });
        this.plugin = plugin;
        this.open();
    }

    private async processQueue() {
        if (this.isProcessingQueue) {
            if (this.lastProcessingStartTime && 
                Date.now() - this.lastProcessingStartTime > this.QUEUE_TIMEOUT) {
                this.isProcessingQueue = false;
            } else {
                return;
            }
        }

        this.isProcessingQueue = true;
        this.lastProcessingStartTime = Date.now();
        
        try {
            while (this.dbQueue.length > 0) {
                const opId = ++this.operationId;
                const operation = this.dbQueue.shift();
                if (!operation) continue;
                await operation();
            }
        } finally {
            this.isProcessingQueue = false;
            this.lastProcessingStartTime = null;
        }
    }

    private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrappedOperation = async () => {
                try {
                    const result = await operation();
                    resolve(result);
                    return result;
                } catch (error) {
                    reject(error);
                    throw error;
                }
            };
            this.dbQueue.push(wrappedOperation);
            void this.processQueue();
        });
    }

    async addConversation(conversation: GeminiConversationEntry): Promise<number> {
        return this.enqueue(async () => {
            return await this.conversations.add(conversation);
        });
    }

    async getConversations(notePath: string): Promise<GeminiConversationEntry[]> {
        return this.enqueue(async () => {
            return await this.conversations
                .where('notePath')
                .equals(notePath)
                .toArray();
        });
    }

    async clearConversations(notePath: string): Promise<number> {
        return this.enqueue(async () => {
            return await this.conversations
                .where('notePath')
                .equals(notePath)
                .delete();
        });
    }

    async clearHistory(): Promise<boolean> {
        return this.enqueue(async () => {
            try {
                await this.conversations.clear();
                return true;
            } catch (error) {
                return false;
            }
        });
    }

    private generateChecksum(data: string): string {
        return createHash('md5').update(data).digest('hex');
    }

    async setupDatabase() {
        console.debug('Setting up database...');
        if (this.plugin.settings.chatHistory) {
            try {
                const imported = await this.importDatabaseFromVault();
                if (!imported) {
                    console.debug('No existing history found or import failed');
                }
            } catch (error) {
                console.error('Error importing history:', error);
            }
        }
    }

    async exportDatabaseToVault(): Promise<void> {
        return this.enqueue(async () => {
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
        });
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
        return await this.enqueue(async () => {
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

    async getAllConversations(): Promise<GeminiConversationEntry[]> {
        return this.enqueue(async () => {
            console.debug('Getting all conversations');
            const conversations = await this.conversations.toArray();
            console.debug(`Found ${conversations.length} total conversations`);
            return conversations;
        });
    }

    async clearAllConversations(): Promise<void> {
        return this.enqueue(async () => {
            console.debug('Clearing all conversations');
            await this.conversations.clear();
            const remaining = await this.conversations.count();
            console.debug(`Cleared conversations. ${remaining} remaining`);
        });
    }
}