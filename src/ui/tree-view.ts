import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer } from 'obsidian';
import ObsidianGemini from '../../main';
import { FileContextTree } from '../files/file-context';

export const VIEW_TYPE_TREE = 'gemini-tree-view';

export class TreeView extends ItemView {
    private plugin: ObsidianGemini;
    private treeData: any = null;
    private fileOpenHandler: (file: TFile | null) => Promise<void>;

    constructor(leaf: WorkspaceLeaf, plugin: ObsidianGemini) {
        super(leaf);
        this.plugin = plugin;
        // Bind the handler to preserve 'this' context
        this.fileOpenHandler = this.handleFileOpen.bind(this);
    }

    getViewType(): string {
        return VIEW_TYPE_TREE;
    }

    getDisplayText(): string {
        return 'Gemini Context Tree';
    }

    getIcon(): string {
        return 'network';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('gemini-tree-view');

        // Add title section
        const titleSection = container.createEl('div', { cls: 'gemini-tree-title' });
        titleSection.createEl('div', { 
            cls: 'gemini-tree-title-text',
            text: 'Context Hierarchy'
        });
        titleSection.createEl('div', { 
            cls: 'gemini-tree-subtitle',
            text: 'Links and connections from the current note'
        });

        // Register the file-open handler
        this.registerEvent(
            this.app.workspace.on('file-open', async (file) => {
                await this.handleFileOpen(file);
            })
        );

        // Handle the currently active file
        const activeFile = this.plugin.gfile.getActiveFile();
        if (activeFile) {
            await this.handleFileOpen(activeFile);
        } else {
            container.createEl('div', { text: 'No file open. Open a file to see its context tree.' });
        }
    }

    async onClose(): Promise<void> {
        // Cleanup if needed
    }

    private async handleFileOpen(file: TFile | null) {
        if (!file) {
            const container = this.containerEl.children[1];
            container.empty();
            container.createEl('div', { text: 'No file open. Open a file to see its context tree.' });
            return;
        }

        const fileContext = new FileContextTree(this.plugin);
        await fileContext.initialize(file, false);
        const treeData = fileContext.getVisualizationData();
        this.setTreeData(treeData);
    }

    setTreeData(treeData: any): void {
        this.treeData = treeData;
        if (this.containerEl.children[1]) {
            const container = this.containerEl.children[1];
            container.empty();

            // Re-add title section
            const titleSection = container.createEl('div', { cls: 'gemini-tree-title' });
            titleSection.createEl('div', { 
                cls: 'gemini-tree-title-text',
                text: 'Context Hierarchy'
            });
            titleSection.createEl('div', { 
                cls: 'gemini-tree-subtitle',
                text: 'Links and connections from the current note'
            });

            // Add tree content
            if (treeData) {
                this.renderTree(container, treeData);
            } else {
                container.createEl('div', { text: 'No file open. Open a file to see its context tree.' });
            }
        }
    }

    private async renderTree(container: Element, node: any): Promise<void> {
        const nodeEl = container.createEl('div', { cls: 'gemini-tree-node' });
        
        // Create node header
        const header = nodeEl.createEl('div', { cls: 'gemini-tree-node-header' });
        const content = header.createEl('div', { cls: 'gemini-tree-node-content' });
        
        // Render the markdown link
        await MarkdownRenderer.render(
            this.app,
            node.name,
            content,
            node.path,
            this.plugin
        );

        // Add click handler for internal links
        content.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('internal-link')) {
                event.preventDefault();
                const linkText = target.getAttribute('data-href');
                if (linkText) {
                    this.app.workspace.openLinkText(linkText, '', true);
                }
            }
        });

        // Render children if any
        if (node.children && node.children.length > 0) {
            const childrenContainer = nodeEl.createEl('div', { cls: 'gemini-tree-children' });
            for (const child of node.children) {
                await this.renderTree(childrenContainer, child);
            }
        }
    }
} 