import ObsidianGemini from '../main';
import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile, setIcon } from 'obsidian';

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private plugin: ObsidianGemini;
    private chatbox: HTMLDivElement;
    private currentFile: TFile | null;
    private observer: MutationObserver;
    private shoudRewriteFile: boolean;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianGemini) {
        super(leaf);
        this.plugin = plugin;
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

        // Add checkbox container below input area
        if (this.plugin.settings.rewriteFiles) {
            const optionsArea = container.createDiv({ cls: 'options-area' });
            const rewriteCheckbox = optionsArea.createEl('input', { type: 'checkbox', cls: 'rewrite-checkbox' });
            optionsArea.createEl('label', { text: 'Rewrite file', cls: 'rewrite-label' }).prepend(rewriteCheckbox);

            rewriteCheckbox.addEventListener('change', () => {
                this.shoudRewriteFile = rewriteCheckbox.checked;
            });
        }

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

        // Observe changes in the chatbox
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    this.scrollToBottom();
                }
            }
        });
        this.observer.observe(this.chatbox, { 
            childList: true, 
            subtree: true 
        });

        this.currentFile = this.app.workspace.getActiveFile();
        this.app.workspace.on('file-open', this.handleFileOpen.bind(this));
    }

    async onClose() {
        this.app.workspace.off('file-open', this.handleFileOpen);
    }

    async displayMessage(message: string, sender: "user" | "model" | "grounding") {
        const newMessageContainer = this.chatbox.createDiv({ cls: `message-container ${sender}` });
        const senderIndicator = newMessageContainer.createDiv({ cls: 'sender-indicator', text: sender === "user" ? "User" : "Bot" });
        const newMessage = newMessageContainer.createDiv({ cls: `message ${sender}` });

        switch (sender) {
            case "user":
                setIcon(senderIndicator, "square-user");
                break;
            case "model":
                setIcon(senderIndicator, "bot-message-square");
                break;
            case "grounding":
                setIcon(senderIndicator, "search");
                break;
        }

        const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
        if (sender === "grounding") {
            newMessage.innerHTML = message;
        } else {
            await MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);
        }
        this.scrollToBottom();

        if (sender === "model") {
            const copyButton = newMessage.createEl("button", { cls: "copy-button" });
            setIcon(copyButton, "copy");
            
            copyButton.addEventListener("click", () => {
                navigator.clipboard.writeText(message).then(() => {
                    new Notice("Message copied to clipboard.");
                }).catch(err => {
                    new Notice("Could not copy message to clipboard. Try selecting and copying manually.");
                    console.error("Failed to copy: ", err);
                });
            });
        }
    }

    // This will be called when a file is opened or made active in the view.
    handleFileOpen(file: TFile | null) {
        this.currentFile = file;
        this.clearChat();
        this.reloadChatFromHistory();
    }

    clearChat() {
        this.chatbox.empty();
    }

    async reloadChatFromHistory() {
        const history = await this.plugin.history.getHistoryForFile(this.currentFile!);
        if (history) {
            history.forEach(entry => {
                this.displayMessage(entry.content, entry.role);
            });
        }
    }

    async sendMessage(userMessage: string) {
        if (userMessage.trim() !== "") {
            if (this.shoudRewriteFile) {
                await this.plugin.geminiApi.generateRewriteResponse(userMessage,
                    await this.plugin.history.getHistoryForFile(this.currentFile!));
                return;
            } else if (this.plugin.settings.searchGrounding) {
                try {
                    const groundingResponse = await this.plugin.geminiApi.generateGroundedResponse(userMessage, 
                        await this.plugin.history.getHistoryForFile(this.currentFile!));
                    this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "user", content: userMessage });
                    this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "model", content: groundingResponse.markdown });
                    this.displayMessage(groundingResponse.markdown, "model")
                    this.displayMessage(groundingResponse.rendered, "grounding");
                    return;
                } catch (error) {
                    new Notice("Error getting grounding response.");
                    console.error(error);
                }
            }

            try {
                const botResponse = await this.plugin.geminiApi.getBotResponse(
                    userMessage, await this.plugin.history.getHistoryForFile(this.currentFile!));
                this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "user", content: userMessage });
                this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "model", content: botResponse });
                this.displayMessage(botResponse, "model");
            } catch (error) {
                new Notice("Error getting bot response.");
                console.error(error);
            }
        }
    }

    private scrollToBottom() {
        const tryScroll = () => {
            const inputArea = this.containerEl.querySelector('.input-area');
            if (inputArea) {
                inputArea.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'end',
                    inline: 'nearest'
                });
            }
        };

        // Multiple scroll attempts with increasing delays
        tryScroll();
        setTimeout(tryScroll, 50);
        setTimeout(tryScroll, 150);
    }
}