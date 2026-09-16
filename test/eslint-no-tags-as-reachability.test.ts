/**
 * Tests for the `local/no-tags-as-reachability` ESLint rule registered in
 * `eslint.config.mjs` (#1525). knip treats `@public` / `@beta` / `@alias` JSDoc
 * tags as a reachability exemption, so the rule fails any block comment carrying
 * one under `src/`. These tests run the registered rule through the real Linter
 * against the repo's own resolved flat config, so a regression in rule
 * registration, tag matching, or block-comment scoping fails here rather than
 * letting a tagged export back onto the knip-exempt path.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Linter, ESLint } from 'eslint';

/**
 * Resolve the repo's effective flat config for a src file, exactly as the ESLint
 * CLI resolves `eslint.config.mjs`, then adapt it for `Linter.verify`:
 *
 * - `calculateConfigForFile` resolves `language` to the concrete JS language
 *   object, but `Linter.verify` expects a `plugin/language` string — re-register
 *   the object under a synthetic `js` plugin and name it `js/js`.
 * - the type-aware `parserOptions.project` requires a real project file, so the
 *   probe filename `src/__rule_probe__.ts` is written (and emptied) on demand.
 */
const probeFile = 'src/__rule_probe__.ts';

async function loadResolvedConfig(): Promise<object> {
	fs.writeFileSync(probeFile, '');
	try {
		const eslint = new ESLint({ cwd: process.cwd() });
		const resolved = await eslint.calculateConfigForFile('src/__rule_probe__.ts');
		return [
			{
				files: ['src/**/*.ts'],
				...resolved,
				plugins: { ...resolved.plugins, js: { languages: { js: resolved.language } } },
				language: 'js/js',
			},
		];
	} finally {
		fs.unlinkSync(probeFile);
	}
}

// Top-level await is unavailable under tsconfig's ES6 target — resolve eagerly.
const config: object[] = [];
const linter = new Linter();
beforeAll(async () => {
	const resolved = await loadResolvedConfig();
	config.push(...(resolved as object[]));
});

describe('local/no-tags-as-reachability', () => {
	// The type-aware `parserOptions.project` only matches real project files, so
	// re-create an (empty) probe file for each lint call, then remove it.
	function messagesFor(code: string): string[] {
		fs.writeFileSync(probeFile, code);
		try {
			return linter
				.verify(code, config as never, { filename: probeFile })
				.filter((m: { ruleId: string | null }) => m.ruleId === 'local/no-tags-as-reachability')
				.map((m: { message: string }) => m.message);
		} finally {
			fs.unlinkSync(probeFile);
		}
	}

	it('flags each tag in its own block comment', () => {
		expect(messagesFor('/* @public */')).toEqual([expect.stringContaining("'@public'")]);
		expect(messagesFor('/* @beta */')).toEqual([expect.stringContaining("'@beta'")]);
		expect(messagesFor('/* @alias Foo */')).toEqual([expect.stringContaining("'@alias'")]);
	});

	it('ignores comments without any tag', () => {
		expect(messagesFor('/* export the widget for the modal */')).toEqual([]);
	});

	it('flags a tagged export in realistic source', () => {
		const code = ['/**', ' * Legacy entry point.', ' * @public', ' */', 'export function legacyEntry(): void {}'].join(
			'\n'
		);
		expect(messagesFor(code)).toEqual([expect.stringContaining("'@public'")]);
	});
});
