import { describe, test, expect, vi } from 'vitest';
import {
	renameSessionHistoryFile,
	sessionHistoryPathForTitle,
	SESSION_RENAME_ATTEMPTS,
} from '../../src/agent/session-rename';

const SESSIONS_DIR = 'gemini-scribe/Agent-Sessions/';

function makeApp(existingPaths: string[]) {
	const existing = new Set(existingPaths);
	const renameFile = vi.fn(async (_file: unknown, newPath: string) => {
		if (existing.has(newPath)) throw new Error('Destination file already exists!');
		existing.add(newPath);
	});
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => (existing.has(path) ? { path } : null)),
		},
		fileManager: { renameFile },
	} as any;
	return { app, existing, renameFile };
}

function makeLogger() {
	return { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
}

describe('sessionHistoryPathForTitle', () => {
	test('keeps the file in its current folder and sanitizes the title', () => {
		expect(sessionHistoryPathForTitle(`${SESSIONS_DIR}old.md`, 'A/B: notes?')).toBe(`${SESSIONS_DIR}A-B- notes-.md`);
	});

	test('handles a file at the vault root', () => {
		expect(sessionHistoryPathForTitle('old.md', 'New Title')).toBe('New Title.md');
	});
});

describe('renameSessionHistoryFile', () => {
	const oldPath = `${SESSIONS_DIR}Agent Session 1.md`;
	const title = '2026-08-30 Roof Repair';
	const targetPath = `${SESSIONS_DIR}${title}.md`;

	test('renames to the title-derived path when it is free', async () => {
		const { app, renameFile } = makeApp([oldPath]);

		const result = await renameSessionHistoryFile(app, oldPath, title, makeLogger());

		expect(renameFile).toHaveBeenCalledWith(expect.objectContaining({ path: oldPath }), targetPath);
		expect(result).toBe(targetPath);
	});

	test('appends a numeric suffix when another session already holds the name', async () => {
		const { app, renameFile } = makeApp([oldPath, targetPath]);

		const result = await renameSessionHistoryFile(app, oldPath, title, makeLogger());

		const suffixed = `${SESSIONS_DIR}${title}-1.md`;
		expect(renameFile).toHaveBeenCalledWith(expect.anything(), suffixed);
		expect(result).toBe(suffixed);
	});

	test('retries when a concurrent writer takes the target mid-flight', async () => {
		const { app, existing, renameFile } = makeApp([oldPath]);
		renameFile.mockImplementationOnce(async () => {
			existing.add(targetPath);
			throw new Error('Destination file already exists!');
		});

		const result = await renameSessionHistoryFile(app, oldPath, title, makeLogger());

		expect(renameFile).toHaveBeenCalledTimes(2);
		expect(result).toBe(`${SESSIONS_DIR}${title}-1.md`);
	});

	test('gives up and warns after repeated mid-flight collisions', async () => {
		const { app, renameFile } = makeApp([oldPath]);
		renameFile.mockRejectedValue(new Error('Destination file already exists!'));
		const logger = makeLogger();

		const result = await renameSessionHistoryFile(app, oldPath, title, logger);

		expect(renameFile).toHaveBeenCalledTimes(SESSION_RENAME_ATTEMPTS);
		expect(result).toBe(oldPath);
		expect(logger.warn).toHaveBeenCalled();
	});

	test('propagates non-collision rename errors without retrying', async () => {
		const { app, renameFile } = makeApp([oldPath]);
		renameFile.mockRejectedValue(new Error('EACCES: permission denied'));

		await expect(renameSessionHistoryFile(app, oldPath, title, makeLogger())).rejects.toThrow('EACCES');
		expect(renameFile).toHaveBeenCalledTimes(1);
	});

	test('skips the rename when the file already carries the title-derived name', async () => {
		const { app, renameFile } = makeApp([targetPath]);

		const result = await renameSessionHistoryFile(app, targetPath, title, makeLogger());

		expect(renameFile).not.toHaveBeenCalled();
		expect(result).toBe(targetPath);
	});

	test('skips the rename when the history file is missing', async () => {
		const { app, renameFile } = makeApp([]);

		const result = await renameSessionHistoryFile(app, oldPath, title, makeLogger());

		expect(renameFile).not.toHaveBeenCalled();
		expect(result).toBe(oldPath);
	});
});
