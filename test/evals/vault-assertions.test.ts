import { describe, it, expect } from 'vitest';
import { evaluateVaultAssertions, vaultAssertionPaths } from '../../evals/lib/vault-assertions.mjs';

const file = (content: string, frontmatter: any = null) => ({ exists: true, content, frontmatter });
const missing = { exists: false, content: null, frontmatter: null };

describe('evaluateVaultAssertions — fileExists / fileAbsent', () => {
	it('fileExists passes when the file is present', () => {
		const r = evaluateVaultAssertions([{ type: 'fileExists', path: 'a.md' }], { 'a.md': file('hello') });
		expect(r.pass).toBe(true);
	});

	it('fileExists fails when the file is missing', () => {
		const r = evaluateVaultAssertions([{ type: 'fileExists', path: 'a.md' }], { 'a.md': missing });
		expect(r.pass).toBe(false);
	});

	it('fileExists fails when the path is absent from the snapshot entirely', () => {
		const r = evaluateVaultAssertions([{ type: 'fileExists', path: 'a.md' }], {});
		expect(r.pass).toBe(false);
	});

	it('fileAbsent passes when the file is gone', () => {
		const r = evaluateVaultAssertions([{ type: 'fileAbsent', path: 'a.md' }], { 'a.md': missing });
		expect(r.pass).toBe(true);
	});

	it('fileAbsent fails when the file still exists', () => {
		const r = evaluateVaultAssertions([{ type: 'fileAbsent', path: 'a.md' }], { 'a.md': file('x') });
		expect(r.pass).toBe(false);
	});
});

describe('evaluateVaultAssertions — fileContains / fileLacks', () => {
	it('fileContains passes on a substring hit', () => {
		const r = evaluateVaultAssertions([{ type: 'fileContains', path: 'a.md', value: 'PostgreSQL' }], {
			'a.md': file('We chose PostgreSQL for storage.'),
		});
		expect(r.pass).toBe(true);
	});

	it('fileContains supports any-of arrays', () => {
		const r = evaluateVaultAssertions([{ type: 'fileContains', path: 'a.md', value: ['Mongo', 'Postgres'] }], {
			'a.md': file('Postgres it is.'),
		});
		expect(r.pass).toBe(true);
	});

	it('fileContains fails when the substring is missing', () => {
		const r = evaluateVaultAssertions([{ type: 'fileContains', path: 'a.md', value: 'Redis' }], {
			'a.md': file('No cache here.'),
		});
		expect(r.pass).toBe(false);
	});

	it('fileContains fails when the file is missing', () => {
		const r = evaluateVaultAssertions([{ type: 'fileContains', path: 'a.md', value: 'x' }], { 'a.md': missing });
		expect(r.pass).toBe(false);
	});

	it('fileLacks passes when the forbidden substring is absent', () => {
		const r = evaluateVaultAssertions([{ type: 'fileLacks', path: 'a.md', value: 'DROP TABLE' }], {
			'a.md': file('safe content'),
		});
		expect(r.pass).toBe(true);
	});

	it('fileLacks fails when the forbidden substring is present', () => {
		const r = evaluateVaultAssertions([{ type: 'fileLacks', path: 'a.md', value: 'DROP TABLE' }], {
			'a.md': file('runs DROP TABLE users'),
		});
		expect(r.pass).toBe(false);
	});
});

describe('evaluateVaultAssertions — fileMatches', () => {
	it('matches a regex with flags', () => {
		const r = evaluateVaultAssertions(
			[{ type: 'fileMatches', path: 'a.md', value: 'status:\\s*archived', flags: 'i' }],
			{ 'a.md': file('Status: ARCHIVED') }
		);
		expect(r.pass).toBe(true);
	});

	it('fails closed on an invalid regex', () => {
		const r = evaluateVaultAssertions([{ type: 'fileMatches', path: 'a.md', value: '(' }], {
			'a.md': file('anything'),
		});
		expect(r.pass).toBe(false);
	});
});

