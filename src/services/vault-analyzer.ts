import { TFolder, TFile, Notice } from 'obsidian';
import { getActiveChatModel } from '../models';
import type { ObsidianGemini } from '../types/plugin';
import { ModelClientFactory } from '../api';
import { AgentsMemoryData } from './agents-memory';
import { VaultAnalysisModal } from '../ui/vault-analysis-modal';
import { collectFilesFromFolder } from '../utils/folder-walk';
import { isPathInFolder } from '../utils/file-utils';
import { t } from '../i18n';
import { asRecord, getRawErrorMessageOr } from '../utils/error-utils';

/**
 * Simple cache entry for vault information
 */
interface VaultInfoCache {
	vaultInfo: string;
	fileCount: number;
	lastModified: number;
	timestamp: number;
}

/**
 * Service for analyzing vault structure and generating AGENTS.md content
 */
export class VaultAnalyzer {
	private vaultInfoCache: VaultInfoCache | null = null;
	private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

	constructor(private plugin: ObsidianGemini) {}

	/**
	 * Helper to ensure minimum display time for each step
	 */
	private async ensureMinimumDelay(startTime: number, minimumMs: number = 2000): Promise<void> {
		const elapsed = Date.now() - startTime;
		const remaining = minimumMs - elapsed;
		if (remaining > 0) {
			await new Promise((resolve) => window.setTimeout(resolve, remaining));
		}
	}

	/**
	 * Analyze the vault and initialize/update AGENTS.md
	 */
	async initializeAgentsMemory(): Promise<void> {
		// Create and open the progress modal
		const modal = new VaultAnalysisModal(this.plugin.app);
		modal.open();

		// Get the model name for display
		const modelName = getActiveChatModel(this.plugin.settings);

		// Define steps
		modal.addStep('collect', t('modal.vaultAnalysis.stepCollect'));
		modal.addStep('analyze', t('modal.vaultAnalysis.stepAnalyze', { model: modelName }));
		modal.addStep('parse', t('modal.vaultAnalysis.stepParse'));
		modal.addStep('render', t('modal.vaultAnalysis.stepRender'));
		modal.addStep('write', t('modal.vaultAnalysis.stepWrite'));
		modal.addStep('examples', t('modal.vaultAnalysis.stepExamples'));
		modal.addStep('save-examples', t('modal.vaultAnalysis.stepSaveExamples'));

		try {
			// Step 1: Collect vault information
			let stepStart = Date.now();
			modal.setStepInProgress('collect');
			modal.updateStatus(t('modal.vaultAnalysis.statusAnalyzing'));
			const vaultInfo = this.collectVaultInformation();
			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('collect');

			// Read existing AGENTS.md if it exists
			const existingContent = await this.plugin.agentsMemory.read();

			// Build the analysis prompt
			const analysisPrompt = this.buildAnalysisPrompt(vaultInfo, existingContent);

			// Step 2: Call model
			stepStart = Date.now();
			modal.setStepInProgress('analyze');
			modal.updateStatus(t('modal.vaultAnalysis.statusGenerating', { model: modelName }));
			const modelApi = ModelClientFactory.createChatModel(this.plugin);
			const response = await modelApi.generateModelResponse({
				kind: 'base',
				prompt: analysisPrompt,
				model: getActiveChatModel(this.plugin.settings),
			});
			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('analyze');

			// Step 3: Parse response
			stepStart = Date.now();
			modal.setStepInProgress('parse');
			modal.updateStatus(t('modal.vaultAnalysis.statusProcessing'));
			const generatedData = this.parseAnalysisResponse(response.markdown);

			if (!generatedData) {
				modal.setStepFailed('parse', t('modal.vaultAnalysis.parseFailedStep'));
				this.plugin.logger.error('Failed to parse analysis response:', response.markdown);
				new Notice(t('notice.vaultAnalysis.parseFailed'));
				window.setTimeout(() => modal.close(), 3000);
				return;
			}

			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('parse');

			// Step 4: Render template
			stepStart = Date.now();
			modal.setStepInProgress('render');
			modal.updateStatus(t('modal.vaultAnalysis.statusRendering'));
			const renderedContent = this.plugin.agentsMemory.render(generatedData);
			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('render');

			// Step 5: Write to file
			stepStart = Date.now();
			modal.setStepInProgress('write');
			modal.updateStatus(t('modal.vaultAnalysis.statusWriting'));
			await this.plugin.agentsMemory.write(renderedContent);
			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('write');

			// Step 6: Generate example prompts
			stepStart = Date.now();
			modal.setStepInProgress('examples');
			modal.updateStatus(t('modal.vaultAnalysis.statusExamples', { model: modelName }));

			// Read existing prompts to help generate new, different ones
			let existingPromptsString: string | undefined;
			const existingPrompts = await this.plugin.examplePrompts.read();
			if (existingPrompts && existingPrompts.length > 0) {
				existingPromptsString = JSON.stringify(existingPrompts, null, 2);
			}

			const examplePromptsPrompt = this.plugin.prompts.examplePromptsPrompt(vaultInfo, existingPromptsString);
			const examplePromptsResponse = await modelApi.generateModelResponse({
				kind: 'base',
				prompt: examplePromptsPrompt,
				model: getActiveChatModel(this.plugin.settings),
			});
			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('examples');

			// Step 7: Save example prompts
			stepStart = Date.now();
			modal.setStepInProgress('save-examples');
			modal.updateStatus(t('modal.vaultAnalysis.statusSavingExamples'));
			const examplePrompts = this.parseExamplePromptsResponse(examplePromptsResponse.markdown);
			if (examplePrompts && examplePrompts.length > 0) {
				await this.plugin.examplePrompts.write(examplePrompts);
			} else {
				this.plugin.logger.warn('Failed to generate example prompts, skipping save');
			}
			await this.ensureMinimumDelay(stepStart);
			modal.setStepComplete('save-examples');

			// Success!
			const successMessage = existingContent ? t('notice.vaultAnalysis.updated') : t('notice.vaultAnalysis.created');
			modal.setComplete(successMessage);
			new Notice(successMessage);

			// Open the file for review
			const memoryPath = this.plugin.agentsMemory.getMemoryFilePath();
			const file = this.plugin.app.vault.getAbstractFileByPath(memoryPath);
			if (file instanceof TFile) {
				await this.plugin.app.workspace.openLinkText(file.path, '', false);
			}
		} catch (error) {
			this.plugin.logger.error('Failed to initialize AGENTS.md:', error);
			modal.setStepFailed(modal.currentStep, getRawErrorMessageOr(error, t('modal.vaultAnalysis.unknownError')));
			new Notice(t('notice.vaultAnalysis.initFailed'));
			window.setTimeout(() => modal.close(), 3000);
		}
	}

