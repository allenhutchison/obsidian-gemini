import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Remember to rename these classes and interfaces!

interface ObsidianGeminiSettings {
	apiKey: string;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: '' // Don't include a default API key here for security
};

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private chatbox: HTMLDivElement;
    private gemini: GoogleGenerativeAI | null = null; // Store the Gemini instance

    constructor(leaf: WorkspaceLeaf, private plugin: ObsidianGemini) { // Pass the plugin instance
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_GEMINI;
    }

    getDisplayText() {
        return 'Gemini Chat';
    }

    async onOpen() {
        const container = this.containerEl.children[1];  // Access correct container
        container.empty();
        container.createEl('h2', { text: 'Gemini Chat' });

        this.chatbox = container.createDiv({ cls: 'chatbox' });
        const userInput = container.createEl('input', { type: 'text', placeholder: 'Type your message...' });
        const sendButton = container.createEl('button', { text: 'Send' });

        sendButton.addEventListener('click', async () => {
            const userMessage = userInput.value;
            if (userMessage.trim() !== "") {
                this.displayMessage(userMessage, "user");
                userInput.value = "";

                try {
                    const botResponse = await this.getBotResponse(userMessage);
                    this.displayMessage(botResponse, "bot");
                } catch (error) {
                    new Notice("Error getting bot response.");
                    console.error(error);
                }
            }
        });

        // Initialize Gemini when the view opens (or when API key is set)
        this.initializeGemini();
    }

    private initializeGemini() {
        if (this.plugin.settings.apiKey && !this.gemini) {
			this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
		}
	}


	displayMessage(message: string, sender: "user" | "bot") {
        const newMessage = this.chatbox.createDiv({ cls: `message ${sender}` });

        if (sender === "bot") {  // Render if bot message
            newMessage.innerHTML = message; // Set as innerHTML since it is already rendered
          } else {
            newMessage.setText(message); // Use setText for user messages
          }

        this.chatbox.scrollTop = this.chatbox.scrollHeight;
    }

    async getBotResponse(userMessage: string): Promise<string> {
        if (!this.gemini) {
            throw new Error("Gemini not initialized. Please set your API key.");
        }
		const model = this.gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(userMessage);

        const markdownResponse = result.response.text(); // Get Markdown response
		console.log(markdownResponse);

		
        // Render Markdown
        const renderedHTML = await MarkdownRenderer.render(
			this.app,
            markdownResponse,
            this.chatbox, // provide the container element
            this.leaf.id, // source for links
            this
        );

        return renderedHTML;
    }

    async onClose() {
        // Nothing to clean up.
    }
}

export default class ObsidianGemini extends Plugin {
	settings: ObsidianGeminiSettings;

	async onload() {
		await this.loadSettings();
		this.registerView(
            VIEW_TYPE_GEMINI,
            (leaf) => new GeminiView(leaf, this) // Pass plugin instance to view
        );

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('bot', 'Activeate View', () => {
			// Called when the user clicks the icon.
			//const prompt = "Why is the sky blue?";
			//this.chatWithGemini(prompt);
			//new Notice('this is a notice');
			this.activateView();
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObsidianGeminiSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

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
		  leaf = workspace.getRightLeaf(false);
		  await leaf.setViewState({ type: VIEW_TYPE_GEMINI, active: true });
		}
	
		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	  }

	async chatWithGemini(prompt: string) {
		const genAI = new GoogleGenerativeAI(this.settings.apiKey);
		const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
		const result = await model.generateContent(prompt);
		console.log(result.response.text());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class ObsidianGeminiSettingTab extends PluginSettingTab {
	plugin: ObsidianGemini;

	constructor(app: App, plugin: ObsidianGemini) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Gemini API Key')
			.addText(text => text
				.setPlaceholder('Enter your API Key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));
	}
}
