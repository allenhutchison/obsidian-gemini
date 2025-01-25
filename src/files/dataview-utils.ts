import { getAPI, DataviewApi } from 'obsidian-dataview';
import { MarkdownRenderer, TFile } from 'obsidian';
import { ScribeFile } from '.';
import ObsidianGemini from '../../main';

export class ScribeDataView {
	private scribeFile: ScribeFile;
	private dataViewAPI: DataviewApi;
	private plugin: ObsidianGemini;

	constructor(scribeFile: ScribeFile, plugin: ObsidianGemini) {
		this.scribeFile = scribeFile;
		this.dataViewAPI = this.getDataViewAPI();
		this.plugin = plugin;
	}

	getDataViewAPI() {
		const dataViewAPI = getAPI();
		if (!dataViewAPI) {
			return null;
		} else {
			return dataViewAPI;
		}
	}

	async getBacklinks(file: TFile): Promise<Set<TFile>> {
		const query = `list where contains(file.outlinks, this.file.link)`;
		const links = await this.dataViewAPI.query(query, file.path);
		return this.parseDataViewListForLinksToFiles(links, file);
	}

	parseDataViewListForLinksToFiles(queryResults: any, file: TFile): Set<TFile> {
		const normalizedLinks: Set<TFile> = new Set();
		if (queryResults.value.type === 'list') {
			for (const link of queryResults.value.values) {
				const normalizedPath = this.scribeFile.normalizePath(link.path, file);
				if (normalizedPath) {
					normalizedLinks.add(normalizedPath);
				} else {
					console.warn(`Link "${link}" in file "${file.path}" could not be normalized.`);
				}
			}
		}
		return normalizedLinks;
	}

	async getLinksFromDataviewBlocks(file: TFile): Promise<{ link: string }[]> {
		this.iterateCodeblocksInFile(file, (cb) => {
			if (cb.language === 'dataview') {
				// Process the Dataview query here
				console.info('DATA VIEW BLOCK FOUND');
				console.info(cb.text);
				this.evaluateDataviewQuery(cb.text, file);
			}
		});

		return [];
	}

	async getLinksFromBlock(block: string): Promise<{ link: string }[]> {
		const result = await this.dataViewAPI.evaluate(block);
		console.info(result);
		return [];
	}

	async evaluateDataviewQuery(query: string, file: TFile) {
		try {
			const result = await this.dataViewAPI.query(query, file.path);
			console.info(result);
			console.info(result.value.type);
			if (result.value.type === 'list') {
				console.info('Found a list');
                result.value.values.forEach((value: string) => {
                    // Assuming the list contains file names
                    if (typeof value === 'string') {
                        // Create an Obsidian link for the file
                        const linkText: string = `[[${value}]]`;
                        MarkdownRenderer.render(this.plugin.app, linkText, document.createElement('div'), file.path, this.plugin);
                        console.info(linkText);
                    }
                });
			}
		} catch (error) {
			// Handle errors
			console.error('Error evaluating Dataview query:', error);
		}
	}

	async iterateCodeblocksInFile(
		file: TFile,
		callback: (cb: { start: number; end: number; text: string; language: string }) => void
	) {
		const fileContent = await this.plugin.app.vault.read(file);
		const lines = fileContent.split('\n');

		let codeblock: { start: number; end: number; text: string; language: string } | null = null;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.startsWith('```')) {
				if (codeblock) {
					// End of previous codeblock
					callback(codeblock);
					codeblock = null;
				} else {
					// Start of new codeblock
					const language = line.substring(3).trim(); // Extract language
					codeblock = {
						start: i,
						end: -1, // Will be updated when the codeblock ends
						text: '',
						language,
					};
				}
			} else if (codeblock) {
				codeblock.text += line + '\n';
			}
		}

		// If the last codeblock wasn't closed, process it
		if (codeblock) {
			codeblock.end = lines.length - 1;
			callback(codeblock);
		}
	}
}
