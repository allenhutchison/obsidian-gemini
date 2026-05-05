import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile as MockTFile } from 'obsidian';
import { HookRunner } from '../../src/services/hook-runner';
import type { Hook, HookFireContext } from '../../src/services/hook-manager';
import type { AgentLoopResult } from '../../src/agent/agent-loop';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	TFile: class {},
	Notice: class {
		constructor(_msg?: string) {}
	},
	Modal: class {
		app: any;
		constructor(app: any) {
			this.app = app;
		}
	},
	Platform: { isMobile: false },
}));

vi.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/utils/format-utils', () => ({
	formatLocalDate: vi.fn().mockReturnValue('2026-05-04'),
	formatLocalTimestamp: vi.fn().mockReturnValue('2026-05-04 08:00'),
}));

vi.mock('../../src/utils/turn-preamble', () => ({
	buildTurnPreamble: vi.fn().mockReturnValue(''),
}));

vi.mock('../../src/api', () => ({
	GeminiClientFactory: {
		createChatModel: vi.fn(),
		createSummaryModel: vi.fn(),
		createRewriteModel: vi.fn(),
	},
}));

// SelectionRewriter / GeminiSummary import the API package directly via a
// different path; mock that side too.
vi.mock('../../src/api/simple-factory', () => ({
	GeminiClientFactory: {
		createChatModel: vi.fn(),
		createSummaryModel: vi.fn(),
		createRewriteModel: vi.fn(),
	},
}));

// SelectionRewriter constructs a fresh GeminiPrompts; stub the registration.
vi.mock('../../src/prompts', () => ({
	GeminiPrompts: class {
		summaryPrompt(_vars: any) {
			return 'summary prompt';
		}
		selectionRewritePrompt(_vars: any) {
			return 'selection rewrite prompt';
		}
		contextPrompt(_vars: any) {
			return 'context prompt';
		}
	},
}));

const mockAgentLoopRun = vi.fn();
vi.mock('../../src/agent/agent-loop', () => ({
	AgentLoop: vi.fn().mockImplementation(function () {
		return { run: mockAgentLoopRun };
	}),
}));

import { GeminiClientFactory } from '../../src/api';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function successfulLoopResult(markdown = 'Done.'): AgentLoopResult {
	return {
		markdown,
		history: [],
		cancelled: false,
		retried: false,
		fellBack: false,
		exhausted: false,
		loopAborted: false,
		iterations: 1,
	};
}

function makeHook(overrides: Partial<Hook> = {}): Hook {
	return {
		slug: 'test-hook',
		trigger: 'file-modified',
		debounceMs: 100,
		cooldownMs: 0,
		action: 'agent-task',
		enabledTools: ['read_only'],
		enabledSkills: [],
		enabled: true,
		desktopOnly: false,
		prompt: 'Process {{filePath}}',
		filePath: 'gemini-scribe/Hooks/test-hook.md',
		outputPath: 'Hooks/Runs/test-hook/{date}.md',
		...overrides,
	};
}

function makeContext(hook: Hook = makeHook()): HookFireContext {
	return {
		hook,
		trigger: hook.trigger,
		filePath: 'Notes/foo.md',
		fileName: 'foo.md',
	};
}

interface VaultStub {
	create: ReturnType<typeof vi.fn>;
	getAbstractFileByPath: ReturnType<typeof vi.fn>;
}

