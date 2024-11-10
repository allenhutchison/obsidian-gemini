import ObsidianGemini from '../main';
import { FileContextTree } from './file-context';
import { TFile, MarkdownRenderer, Notice, Editor } from 'obsidian';

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

    // Replace the content under a heading with new text
    // This is used in the rewrite workflow to update the content of a working 
    // section in the active file.
    async replaceTextUnderHeading(editor: Editor, heading: string, newText: string) {
        // Get the full content of the active editor
        const content = editor.getValue();

        // Create a regex pattern to find the heading and capture the content under it until the next heading
        const regex = new RegExp(`(${heading}\\n)([\\s\\S]*?)(?=\\n#{1,}|$)`, 'm');

        // Check if the heading exists in the content
        if (regex.test(content)) {
            // Replace the content under the heading with new text
            const updatedContent = content.replace(regex, `$1${newText}\n`);
            editor.setValue(updatedContent);
        } else {
            // If the heading does not exist, append the heading and new text at the end of the file
            const appendedContent = `${content}\n\n${heading}\n${newText}\n`;
            editor.setValue(appendedContent);
        }
    }
}