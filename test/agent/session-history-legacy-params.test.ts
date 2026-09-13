/**
 * Tolerance test for the settings redesign's temperature/topP removal (§4.3,
 * §8.3 of planning/settings-redesign/design.md).
 *
 * Sessions saved before the redesign may carry `temperature` / `top_p` in
 * their frontmatter, and their history entries may carry the corresponding
 * `| Temperature | … |` / `| Top P | … |` rows in the Message Info table.
 * The requirement (AGENTS.md's session-history parser invariant, and the
 * maintainer's hard requirement in §8.3) is:
 *
 *   1. Those keys/rows are silently IGNORED on load — never surfaced on
 *      `SessionModelConfig` or `ConversationEntryMetadata`.
 *   2. Those frontmatter keys are NEVER rewritten or stripped — a metadata
 *      update on an old session must leave them exactly as they were.
 *
 * A test that only asserts (1) would pass for a buggy implementation that
 * deletes the keys on the next save — the assertion in the second describe
 * block below is on the frontmatter object *after* `updateSessionMetadata`,
 * which is the case that actually catches that bug.
 */
import { SessionManager } from '../../src/agent/session-manager';
import { SessionHistory } from '../../src/agent/session-history';
import { SessionType } from '../../src/types/agent';
import { TFile } from 'obsidian';

vi.mock('../../src/utils/accessed-files', () => ({
	pathToWikilink: vi.fn((path: string) => path),
}));

vi.mock('../../src/utils/format-utils', () => ({
	formatLocalTimestamp: vi.fn((date: Date) => date.toISOString()),
}));

vi.mock('../../src/types/tool-policy', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/types/tool-policy')>();
	return {
		...actual,
		serializeToolPolicy: vi.fn(() => undefined),
	};
});

function makeTFile(path: string): TFile {
	const basename = path.includes('/') ? path.split('/').pop()! : path;
	return Object.assign(new TFile(), {
		path,
		basename,
		stat: { ctime: Date.now(), mtime: Date.now() },
	});
}

