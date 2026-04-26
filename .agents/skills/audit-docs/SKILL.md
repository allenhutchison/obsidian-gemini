---
name: audit-docs
description: Walk every user-facing doc in `docs/guide/`, `docs/reference/`, plus `README.md` and `AGENTS.md`, and validate each factual claim against the code (settings names + defaults, command-palette IDs, file paths, schedule formats, tool names). Patch drift in place; add new docs only for user-visible features that aren't covered. Use when the user asks to "audit the docs", "review the docs", "validate docs against the code", "find doc gaps", "sync docs with the codebase", or similar. Writes drift fixes + new docs to the working tree and stops; the caller (a human, or the `daily-update` meta-skill) is responsible for committing and opening a PR.
---

# Audit and extend the user-facing documentation

`docs/` is the canonical home for user-facing documentation in this repo (rendered to the public docs site via vitepress). `README.md` is the GitHub landing page; `AGENTS.md`/`CLAUDE.md` is the contributor handbook (CLAUDE.md is `@AGENTS.md`, so editing AGENTS.md updates both). This skill keeps all four honest: it verifies what's written still matches the code, and fills in docs for user-visible features the directory doesn't cover yet.

The docs are prose-forward and pragmatic — match that voice in anything you write. They are read by users (who have not seen the code) and by external contributors (who are about to read it). Optimize for both.

## Out-of-scope: bundled help references

`scripts/generate-help-references.mjs` runs at build time and regenerates `src/services/generated-help-references.ts` from `docs/guide/` and `docs/reference/`. **Do not hand-edit that file.** Adding or removing a markdown file in those directories automatically updates the in-app help skill — that's the whole point. If something looks stale in the bundled help, the fix is in the markdown source, not the generated TS.

## Workflow

Do these steps in order. Use `TodoWrite` to track them — long doc audits benefit from visible progress.

### 1. Read every targeted doc

Glob the four surfaces:

```bash
ls docs/guide/ docs/reference/ docs/contributing/
```

Read each file in `docs/guide/`, `docs/reference/`, plus `README.md` and `AGENTS.md` in full. Build a mental index keyed by surface: what each doc claims, what it says is shipped vs. deferred, what it says is out of scope.

`docs/contributing/` is also fair game (testing.md, tool-development.md, ai-policy.md, contributing.md) but the bar for "drift" there is whether the _workflow_ still matches reality, not whether every code reference is current. Skim, don't audit line-by-line.

### 2. Validate each doc against the code

For every factual claim a doc makes, confirm it in the tree. Examples of claims worth checking (non-exhaustive — these are the categories that drift fastest in this repo):

- **Settings names + defaults** — `docs/reference/settings.md` and `docs/reference/advanced-settings.md` claim a name and default for each setting. Compare against `src/settings.ts` (the `GeminiSettings` interface and `DEFAULT_SETTINGS` object). Watch for renames and migration entries.
- **Command palette IDs and labels** — every doc that says "Command Palette → X" implies a command exists with that name. `Grep` for `addCommand({` in `src/main.ts` and verify each `id` + `name` referenced.
- **Schedule formats** — `docs/guide/scheduled-tasks.md` lists `once`, `daily`, `weekly`, `interval:Xm`, `interval:Xh`. Compare against the schedule parser in `src/services/scheduled-task-manager.ts`.
- **Frontmatter fields** — task frontmatter (`schedule`, `enabledTools`, `outputPath`, `model`, `enabled`, `runIfMissed`) and any other YAML schema documented. Verify every documented field is read by the code, and every code-read field is documented.
- **Tool names** — `docs/guide/agent-mode.md` lists agent tools. Compare against actual tool registrations in `src/tools/`.
- **Folder paths** — `[state-folder]/History/`, `[state-folder]/Prompts/`, `[state-folder]/Agent-Sessions/`, `[state-folder]/Skills/`. Verify the code creates the same paths.
- **Model lists** — `src/models.ts` is the source of truth for available models and their capabilities. Drift here breaks user expectations.
- **Permission tier names** — `read_only`, `read_write`, `destructive`. These appear in multiple docs; one rename in code can leave several docs stale.
- **Tool gestures and UX claims** — drag-drop behavior, paste behavior, attachment limits (e.g. "20 MB cumulative"), file extensions classified as text vs. binary. Compare against `src/utils/file-classification.ts` and `src/ui/agent-view/`.
- **Loop detection thresholds** — `docs/reference/loop-detection.md` claims specific thresholds. Verify against `src/agent/agent-loop.ts` and tool loop config.

Record each discrepancy with file + line references. Don't fix drift inline as you find it; collect them and patch in step 4 so the reviewer sees a single tight diff per doc.

### 3. Identify user-visible features not covered

For each new feature shipped recently (use `git log --since="3 months ago" -- src/ | grep -E "^\s*(feat|feature)"` plus the existing `planning/changelog/` files if present), ask: _is there a guide or reference doc whose scope is mostly this feature?_

