import { Tool, ToolResult, ToolExecutionContext } from './types';
import { ToolCategory } from '../types/agent';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';
import { TFile } from 'obsidian';

/**
 * Deep Research Tool that conducts comprehensive research with multiple searches
 * and generates a well-cited report
 */
export class DeepResearchTool implements Tool {
	name = 'deep_research';
	displayName = 'Deep Research';
	category = ToolCategory.READ_ONLY;
	description = 'Conduct comprehensive, multi-phase research on a complex topic using iterative Google searches and AI synthesis. Performs multiple rounds of targeted searches (1-5 iterations), analyzes information gaps, generates follow-up queries, and compiles findings into a well-structured markdown report with inline citations. Returns a professional research document with sections, summaries, and a complete sources bibliography. Optionally saves the report to a vault file. Use this for in-depth research projects, literature reviews, or when you need a thorough analysis with proper academic-style citations. WARNING: This tool performs many API calls and may take several minutes to complete.';
	requiresConfirmation = true;
	
	parameters = {
		type: 'object' as const,
		properties: {
			topic: {
				type: 'string' as const,
				description: 'The research topic or question'
			},
			depth: {
				type: 'number' as const,
				description: 'Number of search iterations (1-5, default: 3)'
			},
			outputFile: {
				type: 'string' as const,
				description: 'Path for the output report file (optional)'
			}
		},
		required: ['topic']
	};
	
	confirmationMessage = (params: { topic: string; depth?: number }) => {
		return `Conduct deep research on: "${params.topic}" with ${params.depth || 3} search iterations`;
	};

	async execute(params: { topic: string; depth?: number; outputFile?: string }, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as InstanceType<typeof ObsidianGemini>;
		const depth = Math.min(Math.max(params.depth || 3, 1), 5); // Clamp between 1-5
		
		try {
			// Check if API key is available
			if (!plugin.settings.apiKey) {
				return {
					success: false,
					error: 'Google API key not configured'
				};
			}

			// Initialize research state
			const research = {
				topic: params.topic,
				searches: [] as SearchResult[],
				sources: new Map<string, Source>(),
				sections: [] as Section[]
			};

			// Create AI instance
			const genAI = new GoogleGenAI({ apiKey: plugin.settings.apiKey });
			const modelToUse = plugin.settings.chatModelName || 'gemini-2.5-flash';

			// Phase 1: Initial search
			const initialQueries = await this.generateSearchQueries(genAI, modelToUse, params.topic, []);
			
			for (const query of initialQueries.slice(0, 2)) { // Start with 2 searches
				const searchResult = await this.performSearch(genAI, modelToUse, query);
				if (searchResult) {
					research.searches.push(searchResult);
					this.extractSources(searchResult, research.sources);
				}
			}

			// Phase 2: Iterative deepening
			for (let i = 1; i < depth; i++) {
				// Analyze gaps and generate follow-up queries
				const followUpQueries = await this.generateFollowUpQueries(
					genAI, 
					modelToUse, 
					params.topic, 
					research.searches
				);

				for (const query of followUpQueries.slice(0, 2)) {
					const searchResult = await this.performSearch(genAI, modelToUse, query);
					if (searchResult) {
						research.searches.push(searchResult);
						this.extractSources(searchResult, research.sources);
					}
				}
			}

			// Phase 3: Generate report structure
			const outline = await this.generateOutline(genAI, modelToUse, params.topic, research.searches);

			// Phase 4: Generate sections with citations
			for (const sectionTitle of outline) {
				const section = await this.generateSection(
					genAI,
					modelToUse,
					params.topic,
					sectionTitle,
					research.searches,
					research.sources
				);
				research.sections.push(section);
			}

			// Phase 5: Compile final report
			const report = this.compileReport(research);

			// Save to file if requested
			if (params.outputFile) {
				const file = await this.saveReport(plugin, params.outputFile, report);
				
				// Add to context if in agent session
				if (context.session && file) {
					context.session.context.contextFiles.push(file);
				}
			}

			return {
				success: true,
				data: {
					topic: params.topic,
					report: report,
					searches: research.searches.length,
					sources: research.sources.size,
					sections: research.sections.length,
					outputFile: params.outputFile
				}
			};

		} catch (error) {
			return {
				success: false,
				error: `Deep research failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}

	private async generateSearchQueries(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		previousSearches: SearchResult[]
	): Promise<string[]> {
		const prompt = `Generate 3-5 specific search queries to research the topic: "${topic}"
${previousSearches.length > 0 ? `\nPrevious searches: ${previousSearches.map(s => s.query).join(', ')}` : ''}
Generate diverse queries that cover different aspects of the topic.
Return only the queries, one per line.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: 0.7 }
		});

