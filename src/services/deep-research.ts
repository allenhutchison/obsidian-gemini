import { TFile } from 'obsidian';
import type ObsidianGemini from '../main';
import { GoogleGenAI } from '@google/genai';

// Configuration constants
const INITIAL_SEARCHES_PER_ITERATION = 2;
const FOLLOWUP_SEARCHES_PER_ITERATION = 2;
const SUMMARY_MAX_LENGTH = 200;
const MAX_SEARCH_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Grounding chunk from Google's grounding metadata
 */
interface GroundingChunk {
	web?: {
		uri: string;
		title?: string;
		snippet?: string;
	};
}

/**
 * Research result containing all data from a deep research operation
 */
export interface ResearchResult {
	topic: string;
	report: string;
	searchCount: number;
	sourceCount: number;
	sectionCount: number;
	outputFile?: TFile;
}

/**
 * Parameters for conducting deep research
 */
export interface DeepResearchParams {
	topic: string;
	depth?: number;
	outputFile?: string;
}

/**
 * Search result from a single search query
 */
interface SearchResult {
	query: string;
	content: string;
	summary: string;
	citations: Citation[];
}

/**
 * Citation from a search result
 */
interface Citation {
	id: string;
	url: string;
	title: string;
	snippet: string;
}

/**
 * Source with all its citations
 */
interface Source {
	url: string;
	title: string;
	citations: Citation[];
}

/**
 * Section of the research report
 */
interface Section {
	title: string;
	content: string;
	citations: string[];
}

/**
 * Internal research state
 */
interface ResearchState {
	topic: string;
	searches: SearchResult[];
	sources: Map<string, Source>;
	sections: Section[];
}

/**
 * Service for conducting comprehensive multi-phase research using Google Search
 * and AI synthesis. Performs iterative searches, analyzes information gaps,
 * and compiles findings into well-structured reports with citations.
 */
export class DeepResearchService {
	constructor(private plugin: InstanceType<typeof ObsidianGemini>) {}

	/**
	 * Conduct comprehensive research on a topic
	 */
	async conductResearch(params: DeepResearchParams): Promise<ResearchResult> {
		const depth = Math.min(Math.max(params.depth || 3, 1), 5); // Clamp between 1-5

		// Check if API key is available
		if (!this.plugin.settings.apiKey) {
			throw new Error('Google API key not configured');
		}

		// Initialize research state
		const research: ResearchState = {
			topic: params.topic,
			searches: [],
			sources: new Map<string, Source>(),
			sections: []
		};

		// Create AI instance
		const genAI = new GoogleGenAI({ apiKey: this.plugin.settings.apiKey });
		const modelToUse = this.plugin.settings.chatModelName || 'gemini-2.5-flash';

		// Phase 1: Initial search
		this.plugin.logger.log('DeepResearch: Starting initial searches');
		const initialQueries = await this.generateSearchQueries(genAI, modelToUse, params.topic, []);

		for (const query of initialQueries.slice(0, INITIAL_SEARCHES_PER_ITERATION)) {
			const searchResult = await this.performSearch(genAI, modelToUse, query);
			if (searchResult) {
				research.searches.push(searchResult);
				this.extractSources(searchResult, research.sources);
			}
		}

		// Phase 2: Iterative deepening
		for (let i = 1; i < depth; i++) {
			this.plugin.logger.log(`DeepResearch: Iteration ${i + 1} of ${depth}`);
			// Analyze gaps and generate follow-up queries
			const followUpQueries = await this.generateFollowUpQueries(genAI, modelToUse, params.topic, research.searches);

			for (const query of followUpQueries.slice(0, FOLLOWUP_SEARCHES_PER_ITERATION)) {
				const searchResult = await this.performSearch(genAI, modelToUse, query);
				if (searchResult) {
					research.searches.push(searchResult);
					this.extractSources(searchResult, research.sources);
				}
			}
		}

		// Phase 3: Generate report structure
		this.plugin.logger.log('DeepResearch: Generating report outline');
		const outline = await this.generateOutline(genAI, modelToUse, params.topic, research.searches);

		// Phase 4: Generate sections with citations
		this.plugin.logger.log('DeepResearch: Generating sections');
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
		this.plugin.logger.log('DeepResearch: Compiling final report');
		const report = this.compileReport(research);

		// Save to file if requested
		let outputFile: TFile | undefined;
		if (params.outputFile) {
			outputFile = await this.saveReport(params.outputFile, report) || undefined;
		}

		return {
			topic: params.topic,
			report: report,
			searchCount: research.searches.length,
			sourceCount: research.sources.size,
			sectionCount: research.sections.length,
			outputFile: outputFile
		};
	}

