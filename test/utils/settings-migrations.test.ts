import { migrateInteractionsApiDefault } from '../../src/utils/settings-migrations';

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
