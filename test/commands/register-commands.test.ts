import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Editor, MarkdownView } from 'obsidian';
import type { ObsidianGemini } from '../../src/types/plugin';
import type { ProjectSummary } from '../../src/types/project';

// registerCommands is the command-palette surface: what matters is the *set* of
// command IDs the plugin publishes (hotkey bindings are stable across releases —
// a removed ID silently breaks a user's binding) and the gating each callback
// performs (checkInitialized, feature routing, empty-selection). Per the
// #1262 guidance for this module: assert the registered set and the gates,
// not each command's inner UI flow.

vi.mock('obsidian', () => ({
	Notice: class {
		constructor(message: string) {
			(window as any).__noticeMessages?.push(message);
		}
	},
	MarkdownView: class {},
	normalizePath: (p: string) => p,
}));

vi.mock('../../src/i18n', () => ({
	t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}));

vi.mock('../../src/ui/settings/provider-cards', () => ({
	refreshGeminiModelList: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/rewrite-selection', () => ({
	SelectionRewriter: vi.fn().mockImplementation(function () {
		return {
			rewriteSelection: vi.fn().mockResolvedValue(undefined),
			rewriteFullFile: vi.fn().mockResolvedValue(undefined),
		};
	}),
}));

vi.mock('../../src/ui/rewrite-modal', () => ({
	RewriteInstructionsModal: vi.fn().mockImplementation(function (
		_app: unknown,
		_text: string,
		onSubmit: (instructions: string) => void
	) {
		return {
			open: vi.fn(() => onSubmit('test instructions')),
		};
	}),
}));

vi.mock('../../src/ui/update-notification-modal', () => ({
	UpdateNotificationModal: vi.fn().mockImplementation(function () {
		return { open: vi.fn() };
	}),
}));

vi.mock('../../src/api/provider-status', () => ({
	featureStatus: vi.fn(),
}));

// featureStatus is mocked (not the real routing logic) so each test states the
// routing outcome it depends on explicitly, per the decision-surface principle:
// these commands gate on the *status*, not on how the status is computed.
const featureStatusMock = vi.mocked(featureStatus);

vi.mock('../../src/ui/scheduler-management-modal', () => ({
	SchedulerManagementModal: vi.fn().mockImplementation(function () {
		return { open: openSpy };
	}),
}));

vi.mock('../../src/ui/hook-management-modal', () => ({
	HookManagementModal: vi.fn().mockImplementation(function () {
		return { open: openSpy };
	}),
}));

vi.mock('../../src/ui/background-tasks-modal', () => ({
	BackgroundTasksModal: vi.fn().mockImplementation(function () {
		return { open: openSpy };
	}),
}));

vi.mock('../../src/ui/agent-view/project-picker-modal', () => ({
	ProjectPickerModal: vi.fn().mockImplementation(function (
		_app: unknown,
		_plugin: unknown,
		opts: { onSelect: (p: unknown) => void }
	) {
		// The picker hands the last project to onSelect when shown.
		return { open: openSpy, __opts: opts };
	}),
}));

vi.mock('../../src/services/rag-status-bar', () => ({
	openRagStatusModal: vi.fn().mockResolvedValue(undefined),
}));

// Imported after the mocks so the mock constructors are wired in.
import { registerCommands } from '../../src/commands/register-commands';
import { featureStatus } from '../../src/api/provider-status';
import { SelectionRewriter } from '../../src/rewrite-selection';

const openSpy = vi.fn();