function createMockPlugin(opts: { existingPaths?: string[]; createBehaviour?: VaultStub['create'] } = {}) {
	const existing = new Set(opts.existingPaths ?? []);

	const create =
		opts.createBehaviour ??
		vi.fn().mockImplementation(async (path: string) => {
			if (existing.has(path)) {
				throw new Error('File already exists.');
			}
			existing.add(path);
		});

	return {
		logger: { log: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
		settings: {
			chatModelName: 'gemini-2.0-flash',
			summaryFrontmatterKey: 'summary',
			temperature: 1,
			topP: 0.95,
		},
		sessionManager: {
			createAgentSession: vi.fn().mockResolvedValue({
				id: 'session-1',
				title: 'Hook: test-hook',
				created: new Date(),
				context: { enabledTools: [], requireConfirmation: [] },
				modelConfig: {},
			}),
		},
		toolRegistry: { getEnabledTools: vi.fn().mockReturnValue([]) },
		toolExecutionEngine: { executeTool: vi.fn() },
		// Optional injected services — left undefined by default; tests
		// override per scenario (e.g. summarize tests set `summarizer`).
		summarizer: undefined as any,
		app: {
			vault: {
				create,
				modify: vi.fn().mockResolvedValue(undefined),
				read: vi.fn().mockResolvedValue('Original file content.'),
				getAbstractFileByPath: vi.fn().mockImplementation((p: string) => (existing.has(p) ? { path: p } : null)),
			},
			fileManager: {
				processFrontMatter: vi.fn().mockImplementation((_file: any, mutator: (fm: Record<string, unknown>) => void) => {
					mutator({});
				}),
			},
			commands: {
				executeCommandById: vi.fn().mockReturnValue(true),
			},
		},
		__existing: existing,
		__create: create,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HookRunner.writeOutput retry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(GeminiClientFactory.createChatModel as any).mockReturnValue({
			generateModelResponse: vi.fn().mockResolvedValue({ markdown: 'Hook output.', toolCalls: [] }),
		});
	});

	it('writes output to the resolved path on first try when there is no collision', async () => {
		const plugin = createMockPlugin();
		const runner = new HookRunner(plugin as any, makeContext());

		await runner.run();

		expect(plugin.__create).toHaveBeenCalledTimes(1);
		const [path] = plugin.__create.mock.calls[0];
		expect(path).toBe('Hooks/Runs/test-hook/2026-05-04.md');
	});

	it('skips collisions to the next free numeric suffix', async () => {
		const plugin = createMockPlugin({
			existingPaths: ['Hooks/Runs/test-hook/2026-05-04.md', 'Hooks/Runs/test-hook/2026-05-04-1.md'],
		});
		const runner = new HookRunner(plugin as any, makeContext());

		await runner.run();

		// resolveUniquePath skips the two existing files; the create call lands
		// on the first free suffix.
		const written = plugin.__create.mock.calls.map((c: any[]) => c[0]);
		expect(written).toEqual(['Hooks/Runs/test-hook/2026-05-04-2.md']);
	});

	it('retries on a race-condition "already exists" rejection from create', async () => {
		// Simulate the race: getAbstractFileByPath sees an empty slot, but create
		// rejects because a concurrent fire wrote to the same path between the
		// existence check and the create call. After the first rejection, the
		// "occupied" path is reachable so resolveUniquePath skips it on retry.
		const occupiedAfterFirstAttempt = new Set<string>();
		const create = vi.fn().mockImplementation(async (path: string) => {
			if (path === 'Hooks/Runs/test-hook/2026-05-04.md' && create.mock.calls.length === 1) {
				occupiedAfterFirstAttempt.add(path);
				throw new Error('File already exists.');
			}
		});

		const plugin = createMockPlugin({ createBehaviour: create });
		(plugin.app.vault.getAbstractFileByPath as any).mockImplementation((p: string) =>
			occupiedAfterFirstAttempt.has(p) ? { path: p } : null
		);

		const runner = new HookRunner(plugin as any, makeContext());
		await runner.run();

		expect(create).toHaveBeenCalledTimes(2);
		const written = create.mock.calls.map((c: any[]) => c[0]);
		expect(written[0]).toBe('Hooks/Runs/test-hook/2026-05-04.md');
		expect(written[1]).toBe('Hooks/Runs/test-hook/2026-05-04-1.md');
	});

	it('rethrows non-collision errors immediately without retrying', async () => {
		const create = vi.fn().mockRejectedValue(new Error('Disk full'));
		const plugin = createMockPlugin({ createBehaviour: create });
		const runner = new HookRunner(plugin as any, makeContext());

		await expect(runner.run()).rejects.toThrow(/Disk full/);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('exhausts the retry loop and falls back to a timestamp-suffixed path', async () => {
		// Every candidate path is reported as occupied AND every create attempt
		// rejects with "already exists" — simulates the worst-case race where
		// concurrent fires keep claiming slots faster than this runner can
		// propose them. The loop should run 8 times against numeric suffixes,
		// then make a 9th attempt against the explicit timestamp fallback.
		const create = vi.fn().mockRejectedValue(new Error('File already exists.'));
		const plugin = createMockPlugin({ createBehaviour: create });
		(plugin.app.vault.getAbstractFileByPath as any).mockReturnValue({ path: 'occupied' });

		const runner = new HookRunner(plugin as any, makeContext());

		await expect(runner.run()).rejects.toThrow(/Failed to write hook output after 9 attempts/);

		// 8 retry attempts + 1 fallback attempt = 9 create calls.
		expect(create).toHaveBeenCalledTimes(9);

		// The final attempt must hit the timestamp-suffixed fallback path. With
		// the day-granular base "Hooks/Runs/test-hook/2026-05-04.md", the fallback
		// shape is "Hooks/Runs/test-hook/2026-05-04-<digits>.md".
		const finalCallPath = create.mock.calls[create.mock.calls.length - 1][0];
		expect(finalCallPath).toMatch(/^Hooks\/Runs\/test-hook\/2026-05-04-\d+\.md$/);
	});
});

describe('HookRunner.run skill propagation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('passes hook.enabledSkills as projectSkills on the request', async () => {
		const generateModelResponse = vi.fn().mockResolvedValue({ markdown: 'ok', toolCalls: [] });
		(GeminiClientFactory.createChatModel as any).mockReturnValue({ generateModelResponse });

		const plugin = createMockPlugin();
		const hook = makeHook({ enabledSkills: ['summarise', 'index-files'] });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		expect(generateModelResponse).toHaveBeenCalledTimes(1);
		const request = generateModelResponse.mock.calls[0][0];
		expect(request.projectSkills).toEqual(['summarise', 'index-files']);
	});

	it('omits projectSkills when enabledSkills is empty (inherit-all default)', async () => {
		const generateModelResponse = vi.fn().mockResolvedValue({ markdown: 'ok', toolCalls: [] });
		(GeminiClientFactory.createChatModel as any).mockReturnValue({ generateModelResponse });

		const plugin = createMockPlugin();
		const runner = new HookRunner(plugin as any, makeContext());

		await runner.run();

		const request = generateModelResponse.mock.calls[0][0];
		expect(request.projectSkills).toBeUndefined();
	});
});

