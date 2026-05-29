import { describe, it, expect, vi, type Mock } from 'vitest';
import {
	JsonSidecarStateStore,
	extractMarkdownBody,
	migrateLegacyEnabledTools,
	parseMaxIterations,
	purgeOrphanState,
	resolveFeatureToolPolicy,
} from '../../src/services/feature-definition';
import { PolicyPreset } from '../../src/types/tool-policy';

// feature-definition.ts pulls findFrontmatterEndOffset from skill-manager;
// mock it so the heavy skill-manager module is not loaded and
// extractMarkdownBody's own slice/trim logic can be exercised in isolation.
vi.mock('../../src/services/skill-manager', () => ({
	findFrontmatterEndOffset: vi.fn(),
}));

import { findFrontmatterEndOffset } from '../../src/services/skill-manager';

// ─── JsonSidecarStateStore ───────────────────────────────────────────────────

function makeStoreFixture() {
	const files: Record<string, string> = {};
	const logger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const adapter = {
		exists: vi.fn(async (p: string) => p in files),
		read: vi.fn(async (p: string) => {
			if (!(p in files)) throw new Error(`ENOENT: ${p}`);
			return files[p];
		}),
		write: vi.fn(async (p: string, content: string) => {
			files[p] = content;
		}),
	};
	const plugin = { app: { vault: { adapter } }, logger };
	return { plugin, files, adapter, logger };
}

describe('JsonSidecarStateStore', () => {
	describe('load', () => {
		it('returns an empty map when the sidecar file does not exist', async () => {
			const { plugin } = makeStoreFixture();
			const store = new JsonSidecarStateStore(plugin as any, () => 'state.json', '[Test]');
			expect(await store.load()).toEqual({});
		});

		it('parses the sidecar JSON when the file exists', async () => {
			const { plugin, files } = makeStoreFixture();
			files['state.json'] = JSON.stringify({ 'task-a': { nextRunAt: '2026-05-22' } });
			const store = new JsonSidecarStateStore(plugin as any, () => 'state.json', '[Test]');
			expect(await store.load()).toEqual({ 'task-a': { nextRunAt: '2026-05-22' } });
		});

		it('falls back to an empty map and warns when the JSON is corrupt', async () => {
			const { plugin, files, logger } = makeStoreFixture();
			files['state.json'] = 'not valid json {{{';
			const store = new JsonSidecarStateStore(plugin as any, () => 'state.json', '[Test]');
			expect(await store.load()).toEqual({});
			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load state'), expect.anything());
		});

		it('falls back to an empty map when the JSON parses to a non-object value', async () => {
			const { plugin, files, logger } = makeStoreFixture();
			const store = new JsonSidecarStateStore(plugin as any, () => 'state.json', '[Test]');

			// null, array, and primitives are all valid JSON but unsafe to treat
			// as slug-keyed state — load must catch them and fall back to {}.
			files['state.json'] = JSON.stringify(null);
			expect(await store.load()).toEqual({});
			files['state.json'] = JSON.stringify([{ slug: 'oops' }]);
			expect(await store.load()).toEqual({});
			files['state.json'] = JSON.stringify(42);
			expect(await store.load()).toEqual({});

			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load state'), expect.anything());
		});
	});

	describe('save', () => {
		it('writes the state as pretty-printed JSON to the resolved path', async () => {
			const { plugin, files, adapter } = makeStoreFixture();
			const store = new JsonSidecarStateStore(plugin as any, () => 'state.json', '[Test]');
			await store.save({ hook: { consecutiveFailures: 2 } } as any);
			const expected = JSON.stringify({ hook: { consecutiveFailures: 2 } }, null, 2);
			expect(adapter.write).toHaveBeenCalledWith('state.json', expected);
			expect(files['state.json']).toBe(expected);
		});

		it('logs an error but does not throw when the write fails', async () => {
			const { plugin, adapter, logger } = makeStoreFixture();
			adapter.write.mockRejectedValueOnce(new Error('disk full'));
			const store = new JsonSidecarStateStore(plugin as any, () => 'state.json', '[Test]');
			await expect(store.save({} as any)).resolves.toBeUndefined();
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to save state'), expect.anything());
		});
	});

	it('resolves the sidecar path lazily on every call', async () => {
		const { plugin, files } = makeStoreFixture();
		let path = 'first.json';
		const store = new JsonSidecarStateStore(plugin as any, () => path, '[Test]');
		await store.save({ a: 1 } as any);
		path = 'second.json';
		await store.save({ b: 2 } as any);
		expect(Object.keys(files).sort()).toEqual(['first.json', 'second.json']);
	});
});

// ─── extractMarkdownBody ─────────────────────────────────────────────────────

describe('extractMarkdownBody', () => {
	it('trims and returns the whole content when there is no frontmatter', () => {
		(findFrontmatterEndOffset as Mock).mockReturnValue(undefined);
		expect(extractMarkdownBody('  \n  Body without frontmatter.\n  ')).toBe('Body without frontmatter.');
	});

	it('returns the trimmed slice after the frontmatter offset', () => {
		// '---\nx: 1\n---' is 12 chars; offset 12 is just past the closing delimiter.
		const content = '---\nx: 1\n---\n\n  The body.  \n';
		(findFrontmatterEndOffset as Mock).mockReturnValue(12);
		expect(extractMarkdownBody(content)).toBe('The body.');
	});
});

