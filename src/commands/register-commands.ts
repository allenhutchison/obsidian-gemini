import { Editor, MarkdownView, MarkdownFileInfo, Notice } from 'obsidian';
import { t } from '../i18n';
import { refreshGeminiModelList } from '../ui/settings-general';
import { SelectionRewriter } from '../rewrite-selection';
import { RewriteInstructionsModal } from '../ui/rewrite-modal';
import { UpdateNotificationModal } from '../ui/update-notification-modal';
import { getErrorMessage } from '../utils/error-utils';
import type { ObsidianGemini } from '../types/plugin';

/**
 * Register all command-palette commands on the plugin instance.
 *
 * Extracted verbatim from `ObsidianGemini.registerUIAndCommands()` as a pure
 * code-motion refactor (issue #1070) to keep `main.ts` legible as the plugin
 * lifecycle entry point. Ribbon icon, view registration, and the editor-menu
 * context-menu event remain in `main.ts`; only the `addCommand` calls live here.
 * Command IDs, names, and callback behavior are unchanged.
 */
export function registerCommands(plugin: ObsidianGemini): void {
	// Add command
	plugin.addCommand({
		id: 'open-agent-view',
		name: t('command.openAgentView'),
		callback: () => {
			if (!plugin.checkInitialized()) return;
			// Fire-and-forget: opening the view is a UI action; errors surface via Obsidian.
			void plugin.activateAgentView();
		},
	});

	// Refresh remote Gemini model list (bypass 24h cache)
	plugin.addCommand({
		id: 'refresh-model-list',
		name: t('command.refreshModelList'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			await refreshGeminiModelList(plugin);
		},
	});

	// View background tasks
	plugin.addCommand({
		id: 'view-background-tasks',
		name: t('command.viewBackgroundTasks'),
		callback: async () => {
			const { BackgroundTasksModal } = await import('../ui/background-tasks-modal');
			// Command name is unambiguous, so always land on the Tasks tab.
			// The status-bar entry uses its own context-aware default.
			new BackgroundTasksModal(plugin.app, plugin, 'tasks').open();
		},
	});

	// Open scheduler management modal
	plugin.addCommand({
		id: 'open-scheduler',
		name: t('command.openScheduler'),
		callback: async () => {
			const { SchedulerManagementModal } = await import('../ui/scheduler-management-modal');
			new SchedulerManagementModal(plugin.app, plugin, 'list').open();
		},
	});

	// New scheduled task — jump straight to create form
	plugin.addCommand({
		id: 'new-scheduled-task',
		name: t('command.newScheduledTask'),
		callback: async () => {
			const { SchedulerManagementModal } = await import('../ui/scheduler-management-modal');
			new SchedulerManagementModal(plugin.app, plugin, 'create').open();
		},
	});

	// Open lifecycle hook management modal
	plugin.addCommand({
		id: 'open-hook-manager',
		name: t('command.openHookManager'),
		callback: async () => {
			const { HookManagementModal } = await import('../ui/hook-management-modal');
			new HookManagementModal(plugin.app, plugin, 'list').open();
		},
	});

	// New lifecycle hook — jump straight to create form
	plugin.addCommand({
		id: 'new-hook',
		name: t('command.newHook'),
		callback: async () => {
			const { HookManagementModal } = await import('../ui/hook-management-modal');
			new HookManagementModal(plugin.app, plugin, 'create').open();
		},
	});

	// View scheduled tasks (read-only legacy — kept for backwards compatibility)
	plugin.addCommand({
		id: 'view-scheduled-tasks',
		name: t('command.viewScheduledTasks'),
		callback: async () => {
			const { ScheduledTasksModal } = await import('../ui/scheduled-tasks-modal');
			new ScheduledTasksModal(plugin.app, plugin).open();
		},
	});

	// Switch project for the current agent session
	plugin.addCommand({
		id: 'switch-project',
		name: t('command.switchProject'),
		callback: () => {
			if (!plugin.checkInitialized()) return;
			// Fire-and-forget: opening the view is a UI action; errors surface via Obsidian.
			void plugin.activateAgentView();
			// The agent view's switchProject is triggered via the project badge in the header
			// or users can click the project indicator once the view is open
		},
	});

	// Create a new project
	plugin.addCommand({
		id: 'create-project',
		name: t('command.createProject'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			const folder = plugin.app.workspace.getActiveFile()?.parent?.path || '';
			const name = 'New Project';
			try {
				const file = await plugin.projectManager.createProject(folder, name);
				await plugin.app.workspace.openLinkText(file.path, '', true);
				new Notice(t('notice.main.projectCreated', { path: file.path }));
			} catch (error) {
				plugin.logger.error('Failed to create project:', error);
				new Notice(t('notice.main.projectCreateFailed'));
			}
		},
	});

	// Convert current note to a project
	plugin.addCommand({
		id: 'convert-to-project',
		name: t('command.convertToProject'),
		editorCallback: async (_editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
			if (!plugin.checkInitialized()) return;
			if (!view.file) return;
			try {
				await plugin.projectManager.convertNoteToProject(view.file);
				new Notice(t('notice.main.convertedToProject', { name: view.file.basename }));
			} catch (error) {
				plugin.logger.error('Failed to convert note to project:', error);
				new Notice(t('notice.main.convertToProjectFailed'));
			}
		},
	});

	// Open project settings (the project file itself)
	plugin.addCommand({
		id: 'open-project-settings',
		name: t('command.openProjectSettings'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			const projects = plugin.projectManager?.discoverProjects() ?? [];
			if (projects.length === 0) {
				new Notice(t('notice.main.noProjectsFound'));
				return;
			}
			// If only one project, open it directly
			if (projects.length === 1) {
				await plugin.app.workspace.openLinkText(projects[0].filePath, '', true);
				return;
			}
			// Show picker for multiple projects
			const { ProjectPickerModal } = await import('../ui/agent-view/project-picker-modal');
			const modal = new ProjectPickerModal(plugin.app, plugin, {
				onSelect: (project) => {
					if (project) {
						void plugin.app.workspace.openLinkText(project.filePath, '', true);
					}
				},
			});
			modal.open();
		},
	});

	// Resume the most recent session for a project
	plugin.addCommand({
		id: 'resume-project-session',
		name: t('command.resumeProjectSession'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			const projects = plugin.projectManager?.discoverProjects() ?? [];
			if (projects.length === 0) {
				new Notice(t('notice.main.noProjectsFound'));
				return;
			}
			const { ProjectPickerModal } = await import('../ui/agent-view/project-picker-modal');
			const modal = new ProjectPickerModal(plugin.app, plugin, {
				onSelect: (project) => {
					void (async () => {
						try {
							if (!project) return;
							// Find most recent session linked to this project
							const sessions = await plugin.sessionManager.getRecentAgentSessions(50);
							const projectSession = sessions.find((s) => s.projectPath === project.filePath);
							if (projectSession) {
								await plugin.activateAgentView();
								// The agent view will load the session
								if (plugin.agentView) {
									await plugin.agentView.loadSession(projectSession);
								}
							} else {
								new Notice(t('notice.main.noSessionsForProject', { name: project.name }));
							}
						} catch (error) {
							// Mirror the try/catch the sibling project commands already have.
							plugin.logger.error('Failed to resume project session:', error);
							new Notice(t('notice.main.resumeProjectSessionFailed'));
						}
					})();
				},
			});
			modal.open();
		},
	});

	// Remove project status from a file
	plugin.addCommand({
		id: 'remove-project',
		name: t('command.removeProject'),
		editorCallback: async (_editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
			if (!plugin.checkInitialized()) return;
			if (!view.file) return;
			try {
				await plugin.projectManager.removeProject(view.file);
				new Notice(t('notice.main.projectRemoved', { name: view.file.basename }));
			} catch (error) {
				plugin.logger.error('Failed to remove project:', error);
				new Notice(t('notice.main.projectRemoveFailed'));
			}
		},
	});

	// Add rewrite command (works with selection or full file)
	plugin.addCommand({
		id: 'rewrite-selection',
		name: t('command.rewriteSelection'),
		editorCallback: (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
			if (!plugin.checkInitialized()) return;
			const selection = editor.getSelection();

			if (!selection || selection.trim().length === 0) {
				new Notice(t('notice.main.selectTextFirst'));
				return;
			}

			const textToRewrite = selection;
			const isFullFile = false;

			// Show modal for instructions
			const modal = new RewriteInstructionsModal(
				plugin.app,
				textToRewrite,
				(instructions) => {
					void (async () => {
						const rewriter = new SelectionRewriter(plugin);
						if (isFullFile) {
							await rewriter.rewriteFullFile(editor, instructions);
						} else {
							await rewriter.rewriteSelection(editor, selection, instructions);
						}
					})();
				},
				isFullFile
			);
			modal.open();
		},
	});

	// Add explain selection command
	plugin.addCommand({
		id: 'explain-selection',
		name: t('command.explainSelection'),
		editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
			if (!plugin.checkInitialized()) return;
			await plugin.selectionActionService.handleExplainSelection(editor, view.file);
		},
	});

	// Add ask about selection command
	plugin.addCommand({
		id: 'ask-selection',
		name: t('command.askSelection'),
		editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
			if (!plugin.checkInitialized()) return;
			await plugin.selectionActionService.handleAskAboutSelection(editor, view.file);
		},
	});

	// Add command to view release notes
	plugin.addCommand({
		id: 'view-release-notes',
		name: t('command.viewReleaseNotes'),
		callback: () => {
			const modal = new UpdateNotificationModal(plugin.app, plugin.manifest.version);
			modal.open();
		},
	});

	// Image generation command (Gemini-only). Registered unconditionally so
	// the palette entry stays stable across runtime provider switches; the
	// callback gates on provider before touching the (potentially null)
	// `imageGeneration` service.
	plugin.addCommand({
		id: 'generate-image',
		name: t('command.generateImage'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			if (plugin.settings.provider === 'ollama') {
				new Notice(t('notice.main.imageGenOllama'));
				return;
			}
			if (!plugin.imageGeneration) {
				new Notice(t('notice.main.imageGenUnavailable'));
				return;
			}
			const prompt = await plugin.imageGeneration.promptForImageDescription();
			if (prompt) {
				await plugin.imageGeneration.generateAndInsertImage(prompt);
			}
		},
	});

	// RAG indexing commands. Same pattern as image generation: register
	// unconditionally and gate at execution time so the palette stays
	// consistent and the user gets a clear "not available" notice on the
	// Ollama path (RAG depends on Gemini's File Search Store in Phase 1).
	plugin.addCommand({
		id: 'rag-pause',
		name: t('command.ragPause'),
		callback: () => {
			if (plugin.settings.provider === 'ollama') {
				new Notice(t('notice.main.ragOllamaUnavailable'));
				return;
			}
			if (!plugin.ragIndexing) {
				new Notice(t('notice.main.ragNotEnabled'));
				return;
			}
			if (plugin.ragIndexing.isPaused()) {
				new Notice(t('notice.main.ragAlreadyPaused'));
				return;
			}
			if (plugin.ragIndexing.isIndexing()) {
				new Notice(t('notice.main.ragCannotPauseWhileIndexing'));
				return;
			}
			plugin.ragIndexing.pause();
			new Notice(t('notice.main.ragPaused'));
		},
	});

	plugin.addCommand({
		id: 'rag-resume',
		name: t('command.ragResume'),
		callback: () => {
			if (plugin.settings.provider === 'ollama') {
				new Notice(t('notice.main.ragOllamaUnavailable'));
				return;
			}
			if (!plugin.ragIndexing) {
				new Notice(t('notice.main.ragNotEnabled'));
				return;
			}
			if (!plugin.ragIndexing.isPaused()) {
				new Notice(t('notice.main.ragNotPaused'));
				return;
			}
			plugin.ragIndexing.resume();
			new Notice(t('notice.main.ragResumed'));
		},
	});

	plugin.addCommand({
		id: 'rag-status',
		name: t('command.ragStatus'),
		callback: async () => {
			if (plugin.settings.provider === 'ollama') {
				new Notice(t('notice.main.ragOllamaUnavailable'));
				return;
			}
			if (!plugin.ragIndexing) {
				new Notice(t('notice.main.ragNotEnabled'));
				return;
			}
			// Trigger the same modal as clicking the status bar
			try {
				const { openRagStatusModal } = await import('../services/rag-status-bar');
				await openRagStatusModal(plugin.app, plugin.ragIndexing, plugin.manifest.id);
			} catch (error) {
				plugin.logger.error('RAG Indexing: Failed to open status UI', error);
				new Notice(t('notice.rag.uiError', { error: getErrorMessage(error) }));
			}
		},
	});

	// Agent session management commands
	plugin.addCommand({
		id: 'new-session',
		name: t('command.newSession'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			// Check if the agent view already exists before activating it.
			// AgentView.onOpen() automatically creates a default session, so we only
			// call createNewSession() if the view was already open (user is asking for
			// a fresh session, not the existing default).
			const viewAlreadyExists = !!plugin.agentView;
			await plugin.activateAgentView();
			if (viewAlreadyExists && plugin.agentView) {
				await plugin.agentView.createNewSession();
			}
		},
	});

	plugin.addCommand({
		id: 'browse-sessions',
		name: t('command.browseSessions'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			await plugin.activateAgentView();
			if (plugin.agentView) {
				await plugin.agentView.showSessionList();
			}
		},
	});

	plugin.addCommand({
		id: 'link-project',
		name: t('command.linkProject'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			await plugin.activateAgentView();
			if (plugin.agentView) {
				plugin.agentView.switchProject();
			}
		},
	});

	plugin.addCommand({
		id: 'session-settings',
		name: t('command.sessionSettings'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			await plugin.activateAgentView();
			if (plugin.agentView) {
				await plugin.agentView.showSessionSettings();
			}
		},
	});

	plugin.addCommand({
		id: 'toggle-plan-mode',
		name: t('command.togglePlanMode'),
		callback: async () => {
			if (!plugin.checkInitialized()) return;
			await plugin.activateAgentView();
			if (plugin.agentView) {
				plugin.agentView.togglePlanMode();
			}
		},
	});
}
