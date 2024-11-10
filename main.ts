import { Plugin, WorkspaceLeaf } from 'obsidian';
import ObsidianGeminiSettingTab from './src/settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './src/gemini-view';
import { GeminiSummary } from './src/summary';
import { GeminiApi } from './src/api';
import { GeminiFile } from './src/files'
import { GeminiHistory } from './src/history';

interface ObsidianGeminiSettings {
    apiKey: string;
	modelName: string;
    summaryFrontmatterKey: string;
    userName: string;
    maxContextDepth: number;
    systemPrompt: string;
    summaryPrompt: string;
    rewritePrompt: string;
    rewriteFiles: boolean;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: '',
	modelName: 'gemini-1.5-flash-002',
    summaryFrontmatterKey: 'summary',
    userName: 'User',
    maxContextDepth: 2,
    rewriteFiles: false,
    systemPrompt: `
You are a note taking and writing assistant. 

Your goal is to help me stay organized, to surface information from my notes, and to help me write.

You can assume that I am the author for all of my notes, unless otherwise specified in the note.
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

The user is working on a document labeled Current File, and you have access to the contents of other files liked from the current file, which are labeled as linked files. You can use this content to assist in writing the document.

Your response will replace the entire contents of the current file. However, you should maintain the content above the Draft heading. If there is no Draft heading you should add one, and write your draft after that heading. 

You should only replace  after the Draft heading, and mainatin everything else.

Your response should leave out any text that shouldn't be part of the final draft.
    `,
};


export default class ObsidianGemini extends Plugin {
    settings: ObsidianGeminiSettings;
    public geminiApi: GeminiApi;
    private summarizer: GeminiSummary;
    public gfile: GeminiFile;
    public geminiView: GeminiView;
    public history: GeminiHistory;


    async onload() {
        await this.loadSettings();
        this.geminiApi = new GeminiApi(this);
        this.summarizer = new GeminiSummary(this);
        this.gfile = new GeminiFile(this);
        this.history = new GeminiHistory(this);

        this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => this.geminiView = new GeminiView(leaf, this)
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
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_GEMINI);
    
        if (leaves.length > 0) {
            // A leaf with our view already exists, use that
            leaf = leaves[0];
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            leaf = workspace.getLeftLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_GEMINI, active: true });
                // "Reveal" the leaf in case it is in a collapsed sidebar
                workspace.revealLeaf(leaf);
            } else {
                console.error('Could not find a leaf to open the view');
            }
        }
    }


    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.geminiApi = new GeminiApi(this);
        this.summarizer = new GeminiSummary(this);
        this.gfile = new GeminiFile(this);
        this.history = new GeminiHistory(this);
    }
}