	/**
	 * Generate initial search queries for a topic
	 */
	private async generateSearchQueries(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		previousSearches: SearchResult[]
	): Promise<string[]> {
		const prompt = `Generate 3-5 specific search queries to research the topic: "${topic}"
${previousSearches.length > 0 ? `\nPrevious searches: ${previousSearches.map((s) => s.query).join(', ')}` : ''}
Generate diverse queries that cover different aspects of the topic.
Return only the queries, one per line.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: this.plugin.settings.temperature }
		});

		const text = this.extractText(result);
		return text.split('\n').filter((q) => q.trim().length > 0);
	}

	/**
	 * Generate follow-up queries based on previous searches
	 */
	private async generateFollowUpQueries(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		previousSearches: SearchResult[]
	): Promise<string[]> {
		const summaries = previousSearches.map((s) => `- ${s.query}: ${s.summary}`).join('\n');

		const prompt = `Based on the following research on "${topic}", identify gaps and generate 2-3 follow-up search queries:

Previous research:
${summaries}

What aspects need more investigation? Generate specific search queries.
Return only the queries, one per line.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: this.plugin.settings.temperature }
		});

		const text = this.extractText(result);
		return text.split('\n').filter((q) => q.trim().length > 0);
	}

	/**
	 * Perform a single search using Google Search with exponential backoff retry
	 */
	private async performSearch(genAI: GoogleGenAI, model: string, query: string): Promise<SearchResult | null> {
		let lastError: Error | unknown = null;

		for (let attempt = 0; attempt < MAX_SEARCH_RETRIES; attempt++) {
			try {
				const result = await genAI.models.generateContent({
					model: model,
					config: {
						temperature: this.plugin.settings.temperature,
						tools: [{ googleSearch: {} }]
					},
					contents: `Search for: ${query}`
				});

				const text = this.extractText(result);
				const metadata = result.candidates?.[0]?.groundingMetadata;

				// Extract citations
				const citations: Citation[] = [];
				if (metadata?.groundingChunks) {
					(metadata.groundingChunks as GroundingChunk[]).forEach((chunk, index) => {
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
					summary: text.substring(0, SUMMARY_MAX_LENGTH) + '...',
					citations: citations
				};
			} catch (error) {
				lastError = error;

				// Don't retry on last attempt
				if (attempt < MAX_SEARCH_RETRIES - 1) {
					const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
					this.plugin.logger.warn(
						`DeepResearch: Search attempt ${attempt + 1} failed for "${query}", retrying in ${delay}ms...`
					);
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}

		// All retries exhausted
		this.plugin.logger.error(`DeepResearch: Search failed after ${MAX_SEARCH_RETRIES} attempts for query "${query}":`, lastError);
		return null;
	}

	/**
	 * Extract sources from search results
	 */
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

	/**
	 * Generate outline for the research report
	 */
	private async generateOutline(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		searches: SearchResult[]
	): Promise<string[]> {
		const summaries = searches.map((s) => s.summary).join('\n');

		const prompt = `Based on the following research on "${topic}", create an outline for a comprehensive report:

Research summaries:
${summaries}

Generate 3-5 main section titles for the report.
Return only the section titles, one per line.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: this.plugin.settings.temperature }
		});

		const text = this.extractText(result);
		return text.split('\n').filter((t) => t.trim().length > 0);
	}

	/**
	 * Generate a single section of the report
	 */
	private async generateSection(
		genAI: GoogleGenAI,
		model: string,
		topic: string,
		sectionTitle: string,
		searches: SearchResult[],
		sources: Map<string, Source>
	): Promise<Section> {
		// Compile relevant search content
		const relevantContent = searches.map((s) => `Query: ${s.query}\nContent: ${s.content}\n`).join('\n---\n');

		const prompt = `Write a section titled "${sectionTitle}" for a report on "${topic}".

Use the following research content:
${relevantContent}

Include inline citations using [1], [2], etc. format.
Write 2-3 paragraphs with specific details and citations.`;

		const result = await genAI.models.generateContent({
			model: model,
			contents: prompt,
			config: { temperature: this.plugin.settings.temperature }
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

	/**
	 * Compile the final research report
	 */
	private compileReport(research: ResearchState): string {
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

		for (const [url, source] of research.sources) {
			report += `[${sourceIndex}] ${source.title}\n`;
			report += `    ${url}\n\n`;
			sourceIndex++;
		}

		return report;
	}

	/**
	 * Save the research report to a file
	 */
	private async saveReport(filePath: string, content: string): Promise<TFile | null> {
		try {
			// Check if file exists
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				// Update existing file
				await this.plugin.app.vault.modify(existingFile, content);
				return existingFile;
			} else {
				// Create new file
				return await this.plugin.app.vault.create(filePath, content);
			}
		} catch (error) {
			this.plugin.logger.error('DeepResearch: Failed to save report:', error);
			return null;
		}
	}

	/**
	 * Extract text from AI response
	 */
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
