import { getSessionRecallTools } from '../../src/tools/session-recall-tool';
import { Tool, ToolExecutionContext } from '../../src/tools/types';

function makeSession(overrides: Partial<any> = {}): any {
	return {
		id: 'session-' + Math.random().toString(36).slice(2),
		title: 'Untitled session',
		historyPath: 'History/untitled.md',
		lastActive: new Date('2025-01-01T00:00:00Z'),
		accessedFiles: undefined,
		context: { contextFiles: [] },
		projectPath: undefined,
		...overrides,
	};
}

function makeContext(pluginOverrides: any = {}, session: any = null): ToolExecutionContext {
	const basePlugin: any = {
		sessionManager: {
			getRecentAgentSessions: jest.fn().mockResolvedValue([]),
		},
		projectManager: undefined,
		logger: {
			log: jest.fn(),
			debug: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
		},
	};
	return {
		plugin: { ...basePlugin, ...pluginOverrides },
		session,
	} as unknown as ToolExecutionContext;
}

function getTool(): Tool {
	const tools = getSessionRecallTools();
	const tool = tools.find((t) => t.name === 'recall_sessions');
	if (!tool) throw new Error('recall_sessions tool not registered');
	return tool;
}

describe('RecallSessionsTool', () => {
	it('returns sessions sorted by lastActive descending', async () => {
		const older = makeSession({ id: 'older', title: 'Older', lastActive: new Date('2025-01-01T00:00:00Z') });
		const newest = makeSession({ id: 'newest', title: 'Newest', lastActive: new Date('2025-03-01T00:00:00Z') });
		const middle = makeSession({ id: 'middle', title: 'Middle', lastActive: new Date('2025-02-01T00:00:00Z') });

		// Intentionally out-of-order input — tool must sort.
		const ctx = makeContext({
			sessionManager: { getRecentAgentSessions: jest.fn().mockResolvedValue([older, newest, middle]) },
		});

		const result = await getTool().execute({}, ctx);
		expect(result.success).toBe(true);
		const titles = (result.data as any).sessions.map((s: any) => s.title);
		expect(titles).toEqual(['Newest', 'Middle', 'Older']);
	});

	it('excludes the currently active session from results', async () => {
		const current = makeSession({ id: 'current', title: 'Current' });
		const other = makeSession({ id: 'other', title: 'Other' });
		const ctx = makeContext(
			{ sessionManager: { getRecentAgentSessions: jest.fn().mockResolvedValue([current, other]) } },
			current
		);

		const result = await getTool().execute({}, ctx);
		expect(result.success).toBe(true);
		const ids = (result.data as any).sessions.map((s: any) => s.title);
		expect(ids).toEqual(['Other']);
	});

	it('clamps the limit parameter to [1, 50]', async () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			makeSession({ id: `s${i}`, title: `Session ${i}`, lastActive: new Date(2025, 0, i + 1) })
		);
		const ctx = makeContext({
			sessionManager: { getRecentAgentSessions: jest.fn().mockResolvedValue(many) },
		});

		const overLimit = await getTool().execute({ limit: 9999 }, ctx);
		expect((overLimit.data as any).sessions.length).toBeLessThanOrEqual(50);

		const underLimit = await getTool().execute({ limit: -5 }, ctx);
		expect((underLimit.data as any).sessions.length).toBeGreaterThanOrEqual(1);
	});

	it('filters by filePath via accessedFiles (case-insensitive substring)', async () => {
		const matching = makeSession({
			id: 'a',
			title: 'Has file',
			accessedFiles: new Set<string>(['Notes/MeetingNotes.md']),
		});
		const nonMatching = makeSession({
			id: 'b',
			title: 'No file',
			accessedFiles: new Set<string>(['other.md']),
		});
		const ctx = makeContext({
			sessionManager: { getRecentAgentSessions: jest.fn().mockResolvedValue([matching, nonMatching]) },
		});

		const result = await getTool().execute({ filePath: 'meetingnotes' }, ctx);
		expect(result.success).toBe(true);
		const titles = (result.data as any).sessions.map((s: any) => s.title);
		expect(titles).toEqual(['Has file']);
	});

	it('filters by title query (case-insensitive substring)', async () => {
		const a = makeSession({ id: 'a', title: 'Planning Q1 goals' });
		const b = makeSession({ id: 'b', title: 'Bug triage' });
		const ctx = makeContext({
			sessionManager: { getRecentAgentSessions: jest.fn().mockResolvedValue([a, b]) },
		});

		const result = await getTool().execute({ query: 'planning' }, ctx);
		expect(result.success).toBe(true);
		const titles = (result.data as any).sessions.map((s: any) => s.title);
		expect(titles).toEqual(['Planning Q1 goals']);
	});

	it('continues filtering by project even if one project lookup throws (allSettled)', async () => {
		const bad = makeSession({ id: 'bad', title: 'Broken', projectPath: 'Projects/broken.md' });
		const good = makeSession({ id: 'good', title: 'Good', projectPath: 'Projects/good.md' });
		const otherMatch = makeSession({
			id: 'other',
			title: 'Path match',
			projectPath: 'Projects/widget.md', // matches substring "widget" even without lookup
		});

		const getProject = jest.fn(async (path: string) => {
			if (path === 'Projects/broken.md') throw new Error('unreadable project');
			if (path === 'Projects/good.md') return { config: { name: 'WidgetProj' } };
			if (path === 'Projects/widget.md') return { config: { name: 'OtherName' } };
			return null;
		});

		const ctx = makeContext({
			sessionManager: { getRecentAgentSessions: jest.fn().mockResolvedValue([bad, good, otherMatch]) },
			projectManager: { getProject },
		});

		const result = await getTool().execute({ project: 'widget' }, ctx);
		expect(result.success).toBe(true);
		const titles = (result.data as any).sessions.map((s: any) => s.title).sort();
		// `bad` must be excluded (lookup threw), `good` matches via project name,
		// `otherMatch` matches via substring on projectPath.
		expect(titles).toEqual(['Good', 'Path match']);
	});

	it('returns empty list gracefully when sessionManager has no sessions', async () => {
		const ctx = makeContext();
		const result = await getTool().execute({}, ctx);
		expect(result.success).toBe(true);
		expect((result.data as any).sessions).toEqual([]);
		expect((result.data as any).count).toBe(0);
	});
});
