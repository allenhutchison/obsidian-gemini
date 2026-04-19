import { Tool, ToolResult, ToolExecutionContext } from '../types';
import { ToolCategory } from '../../types/agent';
import { ToolClassification } from '../../types/tool-policy';
import { MarkdownView } from 'obsidian';
import type ObsidianGemini from '../../main';
import { shouldExcludePathForPlugin as shouldExcludePath } from '../../utils/file-utils';

/** Maximum characters of selected text to include in workspace state */
const MAX_SELECTION_LENGTH = 1000;

/**
 * Get the current workspace state: all open files, visibility, selections, and project info.
 * Replaces get_active_file with a richer view of the user's workspace.
 */
export class GetWorkspaceStateTool implements Tool {
	name = 'get_workspace_state';
	displayName = 'Get Workspace State';
	category = ToolCategory.READ_ONLY;
	classification = ToolClassification.READ;
	description =
		"Returns metadata for files currently open in Obsidian: each file's path, wikilink, whether it is visible in a pane, whether it is the active (focused) file, and any text the user has selected. Also includes the current project if the session is linked to one. Non-Markdown views (PDFs, canvases, images) are not included — use read_file for those.";

	parameters = {
		type: 'object' as const,
		properties: {},
		required: [],
	};

	getProgressDescription(_params: any): string {
		return 'Getting workspace state';
	}

	async execute(_params: any, context: ToolExecutionContext): Promise<ToolResult> {
		const plugin = context.plugin as ObsidianGemini;

		try {
			const activeFile = plugin.app.workspace.getActiveFile();
			const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

			// Collect all open markdown leaves, de-duplicating by path
			const fileMap = new Map<
				string,
				{ path: string; wikilink: string; visible: boolean; active: boolean; selection: string | null }
			>();

			plugin.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				if (!(view instanceof MarkdownView) || !view.file) return;

				const file = view.file;
				const path = file.path;

				// Skip system/excluded files
				if (shouldExcludePath(path, plugin)) return;

				const isVisible = (leaf as any).containerEl?.isShown?.() ?? false;
				const isActive = activeFile !== null && file.path === activeFile.path;
				const isActiveLeaf = view === activeView;

				let selection: string | null = null;
				try {
					const sel = view.editor.getSelection();
					if (sel) {
						selection = sel.length > MAX_SELECTION_LENGTH ? sel.slice(0, MAX_SELECTION_LENGTH) + '...' : sel;
					}
				} catch {
					// Editor may not be available
				}

				// Fallback: when focus has moved to the agent input the live
				// selection reads empty. AgentView snapshots the selection on
				// input focus; use it when this leaf matches the cached path.
				if (!selection && plugin.lastEditorSelection?.path === path) {
					const cached = plugin.lastEditorSelection.text;
					selection = cached.length > MAX_SELECTION_LENGTH ? cached.slice(0, MAX_SELECTION_LENGTH) + '...' : cached;
				}

				const existing = fileMap.get(path);
				if (existing) {
					// Merge: visible/active if ANY leaf qualifies
					existing.visible = existing.visible || isVisible;
					existing.active = existing.active || isActive;
					// Prefer selection from the focused leaf over background panes
					if (isActiveLeaf && selection) {
						existing.selection = selection;
					} else if (!existing.selection && selection) {
						existing.selection = selection;
					}
				} else {
					const linkText = plugin.app.metadataCache.fileToLinktext(file, '');
					fileMap.set(path, {
						path,
						wikilink: `[[${linkText}]]`,
						visible: isVisible,
						active: isActive,
						selection,
					});
				}
			});

			const openFiles = Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));

			// Include project info if session is linked to one (best-effort)
			let project: { name: string; rootPath: string } | null = null;
			if (context.session?.projectPath && plugin.projectManager) {
				try {
					const proj = await plugin.projectManager.getProject(context.session.projectPath);
					if (proj) {
						project = { name: proj.config.name, rootPath: proj.rootPath };
					}
				} catch {
					// Project lookup failed — return openFiles without project info
				}
			}

			return {
				success: true,
				data: { openFiles, project },
			};
		} catch (error) {
			return {
				success: false,
				error: `Error getting workspace state: ${error instanceof Error ? error.message : 'Unknown error'}`,
			};
		}
	}
}
