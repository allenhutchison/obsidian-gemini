import type { Mock } from 'vitest';
import {
	resolveOutputPath,
	resolveUniquePath,
	resolveTimestampPath,
	isAlreadyExistsError,
	writeHeadlessOutput,
} from '../../src/services/headless-run-output';

// normalizePath here mirrors the real helper closely enough for path assertions
// (it collapses nothing we exercise); the runner-facing behavior we care about is
// token substitution, not path normalization.
vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p,
	Vault: class {},
}));

// vi.mock factories are hoisted above the file body, so the spy must be created
// in a hoisted scope (and mock-prefixed) for the factory to reference it safely.
const { mockEnsureFolderExists } = vi.hoisted(() => ({
	mockEnsureFolderExists: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/file-utils', () => ({
	ensureFolderExists: mockEnsureFolderExists,
}));

/** Build a minimal Vault stub with controllable existence + create behavior. */
function makeVault(opts?: { exists?: (path: string) => boolean; create?: Mock }) {
	const exists = opts?.exists ?? (() => false);
	return {
		getAbstractFileByPath: vi.fn((p: string) => (exists(p) ? { path: p } : null)),
		create: opts?.create ?? vi.fn().mockResolvedValue(undefined),
	} as any;
}

beforeEach(() => {
	mockEnsureFolderExists.mockClear();
});

describe('resolveOutputPath', () => {
	it('substitutes {slug} and {date} tokens', () => {
		expect(resolveOutputPath('reports/{slug}/{date}.md', { slug: 'daily', date: '2026-04-18' })).toBe(
			'reports/daily/2026-04-18.md'
		);
	});

	it('substitutes the hook-only {fileName} token', () => {
		expect(
			resolveOutputPath('Hooks/{slug}/{fileName}-{date}.md', {
				slug: 'sum',
				date: '2026-04-18',
				fileName: 'foo.md',
			})
		).toBe('Hooks/sum/foo.md-2026-04-18.md');
	});

	it('leaves an unreferenced template untouched', () => {
		expect(resolveOutputPath('static/path.md', { slug: 's', date: 'd' })).toBe('static/path.md');
	});

	it('inserts token values verbatim (no $-sequence interpretation)', () => {
		// A naive String.prototype.replace would treat `$&` as the matched
		// substring; split/join must insert it literally.
		expect(resolveOutputPath('out/{slug}.md', { slug: 'a$&b$$c' })).toBe('out/a$&b$$c.md');
	});
});

describe('resolveUniquePath', () => {
	it('returns the base path when it is free', () => {
		const vault = makeVault({ exists: () => false });
		expect(resolveUniquePath(vault, 'notes/2026-04-18.md')).toBe('notes/2026-04-18.md');
	});

	it('appends -1 when the base is taken', () => {
		const vault = makeVault({ exists: (p) => p === 'notes/2026-04-18.md' });
		expect(resolveUniquePath(vault, 'notes/2026-04-18.md')).toBe('notes/2026-04-18-1.md');
	});

	it('skips consecutive taken suffixes', () => {
		const taken = new Set(['notes/x.md', 'notes/x-1.md', 'notes/x-2.md']);
		const vault = makeVault({ exists: (p) => taken.has(p) });
		expect(resolveUniquePath(vault, 'notes/x.md')).toBe('notes/x-3.md');
	});

	it('handles extensionless paths', () => {
		const vault = makeVault({ exists: (p) => p === 'notes/README' });
		expect(resolveUniquePath(vault, 'notes/README')).toBe('notes/README-1');
	});

	it('ignores dots in parent folders (suffix goes on the last segment)', () => {
		const vault = makeVault({ exists: (p) => p === 'my.notes/README' });
		expect(resolveUniquePath(vault, 'my.notes/README')).toBe('my.notes/README-1');
	});

	it('falls back to a timestamp suffix after 99 collisions', () => {
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		// Base plus -1..-99 are all taken; only the timestamp candidate is free.
		const vault = makeVault({ exists: (p) => !p.includes('1700000000000') });
		expect(resolveUniquePath(vault, 'notes/x.md')).toBe('notes/x-1700000000000.md');
		nowSpy.mockRestore();
	});
});

describe('resolveTimestampPath', () => {
	it('inserts Date.now() before the extension', () => {
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		expect(resolveTimestampPath('notes/x.md')).toBe('notes/x-1700000000000.md');
		nowSpy.mockRestore();
	});
});

describe('isAlreadyExistsError', () => {
	it('matches the canonical Obsidian message (case-insensitive)', () => {
		expect(isAlreadyExistsError(new Error('File already exists.'))).toBe(true);
		expect(isAlreadyExistsError(new Error('Boom: ALREADY EXISTS at path'))).toBe(true);
	});

	it('returns false for unrelated errors and non-Error values', () => {
		expect(isAlreadyExistsError(new Error('permission denied'))).toBe(false);
		expect(isAlreadyExistsError('already exists')).toBe(false);
		expect(isAlreadyExistsError(null)).toBe(false);
	});
});

