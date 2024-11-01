import ObsidianGemini from '../main';
import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile } from 'obsidian';


export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private chatbox: HTMLDivElement;
    private conversationHistory: { role: "user" | "model", content: string }[] = [];
    private rewriteFileCheckbox: HTMLInputElement;
    private plugin: ObsidianGemini;


    constructor(leaf: WorkspaceLeaf, plugin: ObsidianGemini) {
        super(leaf);
        this.plugin = plugin
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

        // The top level application
        this.chatbox = container.createDiv({ cls: 'chatbox' });

        // User input and send button
        const inputArea = container.createDiv({ cls: 'input-area' }); // Wrap input and button
        const userInput = inputArea.createEl('input', { type: 'text', cls: 'chat-input', placeholder: 'Type your message...' });
        const sendButton = inputArea.createEl('button', { text: 'Send', cls: 'send-button' });
        
        userInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                sendButton.click();
            }
        });

        sendButton.addEventListener('click', async () => {
            const userMessage = userInput.value;
            if (userMessage.trim() !== "") {
                this.displayMessage(userMessage, "user");
                userInput.value = "";

                try {
                    await this.sendMessage(userMessage);
                } catch (error) {
                    new Notice("Error getting bot response.");
                    console.error(error);
                }
            }
        });

        await this.loadContext();
        this.app.workspace.on('file-open', this.handleFileOpen.bind(this));
        this.app.workspace.on('active-leaf-change', this.handleActiveLeafChange, this);
    }

    async onClose() {
        this.app.workspace.off('file-open', this.handleFileOpen);
        this.app.workspace.off('active-leaf-change', this.handleActiveLeafChange);
    }

    displayMessage(message: string, sender: "user" | "model") {
        const newMessage = this.chatbox.createDiv({ cls: `message ${sender}` });

		const sourcePath = this.app.workspace.getActiveFile()?.path ?? ""; // Get active file path
		MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);

        if (sender === "model") { // Only add copy button to bot messages
            const copyButton = newMessage.createEl("button", { cls: "copy-button", text: "Copy" });
    
            copyButton.addEventListener("click", () => {
                navigator.clipboard.writeText(message).then(() => { //Requires navigator.clipboard support
                    new Notice("Message copied to clipboard.");
                }).catch(err => {
                    new Notice("Could not copy message to clipboard.  Try selecting and copying manually.");
                    console.error("Failed to copy: ", err)
                });    
            });
        }

        this.chatbox.scrollTop = this.chatbox.scrollHeight;
    }

    handleFileOpen(file: TFile | null) {
        this.clearChat();
        this.loadContext();
        console.log("File opened:", file?.path);
    }

    private handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
        console.log("Leaf changed");
    }

    clearChat() {
        this.chatbox.empty();
    }

    async loadContext() {
        this.conversationHistory = []; // Always clear the history first
        
        const currentFileContent = await this.plugin.gfile.getCurrentFileContent(false);
        
        if (currentFileContent) {
            this.conversationHistory.push({ role: "user", content: "This is the content of the current file:" });
        
            this.conversationHistory.push({ role: "user", content: currentFileContent });
        }
    }

    async sendMessage(userMessage: string) {
        if (userMessage.trim() !== "") {
            try {
                const botResponse = await this.plugin.geminiApi.getBotResponse(userMessage, this.conversationHistory);
                this.conversationHistory.push({ role: "user", content: userMessage });
                this.conversationHistory.push({ role: "model", content: botResponse }); 
                this.displayMessage(botResponse, "model");  
            } catch (error) {
                new Notice("Error getting bot response.");
            }
        }
    }
}