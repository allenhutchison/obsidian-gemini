import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

// `eslint-plugin-obsidianmd@0.3.0`'s recommended preset bundles a large set of
// strict `@typescript-eslint/*` rules (no-explicit-any, no-unsafe-*, etc.) in
// addition to its Obsidian-specific rules. We only want the obsidianmd/* rules
// enforced; the bundled TS-strictness is being tightened rule-by-rule as the
// remaining violations are cleared (the `'error'` entries below are already
// enforced; the `'off'` entries are tracked in sibling #1032 issues).
const SOFTENED_TS_RULES = {
	'@typescript-eslint/no-explicit-any': 'off',
	'@typescript-eslint/no-unsafe-argument': 'off',
	'@typescript-eslint/no-unsafe-assignment': 'off',
	'@typescript-eslint/no-unsafe-call': 'off',
	'@typescript-eslint/no-unsafe-member-access': 'off',
	'@typescript-eslint/no-unsafe-return': 'off',
	// #1041: cleared — enforced.
	'@typescript-eslint/no-unsafe-enum-comparison': 'error',
	// #1039: cleared — enforced.
	'@typescript-eslint/no-unnecessary-type-assertion': 'error',
	'@typescript-eslint/no-misused-promises': 'off',
	// #1037: cleared — enforced.
	'@typescript-eslint/no-floating-promises': 'error',
	'@typescript-eslint/no-base-to-string': 'off',
	'@typescript-eslint/restrict-template-expressions': 'off',
	// #1041: cleared — enforced.
	'@typescript-eslint/no-redundant-type-constituents': 'error',
	'@typescript-eslint/no-require-imports': 'off',
	// #1041: cleared — enforced.
	'@typescript-eslint/no-unused-expressions': 'error',
	// #1040: cleared — enforced.
	'@typescript-eslint/no-deprecated': 'error',
	'@typescript-eslint/unbound-method': 'off',
	'@typescript-eslint/no-unused-vars': [
		'warn',
		{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
	],
};

// Obsidian-specific rules that flag pervasive patterns we can't realistically
// migrate in this PR. Tracked as follow-up issues — flip to 'error' once cleaned up.
const PERVASIVE_OBSIDIANMD_RULES_TODO = {
	// `obsidianmd/ui/sentence-case` was here (originally ~207 violations) — now
	// fixed: the i18n migration routed almost all UI text through `t()` (which the
	// rule can't statically evaluate), leaving only a handful of `setPlaceholder`
	// hints that intentionally show a literal value the user types verbatim (a URL,
	// example model IDs, a command-id format, skill names, a frontmatter key). Those
	// carry scoped inline disables at their call sites, so the rule is enforced again
	// (left at the preset default). The anticipated brand/acronym allowlist proved
	// unnecessary — the plugin's built-in allowlist already covers the acronyms and
	// brands in use (#1043).
	// `obsidianmd/prefer-active-doc` was here (bare `document` usage) — now fixed:
	// live-view DOM operations use the target element's `ownerDocument`, and the few
	// genuinely detached nodes (escape-only, rasterization, test stubs) carry scoped
	// inline disables. The rule is enforced again (left at the preset default).
	// ~69 violations remaining: direct `style.X = ...` assignments. Needs CSS class
	// migration. Cleaned so far and enforced per-file below (see the scoped override
	// block): src/ui/agent-view/agent-view-progress.ts, agent-view-shelf.ts. Flip to
	// 'error' globally once the remaining sites are migrated.
	'obsidianmd/no-static-styles-assignment': 'off',
	// `obsidianmd/no-tfile-tfolder-cast` was here — now fixed: all `x as TFile`
	// / `x as TFolder` casts replaced with `instanceof` narrowing (the sole
	// remaining exception is a fabricated early-init folder stub in
	// file-utils.ts with a scoped inline disable), so the rule is enforced
	// again (left at the preset default).
	// `obsidianmd/commands/no-plugin-id-in-command-id` was here (28 violations) —
	// now fixed: the `gemini-scribe-` prefix was dropped from every command ID
	// (#1042), so Obsidian's automatic `gemini-scribe:` namespacing is no longer
	// duplicated and the rule is enforced again (left at the preset default).
	// `obsidianmd/prefer-file-manager-trash-file` was here (6 violations) — now
	// fixed: all deletions go through `fileManager.trashFile`, so the rule is
	// enforced again (left at the preset default).
};

const NODE_GLOBALS = {
	process: 'readonly',
	Buffer: 'readonly',
	NodeJS: 'readonly',
	__dirname: 'readonly',
	__filename: 'readonly',
	require: 'readonly',
	setImmediate: 'readonly',
	clearImmediate: 'readonly',
	global: 'readonly',
	AsyncGenerator: 'readonly',
	HandlebarsTemplateDelegate: 'readonly',
};

const VITEST_GLOBALS = {
	describe: 'readonly',
	it: 'readonly',
	test: 'readonly',
	expect: 'readonly',
	vi: 'readonly',
	beforeEach: 'readonly',
	afterEach: 'readonly',
	beforeAll: 'readonly',
	afterAll: 'readonly',
};

export default defineConfig([
	{
		ignores: [
			'main.js',
			'node_modules/**',
			'coverage/**',
			'docs/**',
			'evals/**',
			'scripts/**',
			'__mocks__/**',
			'src/services/generated-help-references.ts',
			'**/*.mjs',
			'**/*.js',
			'**/*.json',
			'**/*.map',
			'**/*.d.ts',
			'vitest.config.ts',
		],
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: './tsconfig.json' },
			globals: NODE_GLOBALS,
		},
		rules: { ...SOFTENED_TS_RULES, ...PERVASIVE_OBSIDIANMD_RULES_TODO },
	},
	{
		// #1036: `no-explicit-any` is cleared for these directories, so enforce it here
		// to prevent regressions while the rule stays globally softened for the rest of
		// `src/` (remaining areas — src/tools, src/api, src/ui — tracked in #1036).
		files: ['src/utils/**/*.ts', 'src/mcp/**/*.ts'],
		rules: { '@typescript-eslint/no-explicit-any': 'error' },
	},
	{
		// Files fully migrated off direct `style.X = ...` assignments to CSS classes.
		// Enforce `no-static-styles-assignment` here so they cannot regress while the
		// rule stays globally disabled for the remaining unmigrated files (#1034).
		files: ['src/ui/agent-view/agent-view-progress.ts', 'src/ui/agent-view/agent-view-shelf.ts'],
		rules: { 'obsidianmd/no-static-styles-assignment': 'error' },
	},
	{
		files: ['test/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: './tsconfig.test.json' },
			globals: { ...NODE_GLOBALS, ...VITEST_GLOBALS },
		},
		rules: {
			...SOFTENED_TS_RULES,
			...PERVASIVE_OBSIDIANMD_RULES_TODO,
			// Tests legitimately use Node.js modules for fixtures and don't run in Obsidian.
			'import/no-nodejs-modules': 'off',
			// innerHTML inside test setup is fine (jsdom, not user-facing).
			'@microsoft/sdl/no-inner-html': 'off',
			// Tests use concrete `.obsidian` sample paths as fixtures to verify the
			// exclusion logic; the rule enforcing `vault.configDir` applies to production
			// code in `src/`, not to fixture data.
			'obsidianmd/hardcoded-config-path': 'off',
			// Tests fabricate `TFile`/`TFolder` mocks via casts (`{ path } as TFile`,
			// `as unknown as TFile` + `setPrototypeOf`); there is no real instance to
			// narrow with `instanceof`. The rule guards production vault lookups in
			// `src/`, not fabricated fixture objects.
			'obsidianmd/no-tfile-tfolder-cast': 'off',
			// Tests build DOM elements with arbitrary placeholder fixture text
			// (`'some text'`, `'file1'`, `'inside'`); sentence-case enforcement targets
			// real user-facing UI strings in `src/`, not fixture data.
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
]);
