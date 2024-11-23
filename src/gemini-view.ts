import ObsidianGemini from '../main';
import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, TFile, setIcon } from 'obsidian';

export const VIEW_TYPE_GEMINI = 'gemini-view';

export class GeminiView extends ItemView {
    private plugin: ObsidianGemini;
    private chatbox: HTMLDivElement;
    private currentFile: TFile | null;
    private observer: MutationObserver;
    private shoudRewriteFile: boolean;
    private timerDisplay: HTMLDivElement;
    private timerInterval: NodeJS.Timeout | null = null;
    private startTime: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianGemini) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_GEMINI;
    }

    getDisplayText() {
        return 'Gemini Scribe';
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('h2', { text: 'Gemini Chat' });

        // The top level application
        this.chatbox = container.createDiv({ cls: 'gemini-scribe-chatbox' });

        // User input and send button
        const inputArea = container.createDiv({ cls: 'gemini-scribe-input-area' }); 
        const userInput = inputArea.createEl('textarea', { 
            cls: 'gemini-scribe-chat-input', 
            attr: { placeholder: 'Type your message here...' }
        });
        const sendContainer = inputArea.createDiv({ cls: 'gemini-scribe-send-container' });
        const sendButton = sendContainer.createEl('button', { text: 'Send', cls: 'gemini-scribe-send-button' });
        setIcon(sendButton, "send-horizontal");
        this.timerDisplay = sendContainer.createDiv({ cls: 'gemini-scribe-timer' });

        // Add checkbox container below input area
        if (this.plugin.settings.rewriteFiles) {
            const optionsArea = container.createDiv({ cls: 'gemini-scribe-options-area' });
            const rewriteCheckbox = optionsArea.createEl('input', { type: 'checkbox', cls: 'gemini-scribe-rewrite-checkbox' });
            optionsArea.createEl('label', { text: 'Rewrite file', cls: 'gemini-scribe-rewrite-label' }).prepend(rewriteCheckbox);

            rewriteCheckbox.addEventListener('change', () => {
                this.shoudRewriteFile = rewriteCheckbox.checked;
            });
        }

        userInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendButton.click();
            }
        });

        sendButton.addEventListener('click', async () => {
            const userMessage = userInput.value;
            if (userMessage.trim() !== "") {
                this.displayMessage(userMessage, "user");
                userInput.value = "";
                this.startTimer();
                
                try {
                    await this.sendMessage(userMessage);
                    this.stopTimer();
                } catch (error) {
                    this.stopTimer();
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

        this.currentFile = this.plugin.gfile.getActiveFile();
        this.app.workspace.on('file-open', this.handleFileOpen.bind(this));
    }

    async onClose() {
        this.app.workspace.off('file-open', this.handleFileOpen);
        this.observer.disconnect();
    }


    async displayMessage(message: string, sender: "user" | "model" | "grounding") {
        const newMessageContainer = this.chatbox.createDiv({ cls: `gemini-scribe-message-container ${sender}` });
        const senderIndicator = newMessageContainer.createDiv({ cls: 'gemini-scribe-sender-indicator' });
        const newMessage = newMessageContainer.createDiv({ cls: `gemini-scribe-message ${sender}` });

        // Set the icon based on the sender.
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

        // Google TOS requires that we display the search results in the plugin as teh supplied HTML.
        // This is why we don't render the search results as markdown.
        if (sender === "grounding") {
            newMessage.innerHTML = message;
        } else {
            const sourcePath = this.plugin.gfile.getActiveFile()?.path ?? "";
            await MarkdownRenderer.render(this.app, message, newMessage, sourcePath, this);
        }

        // Add a copy button to the message if it was sent by the model.
        if (sender === "model") {
            const copyButton = newMessage.createEl("button", { cls: "gemini-scribe-copy-button" });
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

        // Scroll to the bottom of the chatbox
        this.scrollToBottom();
    }

    // This will be called when a file is opened or made active in the view.
    // file can be null if it's the new file tab.
    handleFileOpen(file: TFile | null) {
        if (!file) {
            return;
        } else {
            this.currentFile = file;
            this.clearChat();
            this.reloadChatFromHistory();
        }
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
                const history = await this.plugin.history.getHistoryForFile(this.currentFile!) ?? [];
                await this.plugin.geminiApi.generateRewriteResponse(userMessage, history);
                return;
            } 
            try {
                const history = await this.plugin.history.getHistoryForFile(this.currentFile!) ?? [];
                const botResponse = await this.plugin.geminiApi.getBotResponse(userMessage, history);
                this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "user", content: userMessage });
                this.plugin.history.appendHistoryForFile(this.currentFile!, { role: "model", content: botResponse.markdown });
                this.displayMessage(botResponse.markdown, "model");
                if (botResponse.rendered) {
                    this.displayMessage(botResponse.rendered, "grounding");
                }
            } catch (error) {
                new Notice("Error getting bot response.");
                console.error(error);
            }
        }
    }

    private scrollToBottom() {
        const tryScroll = () => {
            const inputArea = this.containerEl.querySelector('.gemini-scribe-input-area');
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

    private startTimer() {
        this.timerDisplay.style.display = 'block';
        this.startTime = Date.now();
        this.timerDisplay.textContent = '0.0s';
        
        this.timerInterval = setInterval(() => {
            if (this.startTime) {
                const elapsed = (Date.now() - this.startTime) / 1000;
                this.timerDisplay.textContent = `${elapsed.toFixed(1)}s`;
            }
        }, 100);
    }

    private stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        setTimeout(() => {
            if (this.timerDisplay) {
                this.timerDisplay.style.display = 'none';
            }
        }, 2000); // Keep displayed for 2 seconds after completion
    }
}