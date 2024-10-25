import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile } from 'obsidian';
import { getBotResponse } from './api'; // Import API function

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private chatbox: HTMLDivElement;
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
                    const botResponse = await this.sendMessage(userMessage);
                    this.displayMessage(botResponse, "model");
                } catch (error) {
                    new Notice("Error getting bot response.");
                    console.error(error);
                }
            }
        });

        await this.loadContext();

        this.app.workspace.on('file-open', this.handleFileOpen.bind(this));
    }

    async onClose() {
    }

    displayMessage(message: string, sender: "user" | "model") {
        const newMessage = this.chatbox.createDiv({ cls: `message ${sender}` });

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? ""; // Get active file path
		MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);

        this.chatbox.scrollTop = this.chatbox.scrollHeight;
    }

    handleFileOpen(file: TFile | null) {
        this.loadContext();
    }

    async loadContext() {
        this.conversationHistory = []; // Always clear the history first
        
        const currentFileContent = await this.getCurrentFileContent();
        
        if (currentFileContent) {
            this.conversationHistory.push({ role: "user", content: "This is the content of the current file:" });
        
            this.conversationHistory.push({ role: "user", content: currentFileContent });
        }
    }

    async getCurrentFileContent(): Promise<string | null> {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile instanceof TFile) { //Check if file is a TFile
            try {
                const fileContent = await this.app.vault.read(activeFile);
                return fileContent;
            } catch (error) {
                console.error("Error reading file:", error);
                new Notice("Error reading current file content."); // Show error to user.
                return null; // Or handle the error as needed

            }
        }
        return null;
    }

    async sendMessage(userMessage: string) {
        if (userMessage.trim() !== "") {
            this.displayMessage(userMessage, "user");
            try {
                const botResponse = await getBotResponse(userMessage, this.plugin.settings.apiKey, this.conversationHistory);
                this.displayMessage(botResponse, "model");
                this.conversationHistory.push({ role: "model", content: botResponse }); //Update history
            } catch (error) {
                new Notice("Error getting bot response.");
                console.error(error);
            }
        }
    }
}