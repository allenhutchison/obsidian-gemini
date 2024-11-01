import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownRenderer, TFile } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ObsidianGeminiSettingTab from './settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './gemini-view';
import { GeminiSummary } from './summary';
import { GeminiApi } from './api';
import { GeminiFile } from './src/files'

interface ObsidianGeminiSettings {
    apiKey: string;
	modelName: string;
    summaryFrontmatterKey: string;
    userName: string;
    systemPrompt: string;
    summaryPrompt: string;
    rewritePrompt: string;
    rewriteFiles: boolean;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: '',
	modelName: 'gemini-1.5-flash',
    summaryFrontmatterKey: 'summary',
    userName: 'User',
    rewriteFiles: false,
    systemPrompt: `
        You are a note taking assistant. 
        Your goal is to help me stay organized and to surface information from my notes. 
        You can assume that I am the author for all of my notes.
    `,
    summaryPrompt: `
        You use the context provided by the user to create useful single line summaries. 
        You only respond with a single sentence that is based on the content provided by the user. 
        You do not need to refer to the date or the attendees of a meeting. 
        If not otherwise specificed assume I am the subject of the notes. 
        You only respond with plain text. 

        Please summarize the following content:
    `,
    rewritePrompt: `
        You use the context of this chat to help the user write documents. 
        Your response will replace the contents of the current document, so leave out any text that shouldn't be part of the final file. 
        You only respond with markdown formatted text.
    `,
};


export default class ObsidianGemini extends Plugin {
    settings: ObsidianGeminiSettings;
    public geminiApi: GeminiApi;
    private summarizer: GeminiSummary;
    public gfile: GeminiFile;
    public geminiView: GeminiView;


    async onload() {
        await this.loadSettings();
        this.geminiApi = new GeminiApi(this);
        this.summarizer = new GeminiSummary(this);
        this.gfile = new GeminiFile(this);

        this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => {
                this.geminiView = new GeminiView(leaf, this);
                return this.geminiView;
            }
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