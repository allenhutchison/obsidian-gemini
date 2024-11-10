import ObsidianGemini from '../main';
import { FileContextTree } from './file-context';
import { TFile } from 'obsidian';

export class GeminiFile {
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }

    async getCurrentFileContent(depth: number = this.plugin.settings.maxContextDepth): Promise<string | null> {
        const activeFile = this.getActiveFile();
        if (activeFile) {
            const fileContext = new FileContextTree(this.plugin, depth);
            await fileContext.initialize(activeFile);
            return fileContext.toString();
        } else {
            return null;
        }
    }

    async addToFrontMatter(key: string, value: string) {
        const activeFile = this.getActiveFile();
        if (activeFile) {
            // Use processFrontMatter to add or update the summary in the frontmatter
            this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                frontmatter[key] = value;
            });
        }
    }

    async replaceTextInActiveFile(newText: string) {
        const activeFile = this.getActiveFile();
        const vault = this.plugin.app.vault;

        if (activeFile) {
            vault.modify(activeFile, newText);
        }
    }

    getActiveFile(): TFile | null {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (this.isFile(activeFile)) {
            console.debug("Active file:", activeFile);
            return activeFile;
        } else {
            console.debug("No active file found.");
            return null;
        }
    }

    isFile(file: TFile | null): boolean {
          if (file && file instanceof TFile) {
            return true;
        } else {
            return false;
        }
    }
}
