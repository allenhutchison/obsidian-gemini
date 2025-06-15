import { Vault, TFile, normalizePath } from 'obsidian';
import ObsidianGemini from '../../main';
import { CustomPrompt, PromptInfo } from './types';

export class PromptManager {
	constructor(
		private plugin: ObsidianGemini,
		private vault: Vault
	) {}

	// Get the prompts directory path
	getPromptsDirectory(): string {
		return normalizePath(`${this.plugin.settings.historyFolder}/Prompts`);
	}

	// Ensure prompts directory exists
	async ensurePromptsDirectory(): Promise<void> {
		const promptsDir = this.getPromptsDirectory();
		if (!await this.vault.adapter.exists(promptsDir)) {
			await this.vault.createFolder(promptsDir);
		}
	}

	// Load a prompt from file
	async loadPromptFromFile(filePath: string): Promise<CustomPrompt | null> {
		try {
			const file = this.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return null;
			
			const content = await this.vault.read(file);
			return this.parsePromptFile(content);
		} catch (error) {
			console.error('Error loading prompt file:', error);
			return null;
		}
	}

	// Parse prompt file content
	private parsePromptFile(content: string): CustomPrompt {
		const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
		const match = content.match(frontmatterRegex);
		
		let frontmatter: any = {};
		let promptContent = content;
		
		if (match) {
			// Parse YAML frontmatter
			const frontmatterText = match[1];
			promptContent = match[2].trim();
			
			// Simple YAML parsing for our use case
			frontmatterText.split('\n').forEach(line => {
				const colonIndex = line.indexOf(':');
				if (colonIndex > -1) {
					const key = line.substring(0, colonIndex).trim();
					let value: any = line.substring(colonIndex + 1).trim();
					
					// Handle quoted strings
					if ((value.startsWith('"') && value.endsWith('"')) || 
						(value.startsWith("'") && value.endsWith("'"))) {
						value = value.slice(1, -1);
					}
					// Handle booleans
					else if (value === 'true') value = true;
					else if (value === 'false') value = false;
					// Handle numbers
					else if (!isNaN(Number(value))) value = Number(value);
					// Handle arrays (simple case)
					else if (value.startsWith('[') && value.endsWith(']')) {
						value = value.slice(1, -1).split(',').map((v: string) => v.trim().replace(/["']/g, ''));
					}
					
					frontmatter[key] = value;
				}
			});
		}
		
		return {
			name: frontmatter.name || 'Unnamed Prompt',
			description: frontmatter.description || '',
			version: frontmatter.version || 1,
			overrideSystemPrompt: frontmatter.override_system_prompt || false,
			tags: frontmatter.tags || [],
			content: promptContent
		};
	}

	// Get prompt from note's frontmatter
	async getPromptFromNote(file: TFile): Promise<CustomPrompt | null> {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const promptPath = cache?.frontmatter?.['gemini-scribe-prompt'];
		
		if (!promptPath) return null;
		
		// Extract path from wikilink
		const linkpath = this.extractPathFromWikilink(promptPath);
		if (!linkpath) return null;
		
		// Use Obsidian's link resolution to find the file
		// getFirstLinkpathDest resolves the link path relative to the source file
		const linkedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (!linkedFile || !(linkedFile instanceof TFile)) return null;
		
		return await this.loadPromptFromFile(linkedFile.path);
	}

	// Extract path from wikilink format
	private extractPathFromWikilink(wikilink: string): string | null {
		const match = wikilink.match(/\[\[(.+?)\]\]/);
		return match ? match[1] : null;
	}

	// List all available prompts
	async listAvailablePrompts(): Promise<PromptInfo[]> {
		const promptsDir = this.getPromptsDirectory();
		const files = await this.vault.adapter.list(promptsDir);
		
		const prompts: PromptInfo[] = [];
		for (const filePath of files.files) {
			if (filePath.endsWith('.md')) {
				const prompt = await this.loadPromptFromFile(filePath);
				if (prompt) {
					prompts.push({
						path: filePath,
						name: prompt.name,
						description: prompt.description,
						tags: prompt.tags
					});
				}
			}
		}
		
		return prompts;
	}

	// Create default example prompts on first run
	async createDefaultPrompts(): Promise<void> {
		const promptsDir = this.getPromptsDirectory();
		const examplePromptPath = normalizePath(`${promptsDir}/example-expert.md`);
		
		if (!await this.vault.adapter.exists(examplePromptPath)) {
			const exampleContent = `---
name: "Subject Matter Expert"
description: "A knowledgeable expert who provides detailed, accurate information"
version: 1
override_system_prompt: false
tags: ["general", "expert"]
---

You are a subject matter expert with comprehensive knowledge across multiple domains. When answering questions:

- Provide accurate, well-researched information
- Cite relevant sources when possible
- Explain complex concepts clearly
- Acknowledge limitations in your knowledge
- Offer multiple perspectives when appropriate

Focus on being helpful while maintaining intellectual honesty.`;

			await this.vault.create(examplePromptPath, exampleContent);
		}
	}
}