import { Table } from "dexie";

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

export interface IGeminiDatabase {
    addConversation(conversation: GeminiConversationEntry): Promise<number>;
    getConversations(notePath: string): Promise<GeminiConversationEntry[]>;
    clearConversations(notePath: string): Promise<number>;
    clearHistory(): Promise<boolean>;
    exportDatabaseToVault(): Promise<void>;
    importDatabaseFromVault(): Promise<boolean>;
    setupDatabase(): Promise<void>;
}

export interface DatabaseExport {
    version: number;
    conversations: Record<string, GeminiConversationEntry[]>;
    metadata: {
        exportedAt: string;
        pluginVersion: string;
        checksum?: string;
        conversationsCount: number;
    };
}