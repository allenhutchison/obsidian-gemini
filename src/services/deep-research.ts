import { TFile, normalizePath } from 'obsidian';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';
import { ResearchManager, ReportGenerator, Interaction } from '@allenhutchison/gemini-utils';
import { proxyFetch } from '../utils/proxy-fetch';

/**
 * System folders that should not be written to
 */
const PROTECTED_FOLDER_SEGMENTS = ['.obsidian'];

/**
 * Research scope options
 */
export type ResearchScope = 'vault_only' | 'web_only' | 'both';

/**
 * Research result containing all data from a deep research operation
 */
export interface ResearchResult {
	topic: string;
	report: string;
	sourceCount: number;
	outputFile?: TFile;
}

/**
 * Parameters for conducting deep research
 */
export interface DeepResearchParams {
	topic: string;
	scope?: ResearchScope;
	outputFile?: string;
}

/**
 * Service for conducting comprehensive research using Google's Deep Research API.
 * Uses the ResearchManager from gemini-utils for orchestration.
 */
export class DeepResearchService {
	private researchManager: ResearchManager | null = null;
	private reportGenerator: ReportGenerator;
	private currentInteractionId: string | null = null;

	constructor(private plugin: InstanceType<typeof ObsidianGemini>) {
		this.reportGenerator = new ReportGenerator();
	}

	/**
	 * Initialize the ResearchManager with a GoogleGenAI client
	 */
	private ensureResearchManager(): ResearchManager {
		if (!this.plugin.settings.apiKey) {
			throw new Error('Google API key not configured');
		}

		if (!this.researchManager) {
			const genAI = new GoogleGenAI({
				apiKey: this.plugin.settings.apiKey,
			});

			// WORKAROUND (as of @google/genai v0.14.x): The GoogleGenAI interactions getter creates
			// a new client that ignores the fetch option passed to the constructor. We must manually
			// inject our proxyFetch into the generated interactions client to ensure CORS requests
			// are handled correctly in Obsidian's browser environment.
			// This may break if the SDK internal structure changes - monitor on SDK updates.
			const interactions = genAI.interactions as any;
			if (interactions && interactions._client) {
				this.plugin.logger.log('[DeepResearch] Injecting proxyFetch into interactions client');
				interactions._client.fetch = proxyFetch;
			} else {
				this.plugin.logger.warn(
					'[DeepResearch] Could not inject proxyFetch - SDK structure may have changed. CORS issues may occur.'
				);
			}

			this.researchManager = new ResearchManager(genAI);
		}

		return this.researchManager;
	}

	/**
	 * Get file search store names based on scope
	 */
	private getFileSearchStoreNames(scope?: ResearchScope): string[] | undefined {
		// Web only - no vault search
		if (scope === 'web_only') {
			return undefined;
		}

		// Get store name from RAG indexing service
		const storeName = this.plugin.ragIndexing?.getStoreName();

		// Vault only requires RAG to be configured
		if (scope === 'vault_only') {
			if (!storeName) {
				throw new Error('Vault-only research requires RAG indexing to be enabled and configured');
			}
			return [storeName];
		}

		// Default (both) - include vault if available
		if (storeName) {
			return [storeName];
		}

		// No RAG configured - just use web search
		return undefined;
	}

	/**
	 * Conduct comprehensive research on a topic using Google's Deep Research API
	 */
	async conductResearch(params: DeepResearchParams): Promise<ResearchResult> {
		const researchManager = this.ensureResearchManager();

		this.plugin.logger.log(
			`DeepResearch: Starting research on "${params.topic}" with scope: ${params.scope || 'both'}`
		);

		// Get file search store names based on scope
		const fileSearchStoreNames = this.getFileSearchStoreNames(params.scope);

		if (fileSearchStoreNames) {
			this.plugin.logger.log(`DeepResearch: Using file search stores: ${fileSearchStoreNames.join(', ')}`);
		} else {
			this.plugin.logger.log('DeepResearch: Using web search only');
		}

		// Start research (async)
		const interaction = await researchManager.startResearch({
			input: params.topic,
			fileSearchStoreNames,
		});

		// Extract and validate interaction ID
		const interactionId = interaction.id;
		if (!interactionId) {
			this.plugin.logger.error('DeepResearch: Research started but no interaction ID was returned');
			throw new Error('Research failed: No interaction ID returned from API');
		}

		this.currentInteractionId = interactionId;
		this.plugin.logger.log(`DeepResearch: Research started with interaction ID: ${interactionId}`);

		try {
			// Poll until complete
			const completed = await researchManager.poll(interactionId);

			// Check status
			if (completed.status === 'failed') {
				const errorMessage = (completed as any).error?.message || 'Unknown error';
				throw new Error(`Research failed: ${errorMessage}`);
			}

			if (completed.status === 'cancelled') {
				throw new Error('Research was cancelled');
			}

			this.plugin.logger.log('DeepResearch: Research completed, generating report');

			// Generate markdown report from outputs
			const report = this.generateReport(params.topic, completed);

			// Count sources from outputs
			const sourceCount = this.countSources(completed);

			// Save to file if requested
			let outputFile: TFile | undefined;
			if (params.outputFile) {
				outputFile = (await this.saveReport(params.outputFile, report)) || undefined;
			}

			return {
				topic: params.topic,
				report,
				sourceCount,
				outputFile,
			};
		} finally {
			this.currentInteractionId = null;
		}
	}

