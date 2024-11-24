import { Plugin, WorkspaceLeaf } from 'obsidian';
import ObsidianGeminiSettingTab from './src/settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './src/gemini-view';
import { GeminiSummary } from './src/summary';
import { GeminiApi } from './src/api';
import { GeminiFile } from './src/files'
import { GeminiHistory } from './src/history';
import { GeminiCompletions } from './src/completions';

interface ObsidianGeminiSettings {
    apiKey: string;
	modelName: string;
    sendContext: boolean;
    maxContextDepth: number;
    searchGrounding: boolean;
    searchGroundingThreshold: number;
    summaryFrontmatterKey: string;
    userName: string;
    systemPrompt: string;
    generalPrompt: string;
    summaryPrompt: string;
    rewritePrompt: string;
    rewriteFiles: boolean;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: '',
	modelName: 'gemini-1.5-flash-002',
    sendContext: false,
    maxContextDepth: 2,
    searchGrounding: false,
    searchGroundingThreshold: 0.7,
    summaryFrontmatterKey: 'summary',
    userName: 'User',
    rewriteFiles: false,
    systemPrompt: `
You are a note-taking and writing assistant embedded in my Obsidian note vault. Your primary goal is to help me stay organized by surfacing information from my notes and any linked notes, and to assist me in drafting and refining my writing based on this context. Assume that I am the author of all content unless specified otherwise. If a question cannot be answered from my notes, supplement your response with external information as needed.
`,
    generalPrompt: `
You are assisting me in exploring, clarifying, and discussing the content within a file labeled ‘Current File’ and any linked files. Prioritize information from these files when answering questions, providing explanations, or engaging in brainstorming.

Assume I am the author of the content unless otherwise specified. If additional context beyond the current and linked files is needed to answer a question, clearly indicate when you are drawing on general knowledge or external information.

Your responses should be plain text. Use markdown only if it aids clarity or organization in your response.
`,
    summaryPrompt: `
Using the context provided, create a single-sentence summary based on the content of the file. Exclude any mention of dates, attendees, or my name, and assume the notes are taken from my perspective unless specified otherwise. Respond with plain text only.

Please summarize the following content:

`,
    rewritePrompt: `
You are assisting me in drafting the document labeled ‘Current File’ using the context of this chat and the contents of any files linked from the Current File, which are labeled as linked files. Use this content to help draft the document.

Respond with plain text, using markdown only for formatting where needed. Your response will replace the entire content below the ‘Draft’ heading, preserving everything above it. If no ‘Draft’ heading exists, create one and start your draft below it.

Exclude any content that should not appear in the final draft, ensuring only relevant information is incorporated.
`,
};


export default class ObsidianGemini extends Plugin {
    settings: ObsidianGeminiSettings;
    public geminiApi: GeminiApi;
    private summarizer: GeminiSummary;
    public gfile: GeminiFile;
    public geminiView: GeminiView;
    public history: GeminiHistory;
    private ribbonIcon: HTMLElement;
    private completions: GeminiCompletions; // Add this

    async onload() {
        await this.loadSettings();
        this.geminiApi = new GeminiApi(this);
        this.summarizer = new GeminiSummary(this);
        this.gfile = new GeminiFile(this);
        this.history = new GeminiHistory(this);

        // Initialize completions
        this.completions = new GeminiCompletions(this);
        await this.completions.setupCompletions();
        await this.completions.setupSuggestionCommands();

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
        this.completions = new GeminiCompletions(this);
    }

    // Optional: Clean up ribbon icon on unload
    onunload() {
        this.ribbonIcon?.remove();
    }
}