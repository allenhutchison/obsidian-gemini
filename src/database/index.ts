import Dexie, { Table } from 'dexie';
import { IGeminiDatabase, GeminiConversationEntry } from './types';
import { DatabaseQueue } from './queue';
import { DatabaseOperations } from './operations';
import { DatabaseExporter } from './export';
import ObsidianGemini from '../../main';
import { PeriodicExport } from './periodic-export';

export class GeminiDatabase extends Dexie implements IGeminiDatabase {
	conversations!: Table<GeminiConversationEntry, number>;
	private queue: DatabaseQueue;
	private operations: DatabaseOperations;
	private exporter: DatabaseExporter;
	private periodicExport: PeriodicExport;

	// Database operations
	public addConversation: (conversation: GeminiConversationEntry) => Promise<number>;
	public getConversations: (notePath: string) => Promise<GeminiConversationEntry[]>;
	public clearConversations: (notePath: string) => Promise<number>;
	public clearHistory: () => Promise<boolean>;

	// Export operations
	public exportDatabaseToVault: () => Promise<void>;
	public importDatabaseFromVault: () => Promise<boolean>;

	constructor(private plugin: ObsidianGemini) {
		super('GeminiDatabase');
		this.version(2).stores({
			conversations: '++id, notePath, [notePath+created_at], created_at, role, message',
		});

		this.queue = new DatabaseQueue();
		this.operations = new DatabaseOperations(this.conversations, this.queue);
		this.exporter = new DatabaseExporter(this.conversations, this.queue, plugin, this.operations);
		this.periodicExport = new PeriodicExport(this.exporter);

		// Bind operations after initialization
		this.addConversation = this.operations.addConversation.bind(this.operations);
		this.getConversations = this.operations.getConversations.bind(this.operations);
		this.clearConversations = this.operations.clearConversations.bind(this.operations);
		this.clearHistory = this.operations.clearHistory.bind(this.operations);

		// Bind export operations
		this.exportDatabaseToVault = this.exporter.exportDatabaseToVault.bind(this.exporter);
		this.importDatabaseFromVault = this.exporter.importDatabaseFromVault.bind(this.exporter);

		this.open();
	}

	async setupDatabase(): Promise<void> {
		try {
			await this.open();
			await this.operations.setup();
			if (this.plugin.settings.chatHistory) {
				const result = await this.importDatabaseFromVault();
				if (!result) {
					console.debug('No existing history found or import failed');
				}
				this.periodicExport.start();
			}
		} catch (error) {
			console.error('Failed to setup database:', error);
			throw error;
		}
	}

	async close(): Promise<void> {
		try {
			this.periodicExport.stop();
			if (this.plugin.settings.chatHistory) {
				await this.exportDatabaseToVault();
			}
			super.close();
		} catch (error) {
			console.error('Error during database close:', error);
			throw error;
		}
	}
}
