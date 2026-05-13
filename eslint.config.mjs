import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

// `eslint-plugin-obsidianmd@0.3.0`'s recommended preset bundles a large set of
// strict `@typescript-eslint/*` rules (no-explicit-any, no-unsafe-*, etc.) in
// addition to its Obsidian-specific rules. We only want the obsidianmd/* rules
// enforced; the bundled TS-strictness can be tightened in a follow-up.
const SOFTENED_TS_RULES = {
	'@typescript-eslint/no-explicit-any': 'off',
	'@typescript-eslint/no-unsafe-argument': 'off',
	'@typescript-eslint/no-unsafe-assignment': 'off',
	'@typescript-eslint/no-unsafe-call': 'off',
	'@typescript-eslint/no-unsafe-member-access': 'off',
	'@typescript-eslint/no-unsafe-return': 'off',
	'@typescript-eslint/no-unsafe-enum-comparison': 'off',
	'@typescript-eslint/no-unnecessary-type-assertion': 'off',
	'@typescript-eslint/no-misused-promises': 'off',
	'@typescript-eslint/no-floating-promises': 'off',
	'@typescript-eslint/no-base-to-string': 'off',
	'@typescript-eslint/restrict-template-expressions': 'off',
	'@typescript-eslint/no-redundant-type-constituents': 'off',
	'@typescript-eslint/no-require-imports': 'off',
	'@typescript-eslint/no-unused-expressions': 'off',
	'@typescript-eslint/no-deprecated': 'off',
	'@typescript-eslint/unbound-method': 'off',
	'@typescript-eslint/no-unused-vars': [
		'warn',
		{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
	],
};

// Obsidian-specific rules that flag pervasive patterns we can't realistically
// migrate in this PR. Tracked as follow-up issues — flip to 'error' once cleaned up.
const PERVASIVE_OBSIDIANMD_RULES_TODO = {
	// 207 violations: many false positives on acronyms (e.g. URL, HTTP) and brand
	// names. Needs a brand allowlist + audit pass.
	'obsidianmd/ui/sentence-case': 'off',
	// 82 violations: pervasive `document` usage. Migrating to `activeDocument` is
	// a separate refactor with cross-window implications.
	'obsidianmd/prefer-active-doc': 'off',
	// 81 violations: direct `style.X = ...` assignments. Needs CSS class migration.
	'obsidianmd/no-static-styles-assignment': 'off',
	// 48 violations: `x as TFile` / `x as TFolder` casts scattered across vault
	// helpers. Replacing each with `instanceof` checks is a careful refactor.
	'obsidianmd/no-tfile-tfolder-cast': 'off',
	// 35 violations: hardcoded `.obsidian` references. Some are in path constants
	// that need `vault.configDir` plumbed through; some are in docs/comments.
	'obsidianmd/hardcoded-config-path': 'off',
	// 28 violations: command IDs include the plugin ID (e.g. `gemini-scribe-foo`).
	// Removing the prefix would break user hotkey bindings — needs a migration.
	'obsidianmd/commands/no-plugin-id-in-command-id': 'off',
	// 6 violations: `vault.delete`/`vault.trash` should use `fileManager.trashFile`.
	// The replacement is async with ripple effects in callers.
	'obsidianmd/prefer-file-manager-trash-file': 'off',
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
		},
	},
]);
