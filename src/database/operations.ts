import { Table } from "dexie";
import { GeminiConversationEntry } from "./types";
import { DatabaseQueue } from "./queue";

export class DatabaseOperations {
    constructor(
        private conversations: Table<GeminiConversationEntry, number>,
        private queue: DatabaseQueue
    ) {}

    async addConversation(conversation: GeminiConversationEntry): Promise<number> {
        return this.queue.enqueue(async () => {
            return await this.conversations.add(conversation);
        });
    }

    async getConversations(notePath: string): Promise<GeminiConversationEntry[]> {
        return this.queue.enqueue(async () => {
            return await this.conversations
                .where('notePath')
                .equals(notePath)
                .toArray();
        });
    }

    async clearConversations(notePath: string): Promise<number> {
        return this.queue.enqueue(async () => {
            return await this.conversations
                .where('notePath')
                .equals(notePath)
                .delete();
        });
    }

    async clearHistory(): Promise<boolean> {
        return this.queue.enqueue(async () => {
            try {
                await this.conversations.clear();
                return true;
            } catch (error) {
                return false;
            }
        });
    }

    async setup(): Promise<void> {
        await this.queue.enqueue(async () => {
            const count = await this.conversations.count();
            console.debug(`Database initialized with ${count} conversations`);
        });
    }
}