import { GeminiDatabase } from '../database';
import { MarkdownHistory } from '../markdownHistory';
import ObsidianGemini from '../../main';
import { TFile, Notice } from 'obsidian';
import { GeminiConversationEntry } from '../database/types';

export class DatabaseToMarkdownMigration {
    constructor(private plugin: ObsidianGemini) {}

    async migrateHistory(): Promise<void> {
        try {
            // Initialize the database
            const database = new GeminiDatabase(this.plugin);
            await database.setupDatabase();

            // Get all conversations from the database
            const folder = await this.plugin.app.vault.createFolder(this.plugin.settings.historyFolder)
                .catch(() => {}); // Ignore if folder exists

            // Get all files in the vault
            const files = this.plugin.app.vault.getFiles();
            const migratedCount = { success: 0, failed: 0 };

            for (const file of files) {
                try {
                    const conversations = await database.getConversations(file.path);
                    if (conversations.length > 0) {
                        await this.migrateFileHistory(file, conversations);
                        migratedCount.success++;
                    }
                } catch (error) {
                    console.error(`Failed to migrate history for ${file.path}:`, error);
                    migratedCount.failed++;
                }
            }

            new Notice(
                `Migration complete: ${migratedCount.success} files migrated, ${migratedCount.failed} failed`
            );

            // Close the database
            await database.close();
        } catch (error) {
            console.error('Migration failed:', error);
            new Notice('Failed to migrate chat history');
            throw error;
        }
    }

    private async migrateFileHistory(file: TFile, conversations: GeminiConversationEntry[]): Promise<void> {
        // Sort conversations by timestamp
        const sortedConversations = conversations.sort(
            (a, b) => a.created_at.getTime() - b.created_at.getTime()
        );

        // Migrate each conversation entry
        for (const conversation of sortedConversations) {
            await this.plugin.history.appendHistoryForFile(file, {
                role: conversation.role,
                message: conversation.message,
                model: conversation.metadata?.model,
                userMessage: conversation.metadata?.userMessage,
            });
        }
    }
} 