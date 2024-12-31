import { TFile } from 'obsidian';
import { getAPI } from 'obsidian-dataview';


export async function getBacklinks(file: TFile): Promise<{ link: string }[]> {
    const query = `list where contains(file.outlinks, this.file.link)`
    const dvApi = getAPI();
    const links = await dvApi.query(query, file.path);
    // console.info(JSON.stringify(links, null, 2));
    const paths = links.value.values.map((value: any) => ({ link: value.path }));
    if (links.value.values.length > 0) {
        for (const value of links.value.values) {
            console.info(value.path);
        }
    }
    return paths;
}
