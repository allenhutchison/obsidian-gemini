import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { Linter } from 'eslint';

// `eslint-plugin-obsidianmd@0.3.0`'s recommended preset bundles a large set of
// strict `@typescript-eslint/*` rules (no-explicit-any, no-unsafe-*, etc.) in
// addition to its Obsidian-specific rules. These were tightened rule-by-rule as
// the violations were cleared (tracked under epic #1032); every entry below is now
// enforced across src/. The `test/**` override relaxes a few back to 'off' for
// mock/fixture plumbing (see that block).
const SOFTENED_TS_RULES = {
	// #1036: cleared — enforced across src/ (test/ overrides back to 'off' below;
	// mock plumbing there is tracked separately, not part of #1036's src scope).
	'@typescript-eslint/no-explicit-any': 'error',
	// #1166: cleared across src/ directory-by-directory (slices 1–7); now enforced
	// globally (test/ overrides back to 'off' below).
	'@typescript-eslint/no-unsafe-argument': 'error',
	'@typescript-eslint/no-unsafe-assignment': 'error',
	'@typescript-eslint/no-unsafe-call': 'error',
	'@typescript-eslint/no-unsafe-member-access': 'error',
	'@typescript-eslint/no-unsafe-return': 'error',
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

// #1402: vault path containment kept getting hand-rolled as
// `p.startsWith(folder + '/')` instead of calling `isPathInFolder()` — eleven-plus
// sites across five audit sweeps. That matters because `isPathInFolder` is a live
// fix surface (#1372 changed its semantics, #1374 is an open bug in it) and no
// inline copy inherits a correction to it. Two selectors cover the two shapes the
// pattern takes: the concatenation passed straight to `.startsWith()` (#1402,
// measured 8/8 against `src/` with no false positives), and the same concatenation
// hoisted into a local first (#1482), which the first selector cannot see.
// A deliberate strict-descendant site takes a line-scoped disable carrying the
// "why strict descendant" reason the rule in `.claude/guidelines/coding.md` asks for.
// Both selectors live under the one `no-restricted-syntax` rule so that disable —
// which is per-rule, not per-selector — keeps suppressing exactly its own site.
const PATH_CONTAINMENT_RULE = {
	'no-restricted-syntax': [
		'error',
		{
			// `[operator='+']` narrows this to string concatenation. `BinaryExpression`
			// alone also covers `-`, `===`, `instanceof`, `in`, … — none of which can
			// realistically produce a `startsWith` argument, but the rule should say
			// exactly what it means rather than rely on that.
			selector:
				"CallExpression[callee.property.name='startsWith'][arguments.0.type='BinaryExpression'][arguments.0.operator='+']",
			message:
				"Don't hand-roll path containment: use isPathInFolder(path, folder) from src/utils/file-utils.ts (or shouldExcludePath/shouldExcludePathForPlugin for system paths). If this site genuinely needs strict-descendant semantics, add an eslint-disable-next-line with a reason explaining why.",
		},
		{
			// #1482: the selector above only fires when the concatenation IS the
			// `startsWith` argument. Hoisting it one line earlier evades it entirely —
			// `const prefix = folder + '/'` is a BinaryExpression, but the call's
			// argument is then an Identifier. `npm run lint` was green on `master`
			// with three such sites present (#1481). A selector cannot follow the
			// binding from the declarator to the later `.startsWith(prefix)`, so this
			// matches the assignment shape instead: building a path prefix by hand.
			// `[init.right.value='/']` keeps it to the path case — any other suffix
			// (`x + ', '`, `x + '\n'`) is not this pattern.
			//
			// Measured against `src/` before shipping: zero matches. All five
			// surviving `+ '/'` occurrences are accounted for — the deliberate
			// strict-descendant call in `skill-manager.ts` (line-scoped disable, and
			// the call form anyway, so this selector never sees it), two in
			// `file-utils.ts` (the exempt file that owns the predicate), and two
			// inside comments, which are not walked AST nodes. So the widened guard
			// adds no false positives on today's tree; it is a trap for the next
			// hoisted prefix rather than a fix for a current one.
			selector: "VariableDeclarator[init.type='BinaryExpression'][init.operator='+'][init.right.value='/']",
			message:
				"Don't build a path prefix by hand: `folder + '/'` assigned to a local is the hoisted form of hand-rolled containment, which the .startsWith() selector can't see. Call isPathInFolder(path, folder) from src/utils/file-utils.ts at the use site instead (or shouldExcludePath/shouldExcludePathForPlugin for system paths). If this site genuinely needs strict-descendant semantics, add an eslint-disable-next-line with a reason explaining why.",
		},
	],
};

// #1317: non-provider modules branch on the provider-name string literals
// ('gemini' / 'ollama' / 'openai' / 'anthropic') instead of asking the
// provider registry (`getCapabilities`, `featureProvider`,
// `PROVIDERS`/`PROVIDER_IDS` in src/api/providers/registry.ts), so every new
// provider requires hand-editing a ladder in a module with no business
// knowing which providers exist. The audit fixed or filed this pattern three
// times in 90 days (#1287, #1307, the #1308/#703 backlog); prose in
// invariants.md kept being violated, so the prose rule is now enforced.
//
// The selector matches string *literals* only — comparisons and data tags —
// which is exactly the leak; `ModelProvider`-typed values and type positions
// do not match (a `Literal` in a type annotation is not walked). Exempted
// outright: the modules that own provider identity (see the override block
// below). Existing violations carry line-scoped inline disables with reasons
// — the same policy PATH_CONTAINMENT_RULE documents — so every file stays
// guarded against the *next* literal, and each exemption states why it is
// legitimate; as #1308/#703 clear sites, their disables go with them.
//
// NOTE for `no-restricted-syntax` disables: `eslint-disable-next-line
// no-restricted-syntax -- <reason>` suppresses this rule AND
// PATH_CONTAINMENT_RULE together (one rule id, several selectors). That is
// deliberate — a disable is per-rule, not per-selector — but it means a
// disable added for a provider literal also masks the path-containment
// selectors on that line. None of the existing sites overlap; keep it that
// way, or scope the exemption to its own rule id instead.
const PROVIDER_LITERAL_RULE = {
	'no-restricted-syntax': [
		'error',
		{
			selector: "Literal[value='gemini'], Literal[value='ollama'], Literal[value='openai'], Literal[value='anthropic']",
			message:
				"Don't branch on a provider-name literal: ask the provider registry (getCapabilities/featureProvider/PROVIDER_IDS from src/api/providers/registry.ts) instead, so a new provider doesn't require hand-editing this ladder. If this site legitimately owns provider identity, add an eslint-disable-next-line with a reason explaining why.",
		},
	],
};

// #1525: knip honours `@public` / `@beta` JSDoc tags as a built-in exemption — a tagged
// export is reported as used without any reachability check (its `isAlwaysIgnored`
// short-circuits before the caller search), so dead surface lands and stays green on the
// CI-blocking `npm run knip` check. Three exemptions have already been abused this way:
// the `types`/`exports` entry-point barrel (#1356/#1463), `test/**` imports (#1493), and
// the `@public` tag itself (#1522: two exports with zero references). This repo ships
// through the Obsidian registry and is never `npm publish`ed, so it has no public API and
// no legitimate use for any of the tags. `no-restricted-syntax` cannot see comments
// (they are not walked AST nodes), so this is a local rule over `sourceCode.getAllComments()`.
// Knip's tag scanner only reads `/* */`-style comments (`comment.type === 'Block'`),
// so the rule mirrors that exactly — `//`-line comments never exempt anything.
const REACHABILITY_TAG_RULE = {
	'no-tags-as-reachability': {
		meta: {
			type: 'problem',
			docs: {
				description:
					'`@public`/`@beta`/`@alias` JSDoc tags silently exempt an export from the knip dead-code check (#1525)',
			},
			schema: [],
			messages: {
				noReachabilityTag:
					"'{{tag}}' marks this export reachable to knip with no real caller. There is no public API in this repo: delete the tag, delete the export, or give it a caller — see 'There is no public API barrel' in .claude/guidelines/coding.md (#1525).",
			},
		},
		create(context) {
			const TAGS = ['@public', '@beta', '@alias'];
			return {
				Program() {
					for (const comment of context.sourceCode.getAllComments()) {
						if (comment.type !== 'Block') continue;
						for (const tag of TAGS) {
							if (comment.value.includes(tag)) {
								context.report({
									node: comment,
									messageId: 'noReachabilityTag',
									data: { tag },
								});
							}
						}
					}
				},
			};
		},
	},
};
const plugin_ = { rules: { 'no-tags-as-reachability': REACHABILITY_TAG_RULE['no-tags-as-reachability'] } };

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
				// #1525: an inline disable would re-open the knip tag-exemption hole the
				// rule exists to close — suppressible only via a config change, never a comment.
				'local/no-tags-as-reachability',
			],
		},
	},
	{
		files: ['test/eslint-no-tags-as-reachability.test.ts'],
		rules: { 'local/no-tags-as-reachability': 'off' },
	},
	{
		files: ['src/**/*.ts'],
		plugins: { local: plugin_ },
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: './tsconfig.json' },
			globals: NODE_GLOBALS,
		},
		rules: {
			...SOFTENED_TS_RULES,
			...PERVASIVE_OBSIDIANMD_RULES_TODO,
			...SOFTENED_TS_RULES,
			...PERVASIVE_OBSIDIANMD_RULES_TODO,
			// One rule id, several selector groups: the two PATH_CONTAINMENT
			// selectors and the PROVIDER_LITERAL selector share
			// `no-restricted-syntax`, so a single line disable with a reason
			// suppresses exactly the selectors at that site (see the NOTE on
			// PROVIDER_LITERAL_RULE).
			'no-restricted-syntax': [
				...PATH_CONTAINMENT_RULE['no-restricted-syntax'],
				...PROVIDER_LITERAL_RULE['no-restricted-syntax'],
			],
			'local/no-tags-as-reachability': 'error',
		},
	},
	{
		// The modules that legitimately own provider identity (#1317): the
		// provider packages themselves, the designated dispatch point, the
		// routing leaf, the model catalog, and the type unions. Everything
		// else under src/ must ask the registry rather than branch on the
		// string literals; existing sites carry line-scoped disables with
		// reasons, deleted as #1308/#703 clear them.
		files: [
			'src/api/providers/**',
			'src/api/factory.ts',
			'src/api/provider-routing.ts',
			'src/api/feature-routing.ts',
			'src/api/provider-credentials.ts',
			'src/api/provider-status.ts',
			'src/models.ts',
			'src/types/**',
		],
		rules: { 'no-restricted-syntax': 'off' },
	},
	{
		// `file-utils.ts` owns `isPathInFolder` and the write-path policy built on
		// it, so it is the one file whose job is to spell the containment check out.
		files: ['src/utils/file-utils.ts'],
		rules: { 'no-restricted-syntax': 'off' },
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
			// The `no-unsafe-*` family (enforced across src/ by #1166) stays off for
			// tests, where mock/fixture plumbing flows untyped values by design.
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
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