function makePlugin(): any {
	return {
		checkInitialized: vi.fn().mockReturnValue(true),
		addCommand: vi.fn(),
		app: {
			workspace: {
				openLinkText: vi.fn().mockResolvedValue(undefined),
				getActiveFile: vi.fn().mockReturnValue({ parent: { path: 'Projects' } }),
			},
		},
		logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
		manifest: { version: '4.11.0', id: 'gemini-scribe' },
		settings: {
			features: {
				chat: { provider: 'gemini', model: 'm' },
			},
		},
		projectManager: {
			createProject: vi.fn().mockResolvedValue({ path: 'Projects/New Project.md' }),
			convertNoteToProject: vi.fn().mockResolvedValue(undefined),
			removeProject: vi.fn().mockResolvedValue(undefined),
			discoverProjects: vi.fn().mockReturnValue([]),
		},
		sessionManager: {
			getRecentAgentSessions: vi.fn().mockResolvedValue([]),
		},
		selectionActionService: {
			handleExplainSelection: vi.fn().mockResolvedValue(undefined),
			handleAskAboutSelection: vi.fn().mockResolvedValue(undefined),
		},
		ragIndexing: null,
		imageGeneration: null,
	};
}

/** Registered commands keyed by id, with their callback/editorCallback, bound to one plugin. */
interface RegisteredPlugin {
	plugin: any;
	commands: Map<string, Record<string, unknown>>;
}

function registerOn(plugin: ObsidianGemini): Map<string, Record<string, unknown>> {
	registerCommands(plugin);
	const registered = (plugin.addCommand as Mock).mock.calls.map((c) => c[0]) as Array<Record<string, unknown>>;
	return new Map(registered.map((cmd) => [String(cmd.id), cmd]));
}

/** Register against a fresh plugin and return both, so callbacks close over the right instance. */
function makeRegistered(overrides?: (plugin: any) => void): RegisteredPlugin {
	const plugin = makePlugin();
	overrides?.(plugin);
	return { plugin, commands: registerOn(plugin) };
}

function notices(): string[] {
	return (window as any).__noticeMessages ?? [];
}

beforeEach(() => {
	vi.clearAllMocks();
	(window as any).__noticeMessages = [];
	featureStatusMock.mockReturnValue('ok');
});

