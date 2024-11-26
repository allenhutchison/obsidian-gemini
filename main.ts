import { Plugin, WorkspaceLeaf } from 'obsidian';
import ObsidianGeminiSettingTab from './src/settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './src/gemini-view';
import { GeminiSummary } from './src/summary';
import { GeminiApi } from './src/api';
import { GeminiFile } from './src/files'
import { GeminiHistory } from './src/history';
import { GeminiCompletions } from './src/completions';
import { GeminiDatabase } from './src/database';

export interface ObsidianGeminiSettings {
    apiKey: string;
	chatModelName: string;
    summaryModelName: string;
    completionsModelName: string;
    sendContext: boolean;
    maxContextDepth: number;
    searchGrounding: boolean;
    searchGroundingThreshold: number;
    summaryFrontmatterKey: string;
    userName: string;
    rewriteFiles: boolean;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: '',
	chatModelName: 'gemini-1.5-pro',
    summaryModelName: 'gemini-1.5-flash',
    completionsModelName: 'gemini-1.5-flash-8b',
    sendContext: false,
    maxContextDepth: 2,
    searchGrounding: false,
    searchGroundingThreshold: 0.7,
    summaryFrontmatterKey: 'summary',
    userName: 'User',
    rewriteFiles: false,
};


export default class ObsidianGemini extends Plugin {
    settings: ObsidianGeminiSettings;

    // Public members
    public geminiApi: GeminiApi;
    public gfile: GeminiFile;
    public geminiView: GeminiView;
    public history: GeminiHistory;
    public database: GeminiDatabase;

    // Private members
    private summarizer: GeminiSummary;
    private ribbonIcon: HTMLElement;
    private completions: GeminiCompletions;

    async onload() {
        await this.loadSettings();
        this.geminiApi = new GeminiApi(this);
        this.gfile = new GeminiFile(this);
        this.history = new GeminiHistory(this);

        // Initialize completions
        this.completions = new GeminiCompletions(this);
        await this.completions.setupCompletions();
        await this.completions.setupCompletionsCommands();

        // Initialize summarization
        this.summarizer = new GeminiSummary(this);
        await this.summarizer.setupSummarizaitonCommand();

        // Initialize database
        this.database = new GeminiDatabase();


        // Add ribbon icon
        this.ribbonIcon = this.addRibbonIcon(
            'sparkles', 
            'Open Gemini Chat',
            () => {
                this.activateView();
            }
        );

        this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => this.geminiView = new GeminiView(leaf, this)
        );

        this.addCommand({
            id: 'gemini-scribe-open-view',
            name: 'Open Gemini Chat',
            callback: () => this.activateView()
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
            await workspace.revealLeaf(leaf);
        } else {
            // Our view could not be found in the workspace, create a new leaf
            // in the right sidebar for it
            leaf = workspace.getLeftLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_GEMINI, active: true });
                // "Reveal" the leaf in case it is in a collapsed sidebar
                await workspace.revealLeaf(leaf);
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
        this.completions = new GeminiCompletions(this);
    }

    // Optional: Clean up ribbon icon on unload
    onunload() {
        this.ribbonIcon?.remove();
    }
}