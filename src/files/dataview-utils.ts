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
		return await this.evaluateDataviewQuery(query, file);
	}

	async getLinksFromDataviewBlocks(file: TFile): Promise<Set<TFile>> {
		const allLinks: Set<TFile> = new Set();
		const promises: Promise<Set<TFile>>[] = [];
		
		await this.iterateCodeblocksInFile(file, (cb) => {
			if (cb.language === 'dataview') {
				promises.push(this.evaluateDataviewQuery(cb.text, file));
			}
		});

		const results = await Promise.all(promises);
		results.forEach(blockLinks => {
			blockLinks.forEach(link => allLinks.add(link));
		});
		allLinks.forEach(link => console.log(link));
		return allLinks;
	}

	async evaluateDataviewQuery(query: string, file: TFile) {
		const result = await this.dataViewAPI.query(query, file.path);
		const normalizedLinks: Set<TFile> = new Set();
		console.info(result);
		console.info(result.value.type);
		if (result.value.type === 'list') {
			for (const link of result.value.values) {
				const normalizedPath = this.scribeFile.normalizePath(link.path, file);
				if (normalizedPath) {
					console.info(normalizedPath);
					normalizedLinks.add(normalizedPath);
				} else {
					console.warn(`Link "${link}" in file "${file.path}" could not be normalized.`);
				}
			}
		}
		return normalizedLinks;
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
