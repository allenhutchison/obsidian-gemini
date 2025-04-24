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
		results.forEach((blockLinks) => {
			blockLinks.forEach((link) => allLinks.add(link));
		});
		return allLinks;
	}

	async evaluateDataviewQuery(query: string, file: TFile) {
		const normalizedLinks: Set<TFile> = new Set();

		try {
			const result = await this.dataViewAPI.query(query, file.path);

			// Check if result and result.value exist
			if (!result?.value) {
				console.warn(`Invalid query result for "${query}" in file "${file.path}"`);
				return normalizedLinks;
			}

			const processLink = (link: any) => {
				if (this.isFileLink(link)) {
					const normalizedPath = this.scribeFile.normalizePath(link.path, file);
					if (normalizedPath) {
						normalizedLinks.add(normalizedPath);
					} else {
						console.warn(`Link "${link}" in file "${file.path}" could not be normalized.`);
					}
				}
			};

			if (result.value.type === 'list') {
				for (const link of result.value.values) {
					processLink(link);
				}
			} else if (result.value.type === 'table') {
				for (const row of result.value.values) {
					for (const cell of row) {
						processLink(cell);
					}
				}
			}
		} catch (error) {
			console.error(`Error evaluating dataview query "${query}" in file "${file.path}":`, error);
		}

		return normalizedLinks;
	}

	/**
	 * Checks whether the given element (of type DataviewLink) represents a file link.
	 *
	 * In the plugin API, a Dataview link is typically an object with a 'path' property.
	 * If the object has a 'subpath' or if the 'path' string contains '#' or '^',
	 * we assume it’s linking to a header or block rather than the file as a whole.
	 *
	 * @param element - The element to check (expected to be a DataviewLink).
	 * @returns {boolean} True if the element is a link to a file, false otherwise.
	 */
	isFileLink(element: any): boolean {
		// Check that element is an object with a string 'path' property.
		if (element && typeof element === 'object' && typeof element.path === 'string') {
			// If a 'subpath' property exists, treat it as a header or block link.
			if (element.subpath) return false;

			// Alternatively, if the 'path' itself contains header/block markers, consider it not a plain file link.
			if (element.path.includes('#') || element.path.includes('^')) return false;

			return true;
		}
		return false;
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
