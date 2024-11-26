import ObsidianGemini from "../main";
import Dexie, { Table } from "dexie";

export interface GeminiConversationEntry {
    id?: number;
    notePath?: string;
    created_at?: Date;
    role: 'user' | 'model';
    message: string;
    metadata?: Record<string, any>;
}

export class GeminiDatabase extends Dexie {
    conversations!: Table<GeminiConversationEntry, number>;

    constructor() {
        super('GeminiDatabase');
        this.version(1).stores({
            conversations: '++id, notePath, [notePath+created_at], created_at, role, message',
        });
    }

    async getAllConversations() {
        return await this.conversations.toArray();
    }   
}