// ─── Action dispatch (PR 3) ──────────────────────────────────────────────────

/**
 * Replace the trigger-file resolver with a TFile-shaped object. The mock
 * `obsidian.TFile` class is empty, so `instanceof` checks rely on this
 * helper to plant the right prototype chain.
 */
function plantFile(plugin: any, path: string, extension = 'md') {
	const Mock = MockTFile as any;
	const file = new Mock();
	file.path = path;
	file.name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
	file.basename = file.name.includes('.') ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name;
	file.extension = extension;
	plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
	return file;
}

describe('HookRunner action: summarize', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('calls summarizer.summarizeFile with the resolved triggering file', async () => {
		const plugin = createMockPlugin();
		const summarizeFile = vi.fn().mockResolvedValue('summary text');
		plugin.summarizer = { summarizeFile };
		const file = plantFile(plugin, 'Notes/foo.md');

		const hook = makeHook({ action: 'summarize', outputPath: undefined });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		expect(summarizeFile).toHaveBeenCalledTimes(1);
		expect(summarizeFile).toHaveBeenCalledWith(file);
	});

	it('skips silently when the triggering file is not present (e.g. file-deleted)', async () => {
		const plugin = createMockPlugin();
		const summarizeFile = vi.fn();
		plugin.summarizer = { summarizeFile };
		// getAbstractFileByPath defaults to the existing-set lookup which
		// returns null for unknown paths — the runner should bail out.

		const hook = makeHook({ action: 'summarize' });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		expect(summarizeFile).not.toHaveBeenCalled();
	});

	it('skips non-markdown files without erroring', async () => {
		const plugin = createMockPlugin();
		const summarizeFile = vi.fn();
		plugin.summarizer = { summarizeFile };
		plantFile(plugin, 'Attachments/photo.png', 'png');

		const hook = makeHook({ action: 'summarize' });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		expect(summarizeFile).not.toHaveBeenCalled();
	});
});

