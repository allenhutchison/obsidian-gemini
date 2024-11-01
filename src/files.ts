import ObsidianGemini from '../main';
import { TFile, MarkdownRenderer, Notice } from 'obsidian';

export class GeminiFile {
    private plugin: ObsidianGemini;

    constructor(plugin: ObsidianGemini) {
        this.plugin = plugin;
    }

    async getCurrentFileContent(render: boolean = true): Promise<string | null> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile instanceof TFile) { 
            try {
                const fileContent = await this.plugin.app.vault.read(activeFile);
                
                if (render) {
                    // Create a container element for the rendered markdown
                    const el = document.createElement("div");

                    // Use MarkdownRenderer to render the content with embeds
                    await MarkdownRenderer.render(
                        this.plugin.app,
                        fileContent,
                        el,
                        activeFile.path,
                        this.plugin
                    );

                    // Get the inner HTML of the container element
                    const contentWithEmbeds = el.innerHTML;
                    return contentWithEmbeds;
                } else {
                    return fileContent;
                }   
            } catch (error) {
                console.error("Error reading file:", error);
                new Notice("Error reading current file content."); 
                return null;
            }
        }
        return null;
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
}