	/**
	 * Cancel the current research operation
	 */
	async cancelResearch(): Promise<void> {
		if (this.currentInteractionId && this.researchManager) {
			this.plugin.logger.log(`DeepResearch: Cancelling research ${this.currentInteractionId}`);
			try {
				await this.researchManager.cancel(this.currentInteractionId);
			} catch (error) {
				this.plugin.logger.error('DeepResearch: Failed to cancel research:', error);
			}
			this.currentInteractionId = null;
		}
	}

	/**
	 * Check if research is currently in progress
	 */
	isResearching(): boolean {
		return this.currentInteractionId !== null;
	}

	/**
	 * Generate a formatted markdown report from the interaction outputs
	 */
	private generateReport(topic: string, interaction: Interaction): string {
		// Use the report generator from gemini-utils for basic structure
		const baseReport = this.reportGenerator.generateMarkdown(interaction.outputs || []);

		// Add our custom header with topic and date
		const header = `# ${topic}\n\n*Generated on ${new Date().toLocaleDateString()}*\n\n---\n\n`;

		// Replace the generic header from ReportGenerator
		const reportBody = baseReport.replace(/^# Research Report\n\n/, '');

		return header + reportBody;
	}

	/**
	 * Count unique sources from the interaction outputs
	 */
	private countSources(interaction: Interaction): number {
		const sources = new Set<string>();

		for (const output of interaction.outputs || []) {
			if (output.type === 'text') {
				const annotations = (output as any).annotations as Array<{ source?: string }> | undefined;
				if (annotations) {
					for (const annotation of annotations) {
						if (annotation.source) {
							sources.add(annotation.source);
						}
					}
				}
			}
		}

		return sources.size;
	}

	/**
	 * Validate and normalize the output file path.
	 * Throws an error if the path is inside a protected system folder.
	 */
	private validateAndNormalizeFilePath(rawFilePath: string): string {
		// Normalize the path using Obsidian's normalizePath (handles slashes, removes redundant separators)
		const normalizedPath = normalizePath(rawFilePath);

		// Split into segments to check for protected folders
		const segments = normalizedPath.split('/');

		// Check for protected folder segments
		for (const segment of segments) {
			if (PROTECTED_FOLDER_SEGMENTS.includes(segment)) {
				throw new Error(
					`Cannot write report to protected system folder: "${segment}". Please choose a different output location.`
				);
			}
		}

		// Check if path is inside the plugin's history folder (or is the folder itself)
		const historyFolder = this.plugin.settings.historyFolder;
		if (historyFolder && (normalizedPath === historyFolder || normalizedPath.startsWith(historyFolder + '/'))) {
			throw new Error(
				`Cannot write report to plugin state folder: "${historyFolder}". Please choose a different output location.`
			);
		}

		return normalizedPath;
	}

	/**
	 * Save the research report to a file
	 */
	private async saveReport(filePath: string, content: string): Promise<TFile | null> {
		try {
			// Validate and normalize the file path before any write operations
			const normalizedPath = this.validateAndNormalizeFilePath(filePath);

			// Check if file exists
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);
			if (existingFile instanceof TFile) {
				// Update existing file
				await this.plugin.app.vault.modify(existingFile, content);
				return existingFile;
			} else {
				// Create new file
				return await this.plugin.app.vault.create(normalizedPath, content);
			}
		} catch (error) {
			this.plugin.logger.error('DeepResearch: Failed to save report:', error);
			return null;
		}
	}
}
