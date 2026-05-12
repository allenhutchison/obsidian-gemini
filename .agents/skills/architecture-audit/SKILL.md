---
name: architecture-audit
description: Walk the codebase looking for TypeScript technical debt — oversized files, DRY violations, dead code, missing tests, sloppy typing (`any`/`@ts-ignore`), and weak abstractions. Categorize each finding into a discrete unit of work; open a focused PR for mechanically-safe fixes and file a GitHub issue for refactors that need design discussion. One PR or one issue per finding — never bundled. Use when the user asks to "audit the architecture", "find tech debt", "look for code smells", "do an architecture sweep", or when invoked nightly by a scheduled remote agent. Has working-tree side effects (branches + PRs) and GitHub side effects (issues, labels). Quiet-day result is "codebase looks good" with no PR or issue — that's a valid outcome.
---

# Audit the architecture and file discrete units of work

This skill is the codebase's nightly tech-debt sweep. It looks at the TypeScript source the way a diligent senior reviewer would on a slow Friday afternoon, finds the structural problems that don't trip CI but accumulate into pain, **categorizes each finding into a single unit of work**, and either fixes it (one focused PR) or files it for human review (one issue) — never both, never bundled.

The skill is **deliberately conservative**: it caps the number of PRs and issues it opens per run, refuses to land sprawling changes overnight, and skips findings that already have an open PR or issue. A clean run that reports "codebase looks good" is the expected steady state on most nights.

## What it looks for

Each category has a default detection method and a default routing decision (PR vs. issue). The routing is a default — apply judgment when the situation deviates.

| Category                              | Detection                                                                                                                                                                            | Default routing                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Oversized files**                   | `wc -l src/**/*.ts`; flag `.ts` files >700 lines (>1000 for `src/main.ts`)                                                                                                           | **Issue** — splitting a big file is a design decision                               |
| **`any` / `as any` overuse**          | `grep -rn ': any\b\|as any' src/`                                                                                                                                                    | **PR** if 1–3 sites in a single file with obvious correct type; **issue** otherwise |
| **`@ts-ignore` / `@ts-expect-error`** | `grep -rn '@ts-ignore\|@ts-expect-error' src/`                                                                                                                                       | **PR** if the suppression is removable today; **issue** with explanation if not     |
| **Missing test files**                | For each `src/**/*.ts` (excluding barrels, types, declarations), check `test/**/*.test.ts` mirror exists                                                                             | **Issue** — writing tests for a previously-untested module is non-trivial           |
| **Dead exports**                      | `grep` for each exported symbol's references across `src/` and `test/`; flag exports with 0 external references that aren't `main.ts` entry points or re-exported via `src/index.ts` | **PR** — deletion is mechanical and reversible                                      |
| **DRY violations**                    | Manual reading: look for near-duplicate helper functions, repeated control-flow blocks (>10 lines duplicated >2 places), parallel `if`/`switch` ladders                              | **Issue** — extraction is a design decision                                         |
| **Weak abstractions**                 | Manual reading: look for "god" interfaces (>15 members), classes that mix unrelated responsibilities, settings objects passed everywhere instead of focused dependencies             | **Issue**                                                                           |
| **Improper typing**                   | `Object`, `Function`, `{}` as types; non-null assertions (`!`) in non-trivial spots; index signatures where a discriminated union would do                                           | **PR** if local fix; **issue** if structural                                        |
| **Console misuse**                    | `grep -rn 'console\.\(log\|debug\|error\|warn\)' src/` — AGENTS.md says use `plugin.logger`, never `console`                                                                         | **PR** — mechanical replacement                                                     |
| **Circular imports**                  | `grep` for known smell: `import { X } from './foo'` in a file that `foo` also imports from                                                                                           | **Issue**                                                                           |

You're not limited to this table — if a senior TypeScript reviewer would flag something else (dead branches, swallowed errors, magic numbers in agent loops), capture it. Just keep the routing rule: mechanical and small → PR; structural or judgment-heavy → issue.

## What it does NOT look for