describe('registerCommands', () => {
	it('registers the documented command set — IDs are a hotkey-stable contract', () => {
		const { commands } = makeRegistered();

		expect([...commands.keys()].sort()).toEqual(
			[
				'ask-selection',
				'browse-sessions',
				'convert-to-project',
				'create-project',
				'explain-selection',
				'generate-image',
				'link-project',
				'new-hook',
				'new-session',
				'new-scheduled-task',
				'open-agent-view',
				'open-hook-manager',
				'open-project-settings',
				'open-scheduler',
				'rag-pause',
				'rag-resume',
				'rag-status',
				'refresh-model-list',
				'remove-project',
				'resume-project-session',
				'rewrite-selection',
				'session-settings',
				'switch-project',
				'toggle-plan-mode',
				'view-background-tasks',
				'view-release-notes',
				'view-scheduled-tasks',
			].sort()
		);
	});

	it('every command carries a name and exactly one callback kind', () => {
		const { commands } = makeRegistered();
		for (const cmd of commands.values()) {
			expect(cmd.name, `command ${String(cmd.id)} has a name`).toBeTruthy();
			const hasCallback = typeof cmd.callback === 'function';
			const hasEditorCallback = typeof cmd.editorCallback === 'function';
			expect(hasCallback || hasEditorCallback, `command ${String(cmd.id)} has a callback`).toBe(true);
		}
	});

	describe('initialization gate', () => {
		it.each(['open-agent-view', 'refresh-model-list', 'new-session', 'generate-image'])(
			'bails without acting when %s runs before initialization',
			async (id) => {
				const { plugin, commands } = makeRegistered((p) => {
					p.checkInitialized.mockReturnValue(false);
				});
				const cmd = commands.get(id)!;

				if (cmd.editorCallback) {
					await (cmd.editorCallback as (e: unknown, v: unknown) => Promise<void>)(null, { file: null });
				} else {
					await (cmd.callback as () => Promise<void> | void)();
				}

				expect(plugin.checkInitialized).toHaveBeenCalled();
			}
		);
	});

	describe('rag commands — resolveRagIndexing gate', () => {
		it('rag-pause pauses an idle, routed indexer', async () => {
			const { plugin, commands } = makeRegistered();
			const ragIndexing = {
				isPaused: vi.fn().mockReturnValue(false),
				isIndexing: vi.fn().mockReturnValue(false),
				pause: vi.fn(),
			};
			plugin.ragIndexing = ragIndexing;

			(commands.get('rag-pause')!.callback as () => void)();

			expect(ragIndexing.pause).toHaveBeenCalledTimes(1);
		});

		it('rag-pause refuses while indexing', async () => {
			const { plugin, commands } = makeRegistered();
			const ragIndexing = {
				isPaused: vi.fn().mockReturnValue(false),
				isIndexing: vi.fn().mockReturnValue(true),
				pause: vi.fn(),
			};
			plugin.ragIndexing = ragIndexing;

			(commands.get('rag-pause')!.callback as () => void)();

			expect(ragIndexing.pause).not.toHaveBeenCalled();
			expect(notices()).toContain('notice.main.ragCannotPauseWhileIndexing');
		});

		it('rag-resume bails when not paused', async () => {
			const { plugin, commands } = makeRegistered();
			const ragIndexing = { isPaused: vi.fn().mockReturnValue(false), resume: vi.fn() };
			plugin.ragIndexing = ragIndexing;

			(commands.get('rag-resume')!.callback as () => void)();

			expect(ragIndexing.resume).not.toHaveBeenCalled();
			expect(notices()).toContain('notice.main.ragNotPaused');
		});

		it('both pause and resume show the unavailable notice when no provider is routed', async () => {
			featureStatusMock.mockReturnValue('off');
			const { commands } = makeRegistered();

			(commands.get('rag-pause')!.callback as () => void)();
			(commands.get('rag-resume')!.callback as () => void)();

			expect(notices().filter((n) => n === 'notice.main.ragUnavailableProvider')).toHaveLength(2);
		});
	});

	describe('generate-image gate', () => {
		it('shows the provider notice when imageGen is not routed and never touches the service', async () => {
			featureStatusMock.mockReturnValue('off');
			const { plugin, commands } = makeRegistered();

			await (commands.get('generate-image')!.callback as () => Promise<void>)();

			expect(notices()).toContain('notice.main.imageGenUnavailableProvider');
			expect(plugin.imageGeneration).toBeNull();
		});

		it('shows the service notice when routed but the service is absent', async () => {
			const { commands } = makeRegistered();
			// featureStatus returns 'ok' but imageGeneration is null.
			await (commands.get('generate-image')!.callback as () => Promise<void>)();

			expect(notices()).toContain('notice.main.imageGenUnavailable');
		});
	});

	describe('rewrite-selection', () => {
		it('asks for text when the selection is empty', () => {
			const { commands } = makeRegistered();
			const editor = { getSelection: vi.fn().mockReturnValue('') } as unknown as Editor;

			(commands.get('rewrite-selection')!.editorCallback as (e: Editor, v: unknown) => void)(editor, {});

			expect(notices()).toContain('notice.main.selectTextFirst');
		});

		it('opens the instructions modal with the selection and rewrites it', () => {
			const { commands } = makeRegistered();
			const editor = { getSelection: vi.fn().mockReturnValue('  selected text  ') } as unknown as Editor;

			(commands.get('rewrite-selection')!.editorCallback as (e: Editor, v: unknown) => void)(editor, {});

			// The modal fires onSubmit during open(); rewriteSelection got the raw selection.
			const rewriter = (SelectionRewriter as unknown as Mock).mock.results[0].value;
			expect(rewriter.rewriteSelection).toHaveBeenCalledWith(editor, '  selected text  ', 'test instructions');
		});
	});

	describe('project commands', () => {
		it('create-project uses the active file folder and opens the new project', async () => {
			const { plugin, commands } = makeRegistered();

			await (commands.get('create-project')!.callback as () => Promise<void>)();

			expect(plugin.projectManager.createProject).toHaveBeenCalledWith('Projects', 'New Project');
			expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith('Projects/New Project.md', '', true);
		});

		it('convert-to-project converts the current note', async () => {
			const { plugin, commands } = makeRegistered();
			const view = { file: { basename: 'My Note' } } as unknown as MarkdownView;

			await (commands.get('convert-to-project')!.editorCallback as (e: unknown, v: MarkdownView) => Promise<void>)(
				null,
				view
			);

			expect(plugin.projectManager.convertNoteToProject).toHaveBeenCalledWith(view.file);
			// t() mock appends :{vars} — match the key prefix, not a bare key.
			expect(notices().some((n) => n.startsWith('notice.main.convertedToProject'))).toBe(true);
		});

		it('open-project-settings short-circuits to the lone project without the picker', async () => {
			const { plugin, commands } = makeRegistered();
			const project: ProjectSummary = { name: 'Solo', filePath: 'Projects/Solo.md', rootPath: 'Projects/Solo' };
			plugin.projectManager.discoverProjects = vi.fn().mockReturnValue([project]);

			await (commands.get('open-project-settings')!.callback as () => Promise<void>)();

			expect(plugin.app.workspace.openLinkText).toHaveBeenCalledWith('Projects/Solo.md', '', true);
		});

		it('open-project-settings announces when no projects exist', async () => {
			const { commands } = makeRegistered();

			await (commands.get('open-project-settings')!.callback as () => Promise<void>)();

			expect(notices()).toContain('notice.main.noProjectsFound');
		});

		it('resume-project-session notices when the project has no sessions', async () => {
			const { plugin, commands } = makeRegistered();
			const project: ProjectSummary = { name: 'Solo', filePath: 'Projects/Solo.md', rootPath: 'Projects/Solo' };
			plugin.projectManager.discoverProjects = vi.fn().mockReturnValue([project]);

			await (commands.get('resume-project-session')!.callback as () => Promise<void>)();

			expect(notices().some((n) => n.startsWith('notice.main.noSessionsForProject'))).toBe(true);
		});
	});

	describe('agent-view session commands', () => {
		it('new-session creates a fresh session only when the view was already open', async () => {
			const { plugin, commands } = makeRegistered((p) => {
				p.activateAgentView = vi.fn().mockResolvedValue(undefined);
				p.agentView = { createNewSession: vi.fn().mockResolvedValue(undefined) };
			});

			await (commands.get('new-session')!.callback as () => Promise<void>)();

			expect(plugin.activateAgentView).toHaveBeenCalledTimes(1);
			expect(plugin.agentView.createNewSession).toHaveBeenCalledTimes(1);

			// View not yet open — activation creates the default session itself.
			const fresh = makeRegistered((p) => {
				p.activateAgentView = vi.fn().mockResolvedValue(undefined);
				// agentView stays undefined until activation sets it.
			});
			await (fresh.commands.get('new-session')!.callback as () => Promise<void>)();
			expect(fresh.plugin.agentView).toBeUndefined();
		});

		it('browse-sessions opens the session list after activation', async () => {
			const { plugin, commands } = makeRegistered((p) => {
				p.activateAgentView = vi.fn().mockResolvedValue(undefined);
				p.agentView = { showSessionList: vi.fn().mockResolvedValue(undefined) };
			});

			await (commands.get('browse-sessions')!.callback as () => Promise<void>)();

			expect(plugin.agentView.showSessionList).toHaveBeenCalledTimes(1);
		});

		it('toggle-plan-mode forwards to the agent view', async () => {
			const { plugin, commands } = makeRegistered((p) => {
				p.activateAgentView = vi.fn().mockResolvedValue(undefined);
				p.agentView = { togglePlanMode: vi.fn() };
			});

			await (commands.get('toggle-plan-mode')!.callback as () => Promise<void>)();

			expect(plugin.agentView.togglePlanMode).toHaveBeenCalledTimes(1);
		});
	});
});
