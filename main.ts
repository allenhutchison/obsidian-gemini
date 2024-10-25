import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownRenderer, TFile } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ObsidianGeminiSettingTab from './settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './gemini-view';

interface ObsidianGeminiSettings {
    apiKey: string;
	modelName: string;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: '',
	modelName: 'gemini-1.5-flash'
};


export default class ObsidianGemini extends Plugin {
    settings: ObsidianGeminiSettings;

    async onload() {
        await this.loadSettings();
        this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => new GeminiView(leaf, this)
        );

        this.addCommand({
            id: 'open-gemini-view',
            name: 'Open Gemini Chat',
            callback: () => this.activateView()
        });

        this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_GEMINI);

        const leaf = this.app.workspace.getLeftLeaf(false)
        await leaf.setViewState({
            type: VIEW_TYPE_GEMINI,
            active: true
        });

        this.app.workspace.revealLeaf(leaf);
    }


    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}