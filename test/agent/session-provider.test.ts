/**
 * Per-session provider (#1679): the `provider` frontmatter key round-trips
 * through SessionHistory/SessionManager, and an unknown value is dropped on
 * load rather than substituted.
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

const logger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() };

describe('session provider frontmatter (#1679)', () => {
	describe('SessionManager.loadSession', () => {
		let sessionManager: SessionManager;
		let mockPlugin: any;

		beforeEach(() => {
			mockPlugin = {
				app: {
					vault: { getAbstractFileByPath: vi.fn() },
					metadataCache: { getFileCache: vi.fn(), getFirstLinkpathDest: vi.fn() },
				},
				settings: { historyFolder: 'gemini-scribe' },
				logger,
			};
			sessionManager = new SessionManager(mockPlugin);
		});

		async function load(provider: unknown) {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/s.md');
			mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
				frontmatter: {
					session_id: 's',
					type: 'agent-session',
					title: 'S',
					provider,
					created: new Date().toISOString(),
					last_active: new Date().toISOString(),
				},
			});
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);
			return sessionManager.loadSession(historyFile.path);
		}

		it('reads a known provider into modelConfig', async () => {
			const session = await load('anthropic');
			expect(session?.modelConfig?.provider).toBe('anthropic');
		});

		it('drops an unknown provider instead of substituting one', async () => {
			const session = await load('mistral');
			expect(session?.modelConfig).toBeUndefined();
		});

		it('ignores a non-string provider value', async () => {
			const session = await load(42);
			expect(session?.modelConfig).toBeUndefined();
		});
	});

	describe('SessionHistory.updateSessionMetadata', () => {
		let sessionHistory: SessionHistory;
		let mockPlugin: any;

		beforeEach(() => {
			mockPlugin = {
				app: {
					vault: { getAbstractFileByPath: vi.fn() },
					fileManager: { processFrontMatter: vi.fn() },
				},
				settings: { chatHistory: true, historyFolder: 'gemini-scribe', userName: 'Tester' },
				logger,
				manifest: { version: '4.15.0' },
			};
			sessionHistory = new SessionHistory(mockPlugin);
		});

		async function save(startingFrontmatter: Record<string, unknown>, modelConfig: any) {
			const historyFile = makeTFile('gemini-scribe/Agent-Sessions/s.md');
			mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(historyFile);
			let captured: any = {};
			mockPlugin.app.fileManager.processFrontMatter.mockImplementation(
				async (_file: any, callback: (fm: any) => void) => {
					const fm: any = { ...startingFrontmatter };
					callback(fm);
					captured = fm;
				}
			);
			await sessionHistory.updateSessionMetadata({
				id: 's',
				type: SessionType.AGENT_SESSION,
				title: 'S',
				context: { contextFiles: [], requireConfirmation: [] },
				created: new Date('2026-01-01T00:00:00Z'),
				lastActive: new Date('2026-01-01T00:00:00Z'),
				historyPath: historyFile.path,
				modelConfig,
			});
			return captured;
		}

		it('writes the pinned provider', async () => {
			const fm = await save({}, { provider: 'ollama' });
			expect(fm.provider).toBe('ollama');
		});

		it('removes the key when the session goes back to the default provider', async () => {
			const fm = await save({ provider: 'ollama' }, {});
			expect(fm).not.toHaveProperty('provider');
		});
	});
});
