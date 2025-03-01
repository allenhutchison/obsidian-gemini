export default class ObsidianGemini extends Plugin {
    async onload() {
        // Register the file rename event handler
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFile) {
                    this.markdownHistory.renameHistoryFile(file, oldPath);
                }
            })
        );

        // Register the file delete event handler
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile) {
                    this.markdownHistory.deleteHistoryFile(file.path);
                }
            })
        );
    }
} 