A feature is a candidate for a new doc when **all** are true:

1. It's user-visible (settings page, command palette, agent tool, frontmatter field, etc.) — not a refactor.
2. It's load-bearing — a primary surface, not a one-off helper.
3. Its current documentation is _zero_ — not "thin", "zero". Thin docs get expanded in place; missing docs get a new file.

The form of the feature matters: agent tools belong in `docs/guide/agent-mode.md` (one section per tool, not a new file). New top-level features (a new mode like "Projects", a new pipeline like the attachment classifier) warrant their own file under `docs/guide/`.

Don't create reference docs for internal abstractions (factory pattern, decorator, AgentLoop) — those belong in `AGENTS.md`. The `docs/reference/` directory is for user-facing references (settings, advanced settings, loop detection), not internal architecture.

### 4. Patch drift in existing docs

For each discrepancy collected in step 2, `Edit` the existing doc in place. Keep diffs minimal — one or two lines per drift item is typical. If the drift is conceptual (wrong claim about behavior, not just a stale name), call it out in the report so the commit message and PR body explicitly flag it.

If a setting was renamed and both the old and new name appear scattered through the docs, fix every occurrence in this pass — readers get whiplash from a half-renamed surface.

### 5. Write new docs

One markdown file per uncovered feature, placed in `docs/guide/` (for user-flow docs) or `docs/reference/` (for reference tables). Filename is kebab-case and matches the feature name (`projects.md`, not `04-projects.md`).

Match the structure of an existing similar doc — read `docs/guide/scheduled-tasks.md` or `docs/guide/agent-mode.md` to see the voice. Typical shape:

```markdown
# <Feature name>

<One-paragraph framing: what it does, why a user would reach for it.>

## Overview

<2–4 paragraphs of context. Where the feature lives in the UI; what files
or settings back it; where its output goes.>

## <Tasks the user can perform>

<Step-by-step or table-driven sections describing the user's actions.>

## <Reference table if the feature has structured config>

| Field | Required | Default | Description |

## Tips / Gotchas

<Bulleted list of non-obvious behaviors.>
```

Writing guidance:

- **Explain the why, not just the what.** The UI shows _what_; the doc's value is _why_ a user would reach for this and what the trade-offs are.
- **Show the path through the UI.** "Command Palette → Open Scheduler → New task" beats abstract description.
- **Link to neighbors.** Cross-reference other guides when a concept spans them.
- **Don't dump code into a user-facing doc.** Frontmatter examples are fine; TypeScript snippets are not.
- **Keep each doc focused.** 100–250 lines is the sweet spot; split if it sprawls.

If the new doc lives in `docs/guide/` or `docs/reference/`, the build step automatically picks it up for the bundled help skill — no extra wiring needed.

### 6. Stop — leave the changes in the working tree

This skill writes to the working tree and stops. Don't commit, don't push, don't open a PR — the caller owns that:

- **Invoked by `daily-update`:** the meta-skill packages everything into one PR alongside the other daily sub-skills' changes. Don't try to commit yourself or you'll fight it.
- **Invoked manually by the user:** they'll review the diff and either run `create-pr` or commit by hand. If the user explicitly asks for a PR, hand off to `create-pr`; don't reimplement the PR-opening dance here.

Before you stop, **report what you changed** so the caller can write a useful commit message — list new docs by filename + one-line purpose, and drift fixes by filename + what conceptually was wrong. If conceptual drift was found (wrong behavior claim, not just a stale name), call it out explicitly so it lands in the commit message that follows.

If nothing drifted and no new docs were warranted (a quiet day), say so plainly. Don't pad with "everything looks great." The caller may decide to skip committing entirely.

## What not to do

- **Don't edit `src/services/generated-help-references.ts`.** It's regenerated by `scripts/generate-help-references.mjs` at build time. Editing the markdown sources is the correct fix.
- **Don't fix code drift by editing code** as part of this task. Drift fixes belong in separate PRs with their own review. Docs work shouldn't hide code changes.
- **Don't update `src/release-notes.json` or `docs/changelog.md`.** Those are the version-release surface, not where doc updates land. The `release-process` skill owns them on version-bump days.
- **Don't invent settings or commands.** If a doc references something that doesn't exist in the code, the doc is wrong — delete the reference, don't make the code match the doc.
- **Don't write internal-architecture docs in `docs/`.** The factory/decorator pattern, the `AgentLoop` design, the AgentLoopHooks contract — those belong in `AGENTS.md`, which is already tracked in the repo for contributors.
- **Don't change voice.** If a doc reads like a user guide today, keep it that way. If you're tempted to add a "Why we built this" section, ask whether the user actually needs that, or whether you're adding it for yourself.

## Calibrating scope

A typical daily run will find 0–3 drift items (mostly stale defaults or recently-renamed settings) and need 0 new docs. A monthly or post-release run may find more. If the diff is sprawling, slow down and ask the caller whether to split it into themed PRs — one mass "audit fixes" PR is hard to review.