describe('Legacy temperature/top_p session params — ignored on load, never rewritten', () => {
	describe('SessionManager.loadSession — ignored on load', () => {
		let sessionManager: SessionManager;
		let mockPlugin: any;

		beforeEach(() => {
			mockPlugin = {
				app: {
					vault: {
						getAbstractFileByPath: vi.fn(),
					},
					metadataCache: {
						getFileCache: vi.fn(),
						getFirstLinkpathDest: vi.fn(),
					},
				},
				settings: { historyFolder: 'gemini-scribe' },
				logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			};
			sessionManager = new SessionManager(mockPlugin);
		});

		it('yields a modelConfig with neither temperature nor topP for an old-format session', async () => {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/old-session.md');

			// Old-format frontmatter: carries the removed temperature/top_p keys
			// alongside a still-supported model field.
			const frontmatter = {
				session_id: 'old-session',
				type: 'agent-session',
				title: 'Old Session',
				model: 'gemini-1.5-pro',
				temperature: 0.9,
				top_p: 0.8,
				created: new Date().toISOString(),
				last_active: new Date().toISOString(),
			};
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter });
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);

			const session = await sessionManager.loadSession(historyFile.path);

			expect(session).not.toBeNull();
			// The supported field still comes through.
			expect(session?.modelConfig?.model).toBe('gemini-1.5-pro');
			// The removed fields never surface on the parsed config.
			expect(session?.modelConfig).not.toHaveProperty('temperature');
			expect(session?.modelConfig).not.toHaveProperty('topP');
		});

		it('yields no modelConfig at all when temperature/top_p are the only frontmatter model keys', async () => {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/old-session-2.md');

			const frontmatter = {
				session_id: 'old-session-2',
				type: 'agent-session',
				title: 'Old Session 2',
				temperature: 0.5,
				top_p: 0.7,
				created: new Date().toISOString(),
				last_active: new Date().toISOString(),
			};
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({ frontmatter });
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);

			const session = await sessionManager.loadSession(historyFile.path);

			// Neither the removed fields nor an empty model/promptTemplate mean
			// there is nothing left to build a config from.
			expect(session?.modelConfig).toBeUndefined();
		});
	});

	describe('SessionHistory — history-entry parsing tolerates legacy Temperature/Top P rows', () => {
		let sessionHistory: SessionHistory;
		let mockPlugin: any;

		beforeEach(() => {
			mockPlugin = {
				app: {
					vault: {
						getAbstractFileByPath: vi.fn(),
						read: vi.fn().mockResolvedValue(''),
					},
					metadataCache: {
						getFileCache: vi.fn().mockReturnValue(null),
					},
					fileManager: {
						processFrontMatter: vi.fn(),
					},
				},
				settings: { chatHistory: true, historyFolder: 'gemini-scribe', userName: 'Tester' },
				logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
				manifest: { version: '4.11.0' },
			};
			sessionHistory = new SessionHistory(mockPlugin);
		});

		it('parses an old-format entry with Temperature/Top P rows without error, dropping both fields', async () => {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/old-session.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);

			// Old-format Message Info table: Model row followed by the removed
			// Temperature/Top P rows, which the parser only ever matched loosely
			// (it regexes for `| Model | ... |`, nothing else) — this fixture pins
			// that tolerance per the AGENTS.md parser invariant.
			const legacy = [
				'## Assistant',
				'',
				'> [!metadata]- Message Info',
				'> | Property | Value |',
				'> | -------- | ----- |',
				'> | Time | 2026-01-01T00:00:00Z |',
				'> | Model | gemini-1.5-pro |',
				'> | Temperature | 0.9 |',
				'> | Top P | 0.8 |',
				'',
				'> [!assistant]+',
				'> Here is the legacy answer.',
				'',
				'---',
			].join('\n');
			mockPlugin.app.vault.read.mockResolvedValue(legacy);

			const session = {
				id: 'session-1',
				type: SessionType.AGENT_SESSION,
				title: 'Old Session',
				context: { contextFiles: [], requireConfirmation: [] },
				created: new Date('2026-01-01T00:00:00Z'),
				lastActive: new Date('2026-01-01T00:00:00Z'),
				historyPath: historyFile.path,
			};

			const result = await sessionHistory.getHistoryForSession(session);

			expect(result).toHaveLength(1);
			expect(result[0].message).toBe('Here is the legacy answer.');
			expect(result[0].model).toBe('gemini-1.5-pro');
			expect(result[0].metadata?.temperature).toBeUndefined();
			expect(result[0].metadata?.topP).toBeUndefined();
		});
	});

	describe('SessionHistory.updateSessionMetadata — never rewrites legacy temperature/top_p', () => {
		let sessionHistory: SessionHistory;
		let mockPlugin: any;

		beforeEach(() => {
			mockPlugin = {
				app: {
					vault: {
						getAbstractFileByPath: vi.fn(),
					},
					fileManager: {
						processFrontMatter: vi.fn(),
					},
				},
				settings: { chatHistory: true, historyFolder: 'gemini-scribe', userName: 'Tester' },
				logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
				manifest: { version: '4.11.0' },
			};
			sessionHistory = new SessionHistory(mockPlugin);
		});

		it('leaves existing frontmatter temperature/top_p keys untouched after a metadata update', async () => {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/old-session.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					// Simulates a session file saved before the settings redesign:
					// the frontmatter already carries the removed keys.
					const fm: any = { temperature: 0.9, top_p: 0.8 };
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = {
				id: 'session-1',
				type: SessionType.AGENT_SESSION,
				title: 'Old Session',
				context: { contextFiles: [], requireConfirmation: [] },
				created: new Date('2026-01-01T00:00:00Z'),
				lastActive: new Date('2026-01-01T00:00:00Z'),
				historyPath: historyFile.path,
				// The session in memory has no modelConfig at all — a naive
				// "delete when absent" implementation would strip the legacy keys
				// here. The correct implementation never touches them either way.
				modelConfig: undefined,
			};

			await sessionHistory.updateSessionMetadata(session);

			// The keys must survive the metadata update, inert.
			expect(capturedFrontmatter.temperature).toBe(0.9);
			expect(capturedFrontmatter.top_p).toBe(0.8);
		});

		it('leaves legacy keys untouched even when the session now has a modelConfig', async () => {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/old-session-2.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);

			let capturedFrontmatter: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = { temperature: 0.4, top_p: 0.6 };
					callback(fm);
					capturedFrontmatter = fm;
				}
			);

			const session = {
				id: 'session-2',
				type: SessionType.AGENT_SESSION,
				title: 'Old Session 2',
				context: { contextFiles: [], requireConfirmation: [] },
				created: new Date('2026-01-01T00:00:00Z'),
				lastActive: new Date('2026-01-01T00:00:00Z'),
				historyPath: historyFile.path,
				modelConfig: { model: 'gemini-2.5-pro' },
			};

			await sessionHistory.updateSessionMetadata(session);

			expect(capturedFrontmatter.model).toBe('gemini-2.5-pro');
			expect(capturedFrontmatter.temperature).toBe(0.4);
			expect(capturedFrontmatter.top_p).toBe(0.6);
		});
	});
});
