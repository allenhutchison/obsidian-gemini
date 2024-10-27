import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownRenderer, TFile } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ObsidianGeminiSettingTab from './settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './gemini-view';
import { GeminiSummary } from './summary';
import { GeminiApi } from './api';

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
    private summarizer: GeminiSummary;
    private geminiApi: GeminiApi;

    async onload() {
        await this.loadSettings();
        this.geminiApi = new GeminiApi(this.settings.apiKey);
        this.summarizer = new GeminiSummary(this.app, this.geminiApi);

        this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => new GeminiView(leaf, this)
        );

        this.addCommand({
            id: 'open-gemini-view',
            name: 'Open Gemini Chat',
            callback: () => this.activateView()
        });

        this.addCommand({
            id: 'summarize-active-file',
            name: 'Summarize Active File',
            callback: () => this.summarizer.summarizeActiveFile()
        });

        this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_GEMINI);

        const leaf = this.app.workspace.getLeftLeaf(false)
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_GEMINI,
                active: true
            });
            this.app.workspace.revealLeaf(leaf);
        } else {
            console.error("Could not find a suitable leaf to attach the view.");
        }
    }


    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}