- **Formatting and style.** Prettier owns those. If formatting drifted, that's a CI bug, not architecture.
- **Test pass/fail.** `npm test` is run by `create-pr` before pushing — if tests fail, the PR can't open. This skill doesn't gate on test quality, only on test _existence_.
- **Performance.** Micro-optimization isn't tech debt; the skill is about structure, not throughput.
- **Documentation drift.** The `audit-docs` skill owns that. If a finding here happens to surface a doc issue too, mention it but don't fix it — the next `audit-docs` run will.
- **Security review.** That's `/security-review`'s job.
- **Bundled help references.** `src/services/generated-help-references.ts` is auto-generated. Don't flag it for any category.

## Workflow

Use `TaskCreate` to track each finding as you process it — the audit can sprawl across many files and you'll lose your place without it.

### 1. Pre-flight: start clean

```bash
git status --short        # working tree must be clean
git checkout master
git pull
```

If the working tree isn't clean, stop and report — don't try to stash. A dirty tree probably means a human is mid-work; this skill is for fully idle moments.

Exception: untracked files under `.agents/skills/` or `.claude/skills/` are skill scaffolding, not in-progress source work. Treat them as benign — proceed with the audit, but stage carefully (`git add <specific-path>`) on each branch so they don't leak into the audit PRs.

### 2. Sweep the categories

Run each detection step. **Collect findings into a list — don't open any PRs or issues until the sweep is complete.** This lets you de-dup across categories (e.g. an oversized file may also have several `any` sites; bundle those into one issue rather than three).

Suggested order, fast-to-slow:

1. **Oversized files** — single `wc -l` over `src/**/*.ts`. Sort descending. Note anything over the threshold.
2. **`any` / `as any` / `@ts-ignore` density** — three `grep -rn` invocations. Tally per-file counts.
3. **Console misuse** — one `grep` against `src/`. Each hit is a finding (or all hits in one file roll into one PR).
4. **Dead exports** — prefer `npx knip` if installed (`grep -q '"knip"' package.json`); it produces a far more accurate report than ad-hoc grepping. If knip isn't available, fall back to: for each `export` in `src/`, grep the symbol across `src/` and `test/`; anything with zero hits outside its own file is a candidate. Skip `src/main.ts` (entry) and `src/index.ts` (public surface). The grep fallback misses re-exports, type-only references, and symbols imported with `import *`, so it **undercounts** — if you're consistently finding few candidates with grep, that's a signal to install knip rather than a signal that the codebase is clean.
5. **Missing test files** — list `src/**/*.ts`, list `test/**/*.test.ts`, diff the mirrored paths. Ignore type-only files, declarations, barrels.
6. **DRY violations** — read the larger files (top 10 by line count) and look for repeated blocks. This is the judgment-heavy step; don't force findings if nothing obvious surfaces.
7. **Weak abstractions** — same reading pass; note interfaces over 15 members, classes with mixed responsibilities.
8. **Circular / improper typing / other** — opportunistic.

### 3. De-duplicate against existing work

For each finding, check whether it's already tracked:

```bash
# Open issues with architecture label
gh issue list --repo allenhutchison/obsidian-gemini \
  --state open --label architecture --json number,title,body --limit 100

# Open PRs (any author)
gh pr list --repo allenhutchison/obsidian-gemini \
  --state open --json number,title,headRefName --limit 50
```

Skip a finding if any of:

- An open issue mentions the same file/symbol/category.
- An open PR's branch name matches the slug you'd use for this finding (see step 5).
- The skill opened the same issue in a previous run (check closed-recently with the `automated` label — if a human closed it as `wontfix`, don't re-file).

### 4. Categorize each finding into a unit of work

For each surviving finding, decide:

- **One PR** if all of:
  - Fix is < ~150 lines of diff.
  - Touches ≤ 5 files.
  - The correct change is mechanical (the reviewer would say "yes obviously" without design discussion).
  - It won't cause behavior change beyond what's claimed.
- **One issue** otherwise. Issues describe the finding + a proposed plan; they do not commit to a specific diff.

If you're unsure, default to **issue**. A merged PR is harder to undo than a closed issue.

**Umbrella vs. individual issues.** When a single category produces many similar findings (e.g. 50+ missing-test files, 5+ oversized files), the right shape is usually **one umbrella issue with a prioritized list of sub-targets**, not 5 thin issues that each say "file X needs Y." Use an umbrella when all are true:

- The findings share a single root cause or rationale.
- A reviewer would want to weigh them against each other (which 3 of the 15 untested vault tools matter most?), not pick them up in isolation.
- The list would otherwise blow past the per-run cap and force half the findings into "deferred."

The umbrella body should list every finding it covers, grouped by priority, with explicit out-of-scope items so the picker-upper can split it into sub-issues without re-doing triage. Don't use an umbrella to dodge the cap when the findings are genuinely independent; that just trades a flood of issues for a single unreviewable mega-issue.

### 5. Open PRs (capped at 3 per run)

For each PR-routed finding, in priority order (highest-impact first):

```bash
# Each PR gets its own branch — never reuse a branch across findings
SLUG="arch-<category>-<short-descriptor>"   # e.g. arch-any-completions-types
git checkout master && git checkout -b "$SLUG"
```

Branch naming convention: `arch-<category>-<descriptor>` (kebab-case, ≤50 chars). The `arch-` prefix makes it easy to see automated audit branches at a glance.

Make the fix. Keep it laser-focused: **do not** clean up nearby unrelated code, **do not** rename for taste, **do not** add comments unless the original was load-bearing. The PR's blast radius must match its claim. If you find yourself "while I'm here"-ing, stop and route the extra finding to a separate issue.

Hand off to the **`create-pr`** skill (`.agents/skills/create-pr/SKILL.md`) to open the PR. That skill runs `npm run format-check`, `npm run build`, and `npm test` before pushing — do not bypass it. If pre-flight fails, the PR doesn't open; capture the error in the report and continue with the next finding (don't try to fix unrelated test failures here).

PR title: `refactor: <one-line description>` or `chore: <...>` — match the conventional prefix to the work. Body must reference the finding plainly:

```markdown
## Summary

Architecture-audit nightly sweep flagged: **<category>** in `<file>`.

<2–3 sentences: what the smell is, what the fix is, why it's safe.>

## Changes

- <bullet per file touched>

## Checklist

(per create-pr's template)
```

Apply the `architecture` and `automated` labels on the PR:

```bash
gh pr edit <NUM> --add-label architecture --add-label automated
```

**Stop at 3 PRs.** Remaining PR-routed findings get re-routed to issues for this run; the next nightly run will pick them up as PRs if they're still relevant. A flood of similar PRs trains reviewers to ignore them.

### 6. File issues (capped at 5 per run)

For each issue-routed finding (and any PR-routed overflow), file one issue:

```bash
gh issue create --repo allenhutchison/obsidian-gemini \
  --title "<category>: <one-line problem>" \
  --label architecture --label automated \
  --body "<see template below>"
```

Issue body template:

```markdown
## What

<One paragraph: the smell, where it lives, why it's worth addressing.>

## Evidence

- `src/path/to/file.ts:42–68` — <snippet or pattern>
- `src/path/to/other.ts:103` — <duplicate location>

## Proposed unit of work

<3–6 bullets describing the smallest reasonable change that addresses the
finding. Be concrete — name the file(s) to create or split, the symbols to
move, the tests to add. Don't write the code; describe it.>

## Out of scope

<What this issue is _not_ — to keep the scope tight when someone picks it up.>

---

_Filed by the `architecture-audit` skill. If this isn't worth doing, close with `wontfix` — the skill checks closed-with-wontfix and won't refile._
```

**Stop at 5 issues.** Remaining findings are deferred to the next run. Capture them in the report so the human caller knows the backlog is growing.

### 7. Report

Reply to the caller with a structured summary:

```text
Architecture audit — YYYY-MM-DD

Sweep scope: <N> source files, <M> lines analyzed
Findings: <total>
  - Routed to PR: <count> (opened <opened>, skipped-as-duplicate <dupes>)
  - Routed to issue: <count> (filed <filed>, skipped-as-duplicate <dupes>)
  - Deferred (over cap): <count>

PRs opened:
- #NNN  arch-any-completions-types — replace 3 `any` types in src/completions.ts
- #NNN  arch-console-tools-cleanup — swap console.log for plugin.logger in 4 tool files
- ...

Issues filed:
- #NNN  oversized-file: src/main.ts (1046 lines) — propose split into <plan>
- #NNN  dry-violation: history rendering duplicated between agent-view and chat-view
- ...

Deferred (will retry next run):
- <finding> — over PR cap, didn't route to issue because <reason>

Pre-flight failures (PRs not opened):
- arch-any-summary-types — npm test failed on test/summary.test.ts (unrelated)

No findings in: <list of categories that came up clean>
```

If the total finding count is zero, the entire report collapses to:

```text
Architecture audit — YYYY-MM-DD

Sweep scope: <N> source files
Findings: 0 — codebase looks good.
```

That's the expected steady-state output. Don't pad it with positive observations or "good job" notes; absence of findings is the message.

## Calibrating scope

A healthy codebase produces 0–3 findings per nightly run. A run that surfaces 0 should report cleanly and stop. A run that surfaces >10 means real debt has accumulated — flag it in the report and let the maintainer decide whether to ratchet the thresholds tighter or schedule a focused debt-paydown sprint.

Tune the per-run caps (3 PRs / 5 issues) downward if reviewers report fatigue. Tune upward only if the human caller explicitly asks for a deeper one-time sweep ("really go after the tech debt this weekend").

**Threshold tuning.** The size thresholds in the category table (700 / 1000 lines, 15 interface members, etc.) are first-cut defaults — ratchet them tighter once the obvious offenders have been split. For example, once `src/main.ts` is below 1000 lines, drop the main-file threshold to 800 so the next overgrowth gets caught early. Don't loosen thresholds to make a noisy category quiet; that defeats the audit. Edit the thresholds in this SKILL.md directly when tuning so future runs pick them up.

## What not to do

- **Don't bundle findings into a single PR.** "Misc architecture fixes" PRs are unreviewable. One unit of work per PR. If two findings genuinely belong together, that's one finding — describe it that way.
- **Don't open a PR for a finding that needs design discussion.** Splitting `main.ts`, extracting a shared service, changing a public interface — all of these are issues, not PRs, no matter how confident the agent feels.
- **Don't reuse a branch from a previous run.** Each PR gets a fresh branch off master. Same-named findings on subsequent runs are an indication of skipped de-dup, not a reason to push onto the old branch.
- **Don't re-file an issue that was closed `wontfix`.** Check closed issues with the `automated` label before filing. A `wontfix` close is the maintainer's standing answer.
- **Don't comment on existing issues or PRs.** This skill files new ones or stays silent. Threaded discussion on prior automated issues belongs to humans.
- **Don't edit `src/services/generated-help-references.ts`** or any other generated file. The fix for generated drift is in the source, not the output.
- **Don't skip the `create-pr` pre-flight.** No `--no-verify`, no skipping format/build/test. The audit's whole credibility rests on its PRs being mergeable on first read.
- **Don't operate on a dirty working tree.** A pre-existing diff in `src/`, `test/`, or `docs/` means a human is mid-work; back off and report. Untracked skill scaffolding under `.agents/skills/` or `.claude/skills/` is the one exception — see step 1.
- **Don't bypass the per-run caps** "just this once." The caps exist to keep the review burden sustainable; the next run will pick up the deferred findings.
- **Don't auto-merge.** Even green CI doesn't mean a refactor is right. Every PR this skill opens waits for human review and merge.

## When integrated with scheduling

This skill is **not** part of the `daily-update` meta-skill, because `daily-update` bundles its work into one PR and this skill explicitly opens many. Schedule it as its own slot (e.g. nightly at 2am local time) via the `schedule` skill. The schedule should invoke this skill directly; there is no autonomous-prompt variant — pass a literal `/architecture-audit` or equivalent.

If the user is running short on schedule slots and wants to combine with `daily-update`, the right consolidation is to have this skill run _first_, produce its PRs/issues, and then let `daily-update` run its own one-PR sweep on top — but they remain logically separate runs from the maintainer's point of view.
