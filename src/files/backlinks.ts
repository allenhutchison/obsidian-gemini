import { TFile } from 'obsidian';
import { getDataViewAPI } from './dataview-utils';

export async function getBacklinks(file: TFile): Promise<{ link: string }[]> {
	const query = `list where contains(file.outlinks, this.file.link)`;
	const dvApi = getDataViewAPI();
	if (!dvApi) {
		return [];
	}
	const links = await dvApi.query(query, file.path);
	// console.info(JSON.stringify(links, null, 2));
	const paths = links.value.values.map((value: any) => ({ link: value.path }));
	return paths;
}
