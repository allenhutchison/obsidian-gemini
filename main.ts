import { Plugin, WorkspaceLeaf } from 'obsidian';
import ObsidianGeminiSettingTab from './src/ui/settings';
import { GeminiView, VIEW_TYPE_GEMINI } from './src/ui/gemini-view';
import { GeminiSummary } from './src/summary';
import { GeminiApi } from './src/api';
import { ScribeFile } from './src/files';
import { GeminiHistory } from './src/history/history';
import { GeminiCompletions } from './src/completions';
import { Notice } from 'obsidian';

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
	chatHistory: boolean;
	historyFolder: string;
	showModelPicker: boolean;
	promptMode: string;
	customSystemPrompt: string;
	customCompletionPrompt: string;
	customGeneralPrompt: string;
	customSummaryPrompt: string;
	customRewritePrompt: string;
	customDatePrompt: string;
	customTimePrompt: string;
	customContextPrompt: string;
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
	chatHistory: false,
	historyFolder: 'gemini-scribe',
	showModelPicker: false,
	promptMode: 'default',
	customSystemPrompt: '',
	customCompletionPrompt: '',
	customGeneralPrompt: '',
	customSummaryPrompt: '',
	customRewritePrompt: '',
	customDatePrompt: '',
	customTimePrompt: '',
	customContextPrompt: '',
};

export default class ObsidianGemini extends Plugin {
	settings: ObsidianGeminiSettings;

	// Public members
	public geminiApi: GeminiApi;
	public gfile: ScribeFile;
	public geminiView: GeminiView;
	public history: GeminiHistory;

	// Private members
	private summarizer: GeminiSummary;
	private ribbonIcon: HTMLElement;
	private completions: GeminiCompletions;

	async onload() {
		await this.setupGeminiScribe();

		// Add ribbon icon
		this.ribbonIcon = this.addRibbonIcon('sparkles', 'Open Gemini Chat', () => {
			this.activateView();
		});

		this.registerView(VIEW_TYPE_GEMINI, (leaf) => (this.geminiView = new GeminiView(leaf, this)));

		this.addCommand({
			id: 'gemini-scribe-open-view',
			name: 'Open Gemini Chat',
			callback: () => this.activateView(),
		});

		this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
	}

	async setupGeminiScribe() {
		await this.loadSettings();
		this.geminiApi = new GeminiApi(this);
		this.gfile = new ScribeFile(this);

		// Initialize history
		// Getting the vault folder for the import and export of history has to wait for the layout
		// to be ready, otherwise it throws an error when trying to access the vault.
		this.history = new GeminiHistory(this);
		await this.history.setupHistoryCommands();
		if (this.app.workspace.layoutReady) {
			await this.history.onLayoutReady;
		}

		// Initialize completions
		this.completions = new GeminiCompletions(this);
		await this.completions.setupCompletions();
		await this.completions.setupCompletionsCommands();

		// Initialize summarization
		this.summarizer = new GeminiSummary(this);
		await this.summarizer.setupSummarizaitonCommand();
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

	async onLayoutReady() {
		await this.history.onLayoutReady();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.setupGeminiScribe();
	}

	// Optional: Clean up ribbon icon on unload
	onunload() {
		console.debug('Unloading Gemini Scribe');
		this.history?.onUnload();
		this.ribbonIcon?.remove();
	}
}