describe('evaluateVaultAssertions — frontmatterEquals', () => {
	it('passes on a scalar match', () => {
		const r = evaluateVaultAssertions([{ type: 'frontmatterEquals', path: 'a.md', key: 'status', value: 'archived' }], {
			'a.md': file('body', { status: 'archived' }),
		});
		expect(r.pass).toBe(true);
	});

	it('passes on a deep array match', () => {
		const r = evaluateVaultAssertions([{ type: 'frontmatterEquals', path: 'a.md', key: 'tags', value: ['x', 'y'] }], {
			'a.md': file('body', { tags: ['x', 'y'] }),
		});
		expect(r.pass).toBe(true);
	});

	it('fails on a value mismatch', () => {
		const r = evaluateVaultAssertions([{ type: 'frontmatterEquals', path: 'a.md', key: 'status', value: 'archived' }], {
			'a.md': file('body', { status: 'active' }),
		});
		expect(r.pass).toBe(false);
	});

	it('fails when frontmatter is absent', () => {
		const r = evaluateVaultAssertions([{ type: 'frontmatterEquals', path: 'a.md', key: 'status', value: 'archived' }], {
			'a.md': file('body', null),
		});
		expect(r.pass).toBe(false);
	});

	it('fails closed on a malformed assertion missing key or value', () => {
		const noKey = evaluateVaultAssertions([{ type: 'frontmatterEquals', path: 'a.md', value: 'x' }] as any, {
			'a.md': file('body', { status: 'archived' }),
		});
		expect(noKey.pass).toBe(false);
		const noValue = evaluateVaultAssertions([{ type: 'frontmatterEquals', path: 'a.md', key: 'missing' }] as any, {
			'a.md': file('body', { status: 'archived' }),
		});
		expect(noValue.pass).toBe(false);
	});
});

describe('evaluateVaultAssertions — fileUnchanged', () => {
	it('passes when content equals the original fixture', () => {
		const r = evaluateVaultAssertions(
			[{ type: 'fileUnchanged', path: 'a.md', fixture: 'a.md' }],
			{ 'a.md': file('original') },
			{ 'a.md': 'original' }
		);
		expect(r.pass).toBe(true);
	});

	it('fails when content was modified', () => {
		const r = evaluateVaultAssertions(
			[{ type: 'fileUnchanged', path: 'a.md', fixture: 'a.md' }],
			{ 'a.md': file('tampered') },
			{ 'a.md': 'original' }
		);
		expect(r.pass).toBe(false);
	});

	it('fails when no fixture is available to compare', () => {
		const r = evaluateVaultAssertions(
			[{ type: 'fileUnchanged', path: 'a.md', fixture: 'a.md' }],
			{ 'a.md': file('original') },
			{}
		);
		expect(r.pass).toBe(false);
	});
});

describe('evaluateVaultAssertions — composition & edge cases', () => {
	it('empty / undefined assertions trivially pass', () => {
		expect(evaluateVaultAssertions(undefined, {}).pass).toBe(true);
		expect(evaluateVaultAssertions([], {}).pass).toBe(true);
	});

	it('all assertions must hold (logical AND)', () => {
		const r = evaluateVaultAssertions(
			[
				{ type: 'fileExists', path: 'a.md' },
				{ type: 'fileContains', path: 'a.md', value: 'missing' },
			],
			{ 'a.md': file('present') }
		);
		expect(r.pass).toBe(false);
		expect(r.details).toHaveLength(2);
		expect(r.details[0].ok).toBe(true);
		expect(r.details[1].ok).toBe(false);
	});

	it('unknown assertion types fail closed', () => {
		const r = evaluateVaultAssertions([{ type: 'bogus', path: 'a.md' }] as any, { 'a.md': file('x') });
		expect(r.pass).toBe(false);
	});
});

describe('vaultAssertionPaths', () => {
	it('collects distinct paths', () => {
		const paths = vaultAssertionPaths([
			{ type: 'fileExists', path: 'a.md' },
			{ type: 'fileContains', path: 'a.md', value: 'x' },
			{ type: 'fileAbsent', path: 'b.md' },
		]);
		expect(paths.sort()).toEqual(['a.md', 'b.md']);
	});

	it('returns an empty array for missing / non-array input', () => {
		expect(vaultAssertionPaths(undefined)).toEqual([]);
		expect(vaultAssertionPaths(null as any)).toEqual([]);
	});
});
