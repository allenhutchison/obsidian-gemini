import {
	EAGER_SUBFOLDERS,
	RUNS_SUBFOLDER,
	STATE_FILES,
	STATE_SUBFOLDERS,
	stateFolderPath,
} from '../../src/services/state-folder';

const settings = { historyFolder: 'gemini-scribe' };

describe('stateFolderPath', () => {
	it('returns the state root when given no segments', () => {
		expect(stateFolderPath(settings)).toBe('gemini-scribe');
	});

	it('joins a single subfolder under the state root', () => {
		expect(stateFolderPath(settings, STATE_SUBFOLDERS.agentSessions)).toBe('gemini-scribe/Agent-Sessions');
	});

	it('joins nested segments', () => {
		expect(stateFolderPath(settings, STATE_SUBFOLDERS.scheduledTasks, RUNS_SUBFOLDER)).toBe(
			'gemini-scribe/Scheduled-Tasks/Runs'
		);
		expect(stateFolderPath(settings, STATE_SUBFOLDERS.skills, 'my-skill', 'SKILL.md')).toBe(
			'gemini-scribe/Skills/my-skill/SKILL.md'
		);
	});

	it('normalizes a trailing slash on the configured root', () => {
		expect(stateFolderPath({ historyFolder: 'gemini-scribe/' }, STATE_SUBFOLDERS.prompts)).toBe(
			'gemini-scribe/Prompts'
		);
	});

	it('collapses duplicate slashes from segments that carry their own separators', () => {
		expect(stateFolderPath(settings, `${STATE_SUBFOLDERS.scheduledTasks}/`, RUNS_SUBFOLDER)).toBe(
			'gemini-scribe/Scheduled-Tasks/Runs'
		);
	});

	it('drops empty segments instead of emitting a doubled separator', () => {
		expect(stateFolderPath(settings, '', STATE_SUBFOLDERS.prompts)).toBe('gemini-scribe/Prompts');
	});

	it('handles a nested state root', () => {
		expect(stateFolderPath({ historyFolder: 'vault/state/gemini' }, STATE_SUBFOLDERS.skills)).toBe(
			'vault/state/gemini/Skills'
		);
	});

	it('normalizes an empty root the way Obsidian does, without a leading separator on segments', () => {
		// normalizePath('/Prompts') → 'Prompts'; the guard is that an empty root
		// never produces a vault-absolute path.
		expect(stateFolderPath({ historyFolder: '' }, STATE_SUBFOLDERS.prompts)).toBe('Prompts');
	});
});

describe('the layout constants', () => {
	it('lists exactly the subfolders FolderInitializer creates eagerly', () => {
		expect(EAGER_SUBFOLDERS).toEqual([
			'Agent-Sessions',
			'Background-Tasks',
			'Prompts',
			'Skills',
			'Scheduled-Tasks',
			'Scheduled-Tasks/Runs',
		]);
	});

	it('omits the folders that are created on demand, not eagerly', () => {
		// Hooks is gated on settings.hooksEnabled; History is read-only v3.x legacy.
		expect(EAGER_SUBFOLDERS).not.toContain(STATE_SUBFOLDERS.hooks);
		expect(EAGER_SUBFOLDERS).not.toContain(STATE_SUBFOLDERS.history);
	});

	it('keeps the on-disk names the layout invariant documents', () => {
		expect(STATE_SUBFOLDERS).toEqual({
			agentSessions: 'Agent-Sessions',
			backgroundTasks: 'Background-Tasks',
			prompts: 'Prompts',
			skills: 'Skills',
			scheduledTasks: 'Scheduled-Tasks',
			hooks: 'Hooks',
			history: 'History',
		});
		expect(STATE_FILES).toEqual({
			agentsMemory: 'AGENTS.md',
			examplePrompts: 'example-prompts.json',
			ragIndexCache: 'rag-index-cache.json',
			debugLog: 'debug.log',
			oldDebugLog: 'debug.log.old',
		});
	});
});