describe('writeHeadlessOutput — no retry (scheduled-task shape)', () => {
	it('ensures the parent folder, writes header+content to a unique path, and returns it', async () => {
		const create = vi.fn().mockResolvedValue(undefined);
		const vault = makeVault({ exists: () => false, create });

		const written = await writeHeadlessOutput({
			vault,
			outputPath: 'Runs/task/2026-04-18.md',
			header: '---\nscheduled_task: "task"\n---\n\n',
			content: 'Body text',
			folderLabel: 'scheduled task output folder',
		});

		expect(written).toBe('Runs/task/2026-04-18.md');
		expect(mockEnsureFolderExists).toHaveBeenCalledWith(vault, 'Runs/task', 'scheduled task output folder', undefined);
		expect(create).toHaveBeenCalledWith('Runs/task/2026-04-18.md', '---\nscheduled_task: "task"\n---\n\nBody text');
	});

	it('writes to a suffixed path when the resolved path is taken', async () => {
		const create = vi.fn().mockResolvedValue(undefined);
		const vault = makeVault({ exists: (p) => p === 'Runs/task/2026-04-18.md', create });

		const written = await writeHeadlessOutput({
			vault,
			outputPath: 'Runs/task/2026-04-18.md',
			header: 'H\n',
			content: 'B',
			folderLabel: 'scheduled task output folder',
		});

		expect(written).toBe('Runs/task/2026-04-18-1.md');
		expect(create).toHaveBeenCalledWith('Runs/task/2026-04-18-1.md', 'H\nB');
	});

	it('skips folder creation for a top-level (folderless) path', async () => {
		const vault = makeVault({ exists: () => false });
		await writeHeadlessOutput({ vault, outputPath: 'out.md', header: 'H\n', content: 'B', folderLabel: 'x' });
		expect(mockEnsureFolderExists).not.toHaveBeenCalled();
	});

	it('propagates a non-"already exists" create error unchanged', async () => {
		const create = vi.fn().mockRejectedValue(new Error('permission denied'));
		const vault = makeVault({ exists: () => false, create });
		await expect(
			writeHeadlessOutput({ vault, outputPath: 'out.md', header: 'H\n', content: 'B', folderLabel: 'x' })
		).rejects.toThrow('permission denied');
	});
});

describe('writeHeadlessOutput — retry (hook shape)', () => {
	const retry = { limit: 8, label: '[HookRunner]', outputNoun: 'hook output' };

	it('lands on the next free suffix after a concurrent "already exists" race', async () => {
		// getAbstractFileByPath sees an empty slot, but the first create loses the
		// race and rejects with "already exists"; the second create succeeds.
		const create = vi.fn().mockRejectedValueOnce(new Error('File already exists.')).mockResolvedValueOnce(undefined);
		// After the base is "created" by the racer, treat it as occupied so
		// resolveUniquePath advances to -1 on the retry.
		let baseTaken = false;
		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => (baseTaken && p === 'Hooks/out.md' ? { path: p } : null)),
			create: vi.fn((p: string, c: string) => {
				const result = create(p, c);
				baseTaken = true;
				return result;
			}),
		} as any;

		const written = await writeHeadlessOutput({
			vault,
			outputPath: 'Hooks/out.md',
			header: 'H\n',
			content: 'B',
			folderLabel: 'hook output folder',
			retry,
		});

		expect(written).toBe('Hooks/out-1.md');
		expect(create).toHaveBeenCalledTimes(2);
	});

	it('falls back to a timestamp path once the retry budget is spent', async () => {
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		// Every numbered candidate collides; only the timestamp path succeeds.
		const create = vi.fn((p: string) => {
			if (p.includes('1700000000000')) return Promise.resolve(undefined);
			return Promise.reject(new Error('File already exists.'));
		});
		const vault = makeVault({ exists: () => false, create });

		const written = await writeHeadlessOutput({
			vault,
			outputPath: 'Hooks/out.md',
			header: 'H\n',
			content: 'B',
			folderLabel: 'hook output folder',
			retry,
		});

		expect(written).toBe('Hooks/out-1700000000000.md');
		nowSpy.mockRestore();
	});

	it('throws a labeled failure after all retries and the fallback collide', async () => {
		const create = vi.fn().mockRejectedValue(new Error('File already exists.'));
		const vault = makeVault({ exists: () => false, create });

		await expect(
			writeHeadlessOutput({
				vault,
				outputPath: 'Hooks/out.md',
				header: 'H\n',
				content: 'B',
				folderLabel: 'hook output folder',
				retry,
			})
		).rejects.toThrow(/\[HookRunner\] Failed to write hook output after 9 attempts/);
	});
});
