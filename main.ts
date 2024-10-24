import { App, ItemView, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ObsidianGeminiSettings {
    apiKey: string;
}

const DEFAULT_SETTINGS: ObsidianGeminiSettings = {
    apiKey: ''
};

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private chatbox: HTMLDivElement;
    private gemini: GoogleGenerativeAI | null = null;
    private conversationHistory: { role: "user" | "model", content: string }[] = [];	

    constructor(leaf: WorkspaceLeaf, private plugin: ObsidianGemini) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_GEMINI;
    }

    getDisplayText() {
        return 'Gemini Chat';
    }

    async onOpen() {
		// Example starting message (optional) – adapt as needed
		//this.displayMessage("Hi! How can I assist you today?", "bot");
		this.conversationHistory.push({ role: "model", content: "Hi! How can I assist you today?" });

		const container = this.containerEl.children[1];
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

        this.initializeGemini();
    }

    private initializeGemini() {
        if (this.plugin.settings.apiKey && !this.gemini) {
            this.gemini = new GoogleGenerativeAI(this.plugin.settings.apiKey);
        }
    }

    displayMessage(message: string, sender: "user" | "bot") {
        const newMessage = this.chatbox.createDiv({ cls: `message ${sender}` });

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? ""; // Get active file path
		MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);

        this.chatbox.scrollTop = this.chatbox.scrollHeight;
    }

    async getBotResponse(userMessage: string): Promise<string> {
        if (!this.gemini) {
            throw new Error("Gemini not initialized. Please set your API key.");
        }

        // Add user message to history
        this.conversationHistory.push({ role: "user", content: userMessage });		

        const model = this.gemini.getGenerativeModel({ model: "gemini-1.5-flash" });

        const result = await model.generateContent(userMessage);
        let markdownResponse = result.response.text();
		try {
			// Build the contents array using conversation history
			const contents = this.buildContents(userMessage);
	
			const result = await model.generateContent({contents});
			const markdownResponse = result.response.text();
			console.log("Raw Response:", JSON.stringify(markdownResponse));
	
			// Add bot response to history (after successful call)
			this.conversationHistory.push({ role: "model", content: markdownResponse });

			return markdownResponse;
		} catch (error) {
        	console.error("Error calling Gemini:", error);
        	return "There was an error processing your request."; //Return a simple message
		}
	}		

    async onClose() {
        // Clean up if needed
    }

	buildContents(userMessage: string): any[] { // Use any[] to accommodate different part types
		const contents = [];
	
		// Add conversation history to contents
		for (const turn of this.conversationHistory) {
			contents.push({
				role: turn.role,
				parts: [{ text: turn.content }] // Add text parts
			});
		}
		// Add current user message
		contents.push({
			role: "user",
			parts: [{ text: userMessage }]
		});
		return contents;
	}
}	


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

        const leaf = this.app.workspace.getRightLeaf(false);
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


class ObsidianGeminiSettingTab extends PluginSettingTab {
    plugin: ObsidianGemini;

    constructor(app: App, plugin: ObsidianGemini) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Gemini API Key')
            .addText(text => text
                .setPlaceholder('Enter your API Key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    console.log("Key changed");
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));
    }
}