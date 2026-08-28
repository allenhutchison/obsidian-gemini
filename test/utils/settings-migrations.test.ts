import { migrateInteractionsApiDefault, normalizeStateFolderPath } from '../../src/utils/settings-migrations';
import { shouldExcludePath } from '../../src/utils/file-utils';

describe('migrateInteractionsApiDefault', () => {
	it('flips an existing opt-in-era install (persisted false, no marker) to on and marks it', () => {
		const settings = {
			useInteractionsApi: false as boolean,
			useInteractionsApiMigrated: undefined as boolean | undefined,
		};
		const migrated = migrateInteractionsApiDefault(settings, { useInteractionsApi: false });

		expect(migrated).toBe(true);
		expect(settings.useInteractionsApi).toBe(true);
		expect(settings.useInteractionsApiMigrated).toBe(true);
	});

	it('does not re-flip a user who turned the transport back off after migrating', () => {
		const settings = { useInteractionsApi: false as boolean, useInteractionsApiMigrated: true };
		const migrated = migrateInteractionsApiDefault(settings, {
			useInteractionsApi: false,
			useInteractionsApiMigrated: true,
		});

		expect(migrated).toBe(false);
		expect(settings.useInteractionsApi).toBe(false);
	});

	it('leaves an install that already had the transport on untouched', () => {
		const settings = {
			useInteractionsApi: true as boolean,
			useInteractionsApiMigrated: undefined as boolean | undefined,
		};
		const migrated = migrateInteractionsApiDefault(settings, { useInteractionsApi: true });

		expect(migrated).toBe(false);
		expect(settings.useInteractionsApi).toBe(true);
	});

	it('does not migrate a fresh install (no persisted value)', () => {
		const settings = { useInteractionsApi: true as boolean, useInteractionsApiMigrated: true };
		expect(migrateInteractionsApiDefault(settings, {})).toBe(false);
		expect(migrateInteractionsApiDefault(settings, null)).toBe(false);
		expect(migrateInteractionsApiDefault(settings, undefined)).toBe(false);
	});
});

describe('normalizeStateFolderPath', () => {
	it('strips a hand-typed trailing slash', () => {
		const settings = { historyFolder: 'gemini-scribe/' };
		expect(normalizeStateFolderPath(settings)).toBe(true);
		expect(settings.historyFolder).toBe('gemini-scribe');
	});

	it('collapses duplicate internal slashes', () => {
		const settings = { historyFolder: 'gemini-scribe//Agent-Sessions' };
		expect(normalizeStateFolderPath(settings)).toBe(true);
		expect(settings.historyFolder).toBe('gemini-scribe/Agent-Sessions');
	});

	it('strips a leading slash and trims whitespace', () => {
		const settings = { historyFolder: '  /gemini-scribe/ ' };
		expect(normalizeStateFolderPath(settings)).toBe(true);
		expect(settings.historyFolder).toBe('gemini-scribe');
	});

	it('leaves a clean value untouched', () => {
		const settings = { historyFolder: 'gemini-scribe' };
		expect(normalizeStateFolderPath(settings)).toBe(false);
		expect(settings.historyFolder).toBe('gemini-scribe');
	});

	it('leaves an empty value alone (broader validation is out of scope, #1374)', () => {
		const settings = { historyFolder: '' };
		expect(normalizeStateFolderPath(settings)).toBe(false);

		const whitespaceOnly = { historyFolder: '   ' };
		expect(normalizeStateFolderPath(whitespaceOnly)).toBe(false);
	});

	it('a repaired setting regains exclusion (#1374 end-to-end)', () => {
		// The failure mode: a trailing-slash folder defeats isPathInFolder's
		// prefix check, so nothing is "inside" the state folder and exclusions
		// fail open. After the load boundary repairs the value, exclusion works.
		const before = { historyFolder: 'gemini-scribe/' };
		expect(shouldExcludePath('gemini-scribe/Agent-Sessions/run.md', before.historyFolder, '.obsidian')).toBe(false);

		normalizeStateFolderPath(before);
		expect(shouldExcludePath('gemini-scribe/Agent-Sessions/run.md', before.historyFolder, '.obsidian')).toBe(true);
		expect(shouldExcludePath('gemini-scribe', before.historyFolder, '.obsidian')).toBe(true);
		expect(shouldExcludePath('gemini-scribe-backup', before.historyFolder, '.obsidian')).toBe(false);
	});
});
