import { TFolder, TFile, Notice } from 'obsidian';
import type ObsidianGemini from '../main';
import { GeminiClientFactory } from '../api/simple-factory';
import { AgentsMemoryData } from './agents-memory';
import { VaultAnalysisModal } from '../ui/vault-analysis-modal';

/**
 * Service for analyzing vault structure and generating AGENTS.md content
 */
export class VaultAnalyzer {
	constructor(private plugin: InstanceType<typeof ObsidianGemini>) {}

	/**
	 * Analyze the vault and initialize/update AGENTS.md
	 */
	async initializeAgentsMemory(): Promise<void> {
		// Create and open the progress modal
		const modal = new VaultAnalysisModal(this.plugin.app);
		modal.open();

		// Define steps
		modal.addStep('collect', 'Collecting vault information');
		modal.addStep('analyze', 'Analyzing with AI');
		modal.addStep('parse', 'Processing results');
		modal.addStep('render', 'Rendering template');
		modal.addStep('write', 'Writing AGENTS.md');

		try {
			// Step 1: Collect vault information
			modal.setStepInProgress('collect');
			modal.updateStatus('Analyzing vault structure...');
			const vaultInfo = this.collectVaultInformation();
			modal.setStepComplete('collect');

			// Read existing AGENTS.md if it exists
			const existingContent = await this.plugin.agentsMemory.read();

			// Build the analysis prompt
			const analysisPrompt = this.buildAnalysisPrompt(vaultInfo, existingContent);

			// Step 2: Call AI
			modal.setStepInProgress('analyze');
			modal.updateStatus('Generating vault context with AI...');
			const modelApi = GeminiClientFactory.createChatModel(this.plugin);
			const response = await modelApi.generateModelResponse({
				prompt: analysisPrompt,
				model: this.plugin.settings.chatModelName,
				userMessage: '',
				conversationHistory: [],
				renderContent: false
			});
			modal.setStepComplete('analyze');

			// Step 3: Parse response
			modal.setStepInProgress('parse');
			modal.updateStatus('Processing AI response...');
			const generatedData = this.parseAnalysisResponse(response.markdown);

			if (!generatedData) {
				modal.setStepFailed('parse', 'Failed to parse AI response');
				console.error('Failed to parse analysis response:', response.markdown);
				new Notice('Failed to parse AI response. Check console for details.');
				setTimeout(() => modal.close(), 3000);
				return;
			}

			// Debug: Log the parsed data structure
			if (this.plugin.settings.debugMode) {
				console.log('Parsed AGENTS.md data:', generatedData);
			}
			modal.setStepComplete('parse');

			// Step 4: Render template
			modal.setStepInProgress('render');
			modal.updateStatus('Rendering content...');
			const renderedContent = await this.plugin.agentsMemory.render(generatedData);
			modal.setStepComplete('render');

			// Step 5: Write to file
			modal.setStepInProgress('write');
			modal.updateStatus('Writing AGENTS.md...');
			await this.plugin.agentsMemory.write(renderedContent);
			modal.setStepComplete('write');

			// Success!
			const action = existingContent ? 'updated' : 'created';
			modal.setComplete(`AGENTS.md ${action} successfully!`);
			new Notice(`AGENTS.md ${action} successfully!`);

			// Open the file for review
			const memoryPath = this.plugin.agentsMemory.getMemoryFilePath();
			const file = this.plugin.app.vault.getAbstractFileByPath(memoryPath);
			if (file instanceof TFile) {
				await this.plugin.app.workspace.openLinkText(file.path, '', false);
			}
		} catch (error) {
			console.error('Failed to initialize AGENTS.md:', error);
			modal.setStepFailed(modal['currentStep'], error instanceof Error ? error.message : 'Unknown error');
			new Notice('Failed to initialize AGENTS.md. Check console for details.');
			setTimeout(() => modal.close(), 3000);
		}
	}

	/**
	 * Collect information about the vault structure
	 */
	private collectVaultInformation(): string {
		const vault = this.plugin.app.vault;
		const root = vault.getRoot();

		// Get all markdown files
		const allFiles = vault.getMarkdownFiles();
		const fileCount = allFiles.length;

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
		vaultInfo += sampleFiles.map(f => `- ${f}`).join('\n');
		vaultInfo += '\n\n';

		return vaultInfo;
	}

	/**
	 * Build a text representation of the folder structure
	 */
	private buildFolderStructure(folder: TFolder, depth: number = 0, maxDepth: number = 3): string {
		if (depth > maxDepth) return '';

		const indent = '  '.repeat(depth);
		let structure = '';

		// Skip system folders
		const skipFolders = ['.obsidian', this.plugin.settings.historyFolder];
		if (skipFolders.includes(folder.path)) {
			return '';
		}

		// Add folder
		if (depth > 0) {
			const fileCount = this.countMarkdownFilesInFolder(folder);
			structure += `${indent}- 📁 **${folder.name}/** (${fileCount} files)\n`;
		}

		// Sort children: folders first, then files
		const folders = folder.children.filter(c => c instanceof TFolder) as TFolder[];
		const files = folder.children.filter(c => c instanceof TFile && c.extension === 'md') as TFile[];

		// Add subfolders recursively
		folders
			.sort((a, b) => a.name.localeCompare(b.name))
			.forEach(subfolder => {
				structure += this.buildFolderStructure(subfolder, depth + 1, maxDepth);
			});

		// Add files (limit to prevent overwhelming output)
		if (files.length > 0 && depth < maxDepth) {
			const displayFiles = files.slice(0, 5);
			displayFiles.forEach(file => {
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
		let count = 0;

		const countRecursive = (f: TFolder) => {
			f.children.forEach(child => {
				if (child instanceof TFile && child.extension === 'md') {
					count++;
				} else if (child instanceof TFolder) {
					countRecursive(child);
				}
			});
		};

		countRecursive(folder);
		return count;
	}

	/**
	 * Get a representative sample of file names for topic analysis
	 */
	private getSampleFileNames(files: TFile[], limit: number = 20): string[] {
		// Get files from different parts of the vault for diversity
		const skipPaths = [this.plugin.settings.historyFolder, '.obsidian'];
		const filteredFiles = files.filter(f =>
			!skipPaths.some(skip => f.path.startsWith(skip))
		);

		// Sort by modification time to get recent files
		const sortedFiles = filteredFiles
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit);

		return sortedFiles.map(f => {
			const folderPath = f.parent?.path || '';
			return folderPath ? `${folderPath}/${f.basename}` : f.basename;
		});
	}

	/**
	 * Build the analysis prompt with vault information
	 */
	private buildAnalysisPrompt(vaultInfo: string, existingContent: string | null): string {
		const basePrompt = this.plugin.prompts.vaultAnalysisPrompt({
			existingContent: existingContent || ''
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

			const parsed = JSON.parse(jsonString);

			// Validate the structure
			if (!parsed || typeof parsed !== 'object') {
				return null;
			}

			return {
				vaultOverview: parsed.vaultOverview || '',
				organization: parsed.organization || '',
				keyTopics: parsed.keyTopics || '',
				userPreferences: parsed.userPreferences || '',
				customInstructions: parsed.customInstructions || ''
			};
		} catch (error) {
			console.error('Failed to parse analysis response:', error);
			return null;
		}
	}

	/**
	 * Setup the command palette command
	 */
	setupInitCommand(): void {
		this.plugin.addCommand({
			id: 'gemini-scribe-init-agents-memory',
			name: 'Initialize/Update Vault Context (AGENTS.md)',
			callback: () => this.initializeAgentsMemory(),
		});
	}
}