describe('HookRunner action: rewrite', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reads the file, sends a rewrite request, and writes the result back', async () => {
		const generateModelResponse = vi.fn().mockResolvedValue({ markdown: 'rewritten markdown', toolCalls: [] });
		(GeminiClientFactory.createRewriteModel as any).mockReturnValue({ generateModelResponse });
		// Some import paths read the factory through src/api/simple-factory; mirror
		// the model-API mock there so SelectionRewriter sees the same stub.
		const simple = await import('../../src/api/simple-factory');
		(simple.GeminiClientFactory.createRewriteModel as any).mockReturnValue({ generateModelResponse });

		const plugin = createMockPlugin();
		const file = plantFile(plugin, 'Notes/foo.md');
		plugin.app.vault.read = vi.fn().mockResolvedValue('# Original\n\nbody');

		const hook = makeHook({ action: 'rewrite', prompt: 'Rewrite as terse {{trigger}} notes.' });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		// rewriteFile should have read the file, called the model, and modified.
		expect(plugin.app.vault.read).toHaveBeenCalledWith(file);
		expect(generateModelResponse).toHaveBeenCalledTimes(1);
		expect(plugin.app.vault.modify).toHaveBeenCalledWith(file, 'rewritten markdown');
	});

	it('substitutes prompt template variables in the rewrite instruction', async () => {
		const generateModelResponse = vi.fn().mockResolvedValue({ markdown: 'out', toolCalls: [] });
		(GeminiClientFactory.createRewriteModel as any).mockReturnValue({ generateModelResponse });
		const simple = await import('../../src/api/simple-factory');
		(simple.GeminiClientFactory.createRewriteModel as any).mockReturnValue({ generateModelResponse });

		const plugin = createMockPlugin();
		plantFile(plugin, 'Notes/foo.md');

		const hook = makeHook({ action: 'rewrite', prompt: 'Style this {{fileName}}.' });
		const runner = new HookRunner(plugin as any, makeContext(hook));
		await runner.run();

		// SelectionRewriter passes the (rendered) instruction as `userMessage`
		// on the request — assert the variable was expanded.
		const request = generateModelResponse.mock.calls[0][0];
		expect(request.userMessage).toBe('Style this foo.md.');
	});

	it('skips when the file is missing (e.g. file-deleted trigger)', async () => {
		const generateModelResponse = vi.fn().mockResolvedValue({ markdown: 'out', toolCalls: [] });
		(GeminiClientFactory.createRewriteModel as any).mockReturnValue({ generateModelResponse });

		const plugin = createMockPlugin();
		const hook = makeHook({ action: 'rewrite', prompt: 'r' });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		expect(generateModelResponse).not.toHaveBeenCalled();
		expect(plugin.app.vault.modify).not.toHaveBeenCalled();
	});
});

describe('HookRunner action: command', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('dispatches the configured commandId via app.commands.executeCommandById', async () => {
		const plugin = createMockPlugin();
		const hook = makeHook({ action: 'command', commandId: 'editor:save-file', prompt: '' });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await runner.run();

		expect(plugin.app.commands.executeCommandById).toHaveBeenCalledTimes(1);
		expect(plugin.app.commands.executeCommandById).toHaveBeenCalledWith('editor:save-file');
	});

	it('throws when the commandId is missing', async () => {
		const plugin = createMockPlugin();
		const hook = makeHook({ action: 'command', prompt: '' });
		// commandId left undefined — the runner should refuse to fire.
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await expect(runner.run()).rejects.toThrow(/no commandId/);
		expect(plugin.app.commands.executeCommandById).not.toHaveBeenCalled();
	});

	it('throws when executeCommandById returns false (unknown command id)', async () => {
		const plugin = createMockPlugin();
		plugin.app.commands.executeCommandById.mockReturnValue(false);
		const hook = makeHook({ action: 'command', commandId: 'missing-command', prompt: '' });
		const runner = new HookRunner(plugin as any, makeContext(hook));

		await expect(runner.run()).rejects.toThrow(/not found/);
	});
});
