import ObsidianGemini from '../main';
import { FileContextTree } from './file-context';
import { TFile, MarkdownRenderer, Notice, Editor, MarkdownView } from 'obsidian';

export class GeminiFile {
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }

    // TODO(adh): Add a depth parameter from settings, rather than this hard-coded value
    async getCurrentFileContent(depth: number = 2): Promise<string | null> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            return null;
        } else {
            const fileContext = new FileContextTree(this.plugin, depth);
            await fileContext.initialize(activeFile);
            return fileContext.toString();
        }
    }

    async addToFrontMatter(key: string, value: string) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile instanceof TFile) {
            // Use processFrontMatter to add or update the summary in the frontmatter
            this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
                frontmatter[key] = value;
            });
        }
    }

    async replaceTextInActiveFile(newText: string) {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        const vault = this.plugin.app.vault;

        if (activeFile) {
            vault.modify(activeFile, newText);
        }
    }
}
