import { getAPI } from 'obsidian-dataview';

export function getDataViewAPI() {
    const dataViewAPI = getAPI();
    if (!dataViewAPI) {
        return null;
    } else {
        return dataViewAPI;
    }
}