		const text = this.extractText(result);
		return text.split('\n').filter(q => q.trim().length > 0);
	}

	private async generateFollowUpQueries(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		previousSearches: SearchResult[]
	): Promise<string[]> {
		const summaries = previousSearches.map(s => `- ${s.query}: ${s.summary}`).join('\n');
		
		const prompt = `Based on the following research on "${topic}", identify gaps and generate 2-3 follow-up search queries:

Previous research:
${summaries}

What aspects need more investigation? Generate specific search queries.
Return only the queries, one per line.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: 0.7 }
		});

		const text = this.extractText(result);
		return text.split('\n').filter(q => q.trim().length > 0);
	}

	private async performSearch(
		genAI: GoogleGenAI,
		model: string,
		query: string
	): Promise<SearchResult | null> {
		try {
			const result = await genAI.models.generateContent({
				model: model,
				config: {
					temperature: 0.7,
					tools: [{ googleSearch: {} }]
				},
				contents: `Search for: ${query}`
			});

			const text = this.extractText(result);
			const metadata = result.candidates?.[0]?.groundingMetadata;

			// Extract citations
			const citations: Citation[] = [];
			if (metadata?.groundingChunks) {
				metadata.groundingChunks.forEach((chunk: any, index: number) => {
					if (chunk.web?.uri) {
						citations.push({
							id: `${query}-${index}`,
							url: chunk.web.uri,
							title: chunk.web.title || chunk.web.uri,
							snippet: chunk.web.snippet || ''
						});
					}
				});
			}

			return {
				query: query,
				content: text,
				summary: text.substring(0, 200) + '...',
				citations: citations
			};
		} catch (error) {
			console.error(`Search failed for query "${query}":`, error);
			return null;
		}
	}

	private extractSources(searchResult: SearchResult, sources: Map<string, Source>) {
		for (const citation of searchResult.citations) {
			if (!sources.has(citation.url)) {
				sources.set(citation.url, {
					url: citation.url,
					title: citation.title,
					citations: []
				});
			}
			sources.get(citation.url)!.citations.push(citation);
		}
	}

	private async generateOutline(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		searches: SearchResult[]
	): Promise<string[]> {
		const summaries = searches.map(s => s.summary).join('\n');
		
		const prompt = `Based on the following research on "${topic}", create an outline for a comprehensive report:

Research summaries:
${summaries}

Generate 3-5 main section titles for the report.
Return only the section titles, one per line.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: 0.7 }
		});

		const text = this.extractText(result);
		return text.split('\n').filter(t => t.trim().length > 0);
	}

	private async generateSection(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		sectionTitle: string,
		searches: SearchResult[],
		sources: Map<string, Source>
	): Promise<Section> {
		// Compile relevant search content
		const relevantContent = searches
			.map(s => `Query: ${s.query}\nContent: ${s.content}\n`)
			.join('\n---\n');

		const prompt = `Write a section titled "${sectionTitle}" for a report on "${topic}".

Use the following research content:
${relevantContent}

Include inline citations using [1], [2], etc. format.
Write 2-3 paragraphs with specific details and citations.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: 0.7 }
		});

		const content = this.extractText(result);
		
		// Extract citation references from the content
		const citationRefs = new Set<string>();
		const citationPattern = /\[(\d+)\]/g;
		let match;
		while ((match = citationPattern.exec(content)) !== null) {
			citationRefs.add(match[1]);
		}

		return {
			title: sectionTitle,
			content: content,
			citations: Array.from(citationRefs)
		};
	}

	private compileReport(research: {
		topic: string;
		searches: SearchResult[];
		sources: Map<string, Source>;
		sections: Section[];
	}): string {
		let report = `# ${research.topic}\n\n`;
		report += `*Generated on ${new Date().toLocaleDateString()}*\n\n`;
		report += `---\n\n`;

		// Add sections
		for (const section of research.sections) {
			report += `## ${section.title}\n\n`;
			report += `${section.content}\n\n`;
		}

		// Add sources section
		report += `---\n\n## Sources\n\n`;
		let sourceIndex = 1;
		const sourceMap = new Map<string, number>();
		
		for (const [url, source] of research.sources) {
			sourceMap.set(url, sourceIndex);
			report += `[${sourceIndex}] ${source.title}\n`;
			report += `    ${url}\n\n`;
			sourceIndex++;
		}

		// Replace citation placeholders with actual numbers
		for (const [url, index] of sourceMap) {
			report = report.replace(new RegExp(`\\[${url}\\]`, 'g'), `[${index}]`);
		}

		return report;
	}

	private async saveReport(
		plugin: InstanceType<typeof ObsidianGemini>,
		filePath: string,
		content: string
	): Promise<TFile | null> {
		try {
			// Ensure .md extension
			if (!filePath.endsWith('.md')) {
				filePath += '.md';
			}

			// Check if file exists
			const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				// Update existing file
				await plugin.app.vault.modify(existingFile, content);
				return existingFile;
			} else {
				// Create new file
				return await plugin.app.vault.create(filePath, content);
			}
		} catch (error) {
			console.error('Failed to save report:', error);
			return null;
		}
	}

	private extractText(result: any): string {
		let text = '';
		if (result.candidates?.[0]?.content?.parts) {
			for (const part of result.candidates[0].content.parts) {
				if (part.text) {
					text += part.text;
				}
			}
		}
		return text;
	}
}

// Type definitions
interface SearchResult {
	query: string;
	content: string;
	summary: string;
	citations: Citation[];
}

interface Citation {
	id: string;
	url: string;
	title: string;
	snippet: string;
}

interface Source {
	url: string;
	title: string;
	citations: Citation[];
}

interface Section {
	title: string;
	content: string;
	citations: string[];
}

/**
 * Get Deep Research tool
 */
export function getDeepResearchTool(): Tool {
	return new DeepResearchTool();
}