// ─── resolveFeatureToolPolicy ────────────────────────────────────────────────

describe('resolveFeatureToolPolicy', () => {
	it('returns undefined when neither toolPolicy nor enabledTools is present', () => {
		expect(resolveFeatureToolPolicy({ schedule: 'daily' })).toBeUndefined();
	});

	it('parses the canonical toolPolicy block', () => {
		expect(resolveFeatureToolPolicy({ toolPolicy: { preset: 'read_only' } })).toEqual({
			preset: PolicyPreset.READ_ONLY,
		});
	});

	it('falls back to the legacy enabledTools array', () => {
		expect(resolveFeatureToolPolicy({ enabledTools: ['read_only'] })).toEqual({
			preset: PolicyPreset.READ_ONLY,
		});
	});

	it('prefers the toolPolicy block over a legacy enabledTools array', () => {
		expect(resolveFeatureToolPolicy({ toolPolicy: { preset: 'edit_mode' }, enabledTools: ['read_only'] })).toEqual({
			preset: PolicyPreset.EDIT_MODE,
		});
	});
});

// ─── migrateLegacyEnabledTools ───────────────────────────────────────────────

function makeMigrateFixture() {
	const logger = { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const modify = vi.fn(async () => {});
	const plugin = { app: { vault: { modify } }, logger };
	const file = { path: 'gemini-scribe/Hooks/legacy.md' };
	return { plugin, file, modify, logger };
}

describe('migrateLegacyEnabledTools', () => {
	it('rewrites the file when it carries legacy enabledTools and no toolPolicy', async () => {
		const { plugin, file, modify } = makeMigrateFixture();
		const serialize = vi.fn(() => 'MIGRATED CONTENT');
		const migration = migrateLegacyEnabledTools(
			plugin as any,
			file as any,
			{ enabledTools: ['read_only'] },
			serialize,
			'[Test]'
		);
		expect(migration).toBeInstanceOf(Promise);
		await migration;
		expect(serialize).toHaveBeenCalledTimes(1);
		expect(modify).toHaveBeenCalledWith(file, 'MIGRATED CONTENT');
	});

	// The no-op cases must return undefined synchronously (no promise) so a
	// caller can skip the `await` and not add a microtask hop to a parse that
	// has nothing to migrate.
	it('returns undefined and does nothing when there is no enabledTools frontmatter', () => {
		const { plugin, file, modify } = makeMigrateFixture();
		const serialize = vi.fn(() => 'X');
		expect(
			migrateLegacyEnabledTools(plugin as any, file as any, { schedule: 'daily' }, serialize, '[Test]')
		).toBeUndefined();
		expect(serialize).not.toHaveBeenCalled();
		expect(modify).not.toHaveBeenCalled();
	});

	it('returns undefined when a canonical toolPolicy block is already present', () => {
		const { plugin, file, modify } = makeMigrateFixture();
		const serialize = vi.fn(() => 'X');
		expect(
			migrateLegacyEnabledTools(
				plugin as any,
				file as any,
				{ enabledTools: ['read_only'], toolPolicy: { preset: 'read_only' } },
				serialize,
				'[Test]'
			)
		).toBeUndefined();
		expect(serialize).not.toHaveBeenCalled();
		expect(modify).not.toHaveBeenCalled();
	});

	it('swallows write failures and warns', async () => {
		const { plugin, file, modify, logger } = makeMigrateFixture();
		modify.mockRejectedValueOnce(new Error('read-only vault'));
		await migrateLegacyEnabledTools(plugin as any, file as any, { enabledTools: ['x'] }, () => 'C', '[Test]');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('legacy enabledTools migration failed'),
			expect.anything()
		);
	});
});

// ─── purgeOrphanState ────────────────────────────────────────────────────────

describe('purgeOrphanState', () => {
	it('deletes entries whose slug is not known and returns them', () => {
		const state: Record<string, number> = { keep: 1, orphan: 2, alsoKeep: 3 };
		const purged = purgeOrphanState(state, (slug) => slug === 'keep' || slug === 'alsoKeep');
		expect(purged).toEqual(['orphan']);
		expect(state).toEqual({ keep: 1, alsoKeep: 3 });
	});

	it('returns an empty array and leaves state untouched when every slug is known', () => {
		const state = { a: 1, b: 2 };
		expect(purgeOrphanState(state, () => true)).toEqual([]);
		expect(state).toEqual({ a: 1, b: 2 });
	});

	it('returns an empty array for an empty state map', () => {
		expect(purgeOrphanState({}, () => false)).toEqual([]);
	});
});

// ─── parseMaxIterations ──────────────────────────────────────────────────────

describe('parseMaxIterations', () => {
	it('accepts positive integers (number or numeric string)', () => {
		expect(parseMaxIterations(50)).toBe(50);
		expect(parseMaxIterations('30')).toBe(30);
		expect(parseMaxIterations(1)).toBe(1);
	});

	it('rejects non-positive, non-integer, and non-numeric values', () => {
		expect(parseMaxIterations(0)).toBeUndefined();
		expect(parseMaxIterations(-5)).toBeUndefined();
		expect(parseMaxIterations(2.5)).toBeUndefined();
		expect(parseMaxIterations('abc')).toBeUndefined();
		expect(parseMaxIterations(undefined)).toBeUndefined();
		expect(parseMaxIterations(null)).toBeUndefined();
		expect(parseMaxIterations('')).toBeUndefined();
	});
});
