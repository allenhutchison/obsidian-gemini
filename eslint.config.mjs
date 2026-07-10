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
	// #1036: cleared — enforced across src/ (test/ overrides back to 'off' below;
	// mock plumbing there is tracked separately, not part of #1036's src scope).
	'@typescript-eslint/no-explicit-any': 'error',
	'@typescript-eslint/no-unsafe-argument': 'off',
	'@typescript-eslint/no-unsafe-assignment': 'off',
	'@typescript-eslint/no-unsafe-call': 'off',
	'@typescript-eslint/no-unsafe-member-access': 'off',
	'@typescript-eslint/no-unsafe-return': 'off',
	// #1041: cleared — enforced.
	'@typescript-eslint/no-unsafe-enum-comparison': 'error',
	// #1039: cleared — enforced.
	'@typescript-eslint/no-unnecessary-type-assertion': 'error',
	// #1038: cleared — enforced.
	'@typescript-eslint/no-misused-promises': 'error',
	// #1037: cleared — enforced.
	'@typescript-eslint/no-floating-promises': 'error',
	// #1032 sweep: cleared — enforced.
	'@typescript-eslint/no-base-to-string': 'error',
	'@typescript-eslint/restrict-template-expressions': 'error',
	// #1041: cleared — enforced.
	'@typescript-eslint/no-redundant-type-constituents': 'error',
	// #1032 sweep: cleared — enforced. The one deliberate lazy require (AgentLoop's
	// cycle-breaking agent-factory load, see AGENTS.md) carries an inline disable.
	'@typescript-eslint/no-require-imports': 'error',
	// #1041: cleared — enforced.
	'@typescript-eslint/no-unused-expressions': 'error',
	// #1040: cleared — enforced.
	'@typescript-eslint/no-deprecated': 'error',
	// #1032 sweep: cleared — enforced (src was already clean; test/ overrides back to
	// 'off' below for vitest's expect(mock.method) idiom, a known false positive).
	'@typescript-eslint/unbound-method': 'error',
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
	// `obsidianmd/no-static-styles-assignment` was here (~69 violations) — now fixed:
	// static inline styles migrated to CSS classes / Obsidian's show()/hide() helpers
	// (#1167). The agent view's iOS layout fix keeps deliberate inline `!important`
	// setProperty calls with scoped inline disables (a class can't beat theme
	// !important rules or round-trip host-element inline styles). The rule is
	// enforced again (left at the preset default).
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
		// The 0.4.x preset's `eslint-comments/no-restricted-disable` forbids inline
		// `eslint-disable` comments for a list of rules outright, expecting exceptions
		// to live as file-scoped config overrides instead. This repo's documented
		// policy is the opposite: intentional exceptions are line-scoped inline
		// disables at the call site, each carrying a `-- reason` description
		// (`eslint-comments/require-description` stays enforced). Keep the restriction
		// only for rules we never disable inline.
		rules: {
			'eslint-comments/no-restricted-disable': [
				'error',
				'no-console',
				'no-restricted-globals',
				'@typescript-eslint/no-restricted-imports',
				'@microsoft/sdl/no-document-write',
				'no-eval',
			],
		},
	},
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
		// #1166 (slices 1–6): the `@typescript-eslint/no-unsafe-*` family is cleared for
		// these directories, so enforce it here to prevent regression. The five global
		// entries in SOFTENED_TS_RULES stay 'off' until the final slice flips them all
		// at once; each subsequent slice adds its directories to this list.
		files: [
			'src/utils/**/*.ts',
			'src/mcp/**/*.ts',
			'src/ui/**/*.ts',
			'src/services/**/*.ts',
			'src/main.ts',
			'src/agent/**/*.ts',
			'src/prompts/**/*.ts',
		],
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'error',
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
		},
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
			// `any` is pervasive in test mocks/fixtures (~1.8k occurrences) and outside
			// #1036's src-only scope — keep it off here.
			'@typescript-eslint/no-explicit-any': 'off',
			// vitest's expect(mock.method).toHaveBeenCalled() pattern trips this rule's
			// method-reference check (~56 false positives) — keep it off for tests.
			'@typescript-eslint/unbound-method': 'off',
			// Tests legitimately use Node.js modules for fixtures and don't run in Obsidian.
			'import/no-nodejs-modules': 'off',
			// Tests run in jsdom, where Obsidian's createEl/createDiv/createSpan DOM
			// globals don't exist — the rule's suggestion (and its autofix, which the
			// pre-commit `eslint --fix` would apply) is impossible there.
			'obsidianmd/prefer-create-el': 'off',
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