	/**
	 * Collect information about the vault structure
	 * Uses caching for large vaults to improve performance
	 */
	private collectVaultInformation(): string {
		const vault = this.plugin.app.vault;
		const allFiles = vault.getMarkdownFiles();
		const fileCount = allFiles.length;

		// Calculate vault fingerprint (file count + most recent modification)
		const lastModified = allFiles.length > 0 ? Math.max(...allFiles.map((f) => f.stat.mtime)) : 0;

		// Check if we can use cached data (for large vaults)
		if (this.vaultInfoCache && fileCount > 1000) {
			const now = Date.now();
			const cacheValid =
				this.vaultInfoCache.fileCount === fileCount &&
				this.vaultInfoCache.lastModified === lastModified &&
				now - this.vaultInfoCache.timestamp < this.CACHE_TTL_MS;

			if (cacheValid) {
				this.plugin.logger.log('VaultAnalyzer: Using cached vault information');
				return this.vaultInfoCache.vaultInfo;
			}
		}

		// Cache miss or invalid - collect fresh data
		const root = vault.getRoot();

		// Build folder structure
		const folderStructure = this.buildFolderStructure(root);

		// Get sample file names from different folders (for topic analysis)
		const sampleFiles = this.getSampleFileNames(allFiles, 20);

		// Build vault information summary
		let vaultInfo = '# Vault Information\n\n';
		vaultInfo += `**Total Files:** ${fileCount} markdown files\n\n`;
		vaultInfo += '## Folder Structure\n\n';
		vaultInfo += folderStructure;
		vaultInfo += '\n## Sample File Names\n\n';
		vaultInfo += sampleFiles.map((f) => `- ${f}`).join('\n');
		vaultInfo += '\n\n';

		// Update cache for large vaults
		if (fileCount > 1000) {
			this.vaultInfoCache = {
				vaultInfo,
				fileCount,
				lastModified,
				timestamp: Date.now(),
			};
			this.plugin.logger.log('VaultAnalyzer: Cached vault information for large vault');
		}

		return vaultInfo;
	}

	/**
	 * Build a text representation of the folder structure
	 */
	private buildFolderStructure(folder: TFolder, depth: number = 0, maxDepth: number = 3): string {
		if (depth > maxDepth) return '';

		const indent = '  '.repeat(depth);
		let structure = '';

		// Skip system folders (the Obsidian config dir may be renamed from `.obsidian`)
		const skipFolders = [this.plugin.app.vault.configDir, this.plugin.settings.historyFolder];
		if (skipFolders.includes(folder.path)) {
			return '';
		}

		// Add folder
		if (depth > 0) {
			const fileCount = this.countMarkdownFilesInFolder(folder);
			structure += `${indent}- 📁 **${folder.name}/** (${fileCount} files)\n`;
		}

		// Sort children: folders first, then files
		const folders = folder.children.filter((c) => c instanceof TFolder);
		const files = folder.children.filter((c) => c instanceof TFile && c.extension === 'md') as TFile[];

		// Add subfolders recursively
		folders
			.sort((a, b) => a.name.localeCompare(b.name))
			.forEach((subfolder) => {
				structure += this.buildFolderStructure(subfolder, depth + 1, maxDepth);
			});

		// Add files (limit to prevent overwhelming output)
		if (files.length > 0 && depth < maxDepth) {
			const displayFiles = files.slice(0, 5);
			displayFiles.forEach((file) => {
				structure += `${indent}  - ${file.basename}\n`;
			});
			if (files.length > 5) {
				structure += `${indent}  - ... (${files.length - 5} more files)\n`;
			}
		}

		return structure;
	}

