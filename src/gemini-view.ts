import ObsidianGemini from '../main';
import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile, setIcon } from 'obsidian';


export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private plugin: ObsidianGemini;
    private chatbox: HTMLDivElement;
    private currentFile: TFile | null;

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
        setIcon(sendButton, "send-horizontal");
        
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
        this.currentFile = this.app.workspace.getActiveFile();
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
                    new Notice("Could not copy message to clipboard.  Try selecting and copying manuall");
                    console.error("Failed to copy: ", err)
                });    
            });
            setIcon(copyButton, "copy");
        }

        this.chatbox.scrollTop = this.chatbox.scrollHeight;
    }

    // This will be called when a file is opened or made active in the view.
    handleFileOpen(file: TFile | null) {
        this.currentFile = file;
        this.clearChat();
        this.reloadChatFromHistory();
    }

    private handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
        console.log("Leaf changed");
    }

    clearChat() {
        this.chatbox.empty();
    }

    async reloadChatFromHistory() {
        const history = await this.plugin.history.getHistoryForFile(this.currentFile!);
        // The first two elements of the history array are always the file contents and related prompts.
        // Skip those for display purposes.
        if (history) {
            history.slice(2).forEach(entry => {
                this.displayMessage(entry.content, entry.role);
            });
        }
    }

    async sendMessage(userMessage: string) {
        if (userMessage.trim() !== "") {
            try {
                const botResponse = await this.plugin.geminiApi.getBotResponse(
                    userMessage, await this.plugin.history.getHistoryForFile(this.currentFile!));
                this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "user", content: userMessage });
                this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "model", content: botResponse });
                this.displayMessage(botResponse, "model");  
            } catch (error) {
                new Notice("Error getting bot response.");
            }
        }
    }
}