import { describe, it, expect } from 'vitest';
import { globToRegExp, matchesGlob, matchesFrontmatterFilter } from '../../src/services/hook-matcher';

// ─── Matcher / condition helpers ───────────────────────────────────────────────

describe('globToRegExp', () => {
	it('matches exact paths literally', () => {
		expect(globToRegExp('Daily/2026-05-04.md').test('Daily/2026-05-04.md')).toBe(true);
		expect(globToRegExp('Daily/2026-05-04.md').test('Daily/2026-05-05.md')).toBe(false);
	});

	it('* matches a single segment', () => {
		expect(globToRegExp('Daily/*.md').test('Daily/2026-05-04.md')).toBe(true);
		expect(globToRegExp('Daily/*.md').test('Daily/sub/2026-05-04.md')).toBe(false);
	});

	it('** matches across path separators', () => {
		expect(globToRegExp('Daily/**/*.md').test('Daily/2026/05/04.md')).toBe(true);
		expect(globToRegExp('**/notes.md').test('a/b/c/notes.md')).toBe(true);
	});

	it('escapes regex metacharacters in literals', () => {
		expect(globToRegExp('a.b+c.md').test('a.b+c.md')).toBe(true);
		expect(globToRegExp('a.b+c.md').test('aXbYc.md')).toBe(false);
	});
});

describe('matchesGlob', () => {
	it('returns true when no glob is provided', () => {
		expect(matchesGlob('any/path.md', undefined)).toBe(true);
	});

	it('applies the compiled glob', () => {
		expect(matchesGlob('Daily/2026-05-04.md', 'Daily/*.md')).toBe(true);
		expect(matchesGlob('Notes/2026-05-04.md', 'Daily/*.md')).toBe(false);
	});
});

describe('matchesFrontmatterFilter', () => {
	it('passes when no filter is provided', () => {
		expect(matchesFrontmatterFilter({ x: 1 }, undefined)).toBe(true);
	});

	it('rejects when frontmatter is missing but filter requires keys', () => {
		expect(matchesFrontmatterFilter(undefined, { x: 1 })).toBe(false);
	});

	it('matches every key/value', () => {
		expect(matchesFrontmatterFilter({ a: 1, b: 'x' }, { a: 1 })).toBe(true);
		expect(matchesFrontmatterFilter({ a: 2 }, { a: 1 })).toBe(false);
	});
});