	/**
	 * Count markdown files in a folder (including subfolders)
	 */
	private countMarkdownFilesInFolder(folder: TFolder): number {
		return collectFilesFromFolder(folder, { filter: (f) => f.extension === 'md' }).length;
	}

	/**
	 * Get a representative sample of file names for topic analysis
	 */
	private getSampleFileNames(files: TFile[], limit: number = 20): string[] {
		// Get files from different parts of the vault for diversity
		const skipPaths = [this.plugin.settings.historyFolder, this.plugin.app.vault.configDir];
		// Root-anchored containment so a sibling like `gemini-scribe-backup/` or a
		// renamed `_obsidian-notes/` is not wrongly excluded by a bare prefix match.
		const filteredFiles = files.filter((f) => !skipPaths.some((skip) => isPathInFolder(f.path, skip)));

		// Sort by modification time to get recent files
		const sortedFiles = filteredFiles.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);

		return sortedFiles.map((f) => {
			const folderPath = f.parent?.path || '';
			return folderPath ? `${folderPath}/${f.basename}` : f.basename;
		});
	}

	/**
	 * Build the analysis prompt with vault information
	 */
	private buildAnalysisPrompt(vaultInfo: string, existingContent: string | null): string {
		const basePrompt = this.plugin.prompts.vaultAnalysisPrompt({
			existingContent: existingContent || '',
		});

		return `${basePrompt}\n\n${vaultInfo}`;
	}

	/**
	 * Parse the JSON response from the analysis
	 */
	private parseAnalysisResponse(response: string): AgentsMemoryData | null {
		try {
			// Try to extract JSON from code blocks
			const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
			const jsonString = jsonMatch ? jsonMatch[1] : response;

			const parsed: unknown = JSON.parse(jsonString);

			// Validate the structure
			if (!parsed || typeof parsed !== 'object') {
				return null;
			}

			const record = asRecord(parsed);
			const str = (value: unknown): string => (typeof value === 'string' ? value : '');
			return {
				vaultOverview: str(record.vaultOverview),
				organization: str(record.organization),
				keyTopics: str(record.keyTopics),
				userPreferences: str(record.userPreferences),
				customInstructions: str(record.customInstructions),
			};
		} catch (error) {
			this.plugin.logger.error('Failed to parse analysis response:', error);
			return null;
		}
	}

	/**
	 * Parse the JSON array response from example prompts generation
	 * @param response - The AI model response containing example prompts JSON
	 * @returns Array of validated example prompts, or null if parsing fails
	 */
	private parseExamplePromptsResponse(response: string): Array<{ icon: string; text: string }> | null {
		try {
			// Try to extract JSON from code blocks
			const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
			let jsonString = jsonMatch ? jsonMatch[1] : response;

			// Clean up the response - remove any extra text
			jsonString = jsonString.trim();

			// If it doesn't start with [, try to find the array
			if (!jsonString.startsWith('[')) {
				const arrayMatch = jsonString.match(/\[([\s\S]*)\]/);
				if (arrayMatch) {
					jsonString = arrayMatch[0];
				} else {
					this.plugin.logger.warn('Could not find JSON array in AI response for example prompts');
					this.plugin.logger.debug('Response snippet:', response.substring(0, 200));
					return null;
				}
			}

			const parsed: unknown = JSON.parse(jsonString);

			// Validate the structure: must be array
			if (!Array.isArray(parsed)) {
				this.plugin.logger.warn('Example prompts response is not an array');
				return null;
			}

			const items: unknown[] = parsed;

			// Validate each prompt has required fields with proper types
			const isValid = items.every((p): p is { icon: string; text: string } => {
				const prompt = asRecord(p);
				return (
					typeof prompt.icon === 'string' &&
					typeof prompt.text === 'string' &&
					prompt.icon.trim().length > 0 &&
					prompt.text.trim().length > 0
				);
			});

			if (!isValid) {
				this.plugin.logger.warn('Invalid example prompt structure - missing or invalid fields');
				this.plugin.logger.debug('Parsed data:', JSON.stringify(items, null, 2));
				return null;
			}

			this.plugin.logger.log(`Successfully parsed ${items.length} example prompts`);
			return items;
		} catch (error) {
			this.plugin.logger.error('Failed to parse example prompts response:', error);
			this.plugin.logger.debug('Response that failed to parse:', response.substring(0, 500));
			return null;
		}
	}
}
