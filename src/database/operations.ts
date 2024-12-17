import { Table } from "dexie";
import { GeminiConversationEntry } from "./types";
import { DatabaseQueue } from "./queue";

export class DatabaseOperations {
    constructor(
        private conversations: Table<GeminiConversationEntry, number>,
        private queue: DatabaseQueue
    ) {}

    async addConversation(conversation: GeminiConversationEntry): Promise<number> {
        return this.queue.enqueue(
            async () => await this.conversations.add(conversation),
            "Add Conversation"
        );
    }

    async getConversations(notePath: string): Promise<GeminiConversationEntry[]> {
        return this.queue.enqueue(
            async () => await this.conversations
                .where('notePath')
                .equals(notePath)
                .toArray(),
            "Get Conversations"
        );
    }

    async clearConversations(notePath: string): Promise<number> {
        return this.queue.enqueue(
            async () => await this.conversations
                .where('notePath')
                .equals(notePath)
                .delete(),
            "Clear Conversations"
        );
    }

    async clearHistory(): Promise<boolean> {
        return this.queue.enqueue(
            async () => {
                try {
                    await this.conversations.clear();
                    return true;
                } catch (error) {
                    return false;
                }
            },
            "Clear History"
        );
    }

    async setup(): Promise<void> {
        await this.queue.enqueue(
            async () => {
                const count = await this.conversations.count();
                console.debug(`Database initialized with ${count} conversations`);
            },
            "Initialize Database"
        );
    }
}