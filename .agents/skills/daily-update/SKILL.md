---
name: daily-update
description: Run obsidian-gemini's per-day housekeeping skills (daily-changelog, audit-docs, triage-issues) and package whatever they wrote into one PR. Use when the user asks to "do the daily update", "run the daily skills", "morning sweep", "end-of-day cleanup", or when invoked by a scheduled remote agent doing the daily run. Bundles the per-day skills behind one entry point so a single /schedule slot covers the whole routine. Safe to invoke manually at any time.
---

# Daily update — orchestrate per-day housekeeping skills

The user's `/schedule` slots are limited (~15), so this skill bundles the per-day housekeeping skills behind one entry point. It runs each sub-skill in sequence, lets each one write to the working tree (or, in the case of `triage-issues`, apply labels directly on GitHub), and packages the combined diff into a single PR at the end.

The working-tree sub-skills are deliberately "write-only" — they don't commit or push. That's this skill's job. Centralizing the side-effects means: one PR per daily run (easy to review), no empty PRs on quiet days (don't commit if nothing changed), and adding a new daily sub-skill is a one-line list edit here rather than another /schedule slot.

## The sub-skills

Run these in order. Each one's full workflow lives in its own SKILL.md — read it and execute it as if it had been invoked directly. Do not re-implement the logic here.

1. **`daily-changelog`** → `.agents/skills/daily-changelog/SKILL.md`
   - Default: yesterday in the user's local timezone.
   - Writes one file: `planning/changelog/YYYY-MM-DD.md`.

2. **`audit-docs`** → `.agents/skills/audit-docs/SKILL.md`
   - Audits `docs/guide/`, `docs/reference/`, `README.md`, and `AGENTS.md` against the code; writes drift fixes and any new docs.
   - On a quiet day, may write nothing — that's fine.

3. **`triage-issues`** → `.agents/skills/triage-issues/SKILL.md`
   - Lists open issues with no labels and applies appropriate labels via `gh`.
   - This sub-skill has GitHub side-effects — labels are applied directly. The working tree is unaffected.
   - Capture the count of issues labeled and the labels applied; surface it in the PR body even when the working tree is clean.

When adding a new daily sub-skill in the future, append it here with the same shape (name → path → one-line outcome). Order matters only when sub-skills overlap on output paths (today they don't).

## Workflow

### 1. Start a fresh branch off master

```bash
git checkout master && git pull
git checkout -b daily-update-$(date +%Y-%m-%d)
```

If a branch by that exact name already exists locally (the cron fired twice, or a manual run already happened today), append `-2`, `-3`, etc. — never reuse a branch from a previous run; the diff would conflate two days.

### 2. Run each sub-skill in sequence

For each sub-skill in the list above:

- Read its `SKILL.md`.
- Execute the workflow it describes, writing to the working tree (or applying labels, in the case of `triage-issues`).
- When it's done, capture a one-line outcome ("wrote planning/changelog/2026-04-25.md, 6 PRs" / "no drift, no new docs warranted" / "labeled 4 issues: #710 enhancement+agent-config, ..."). You'll need these for the commit message and the PR body.

If a sub-skill errors out partway, **don't abort the whole run**. Capture the error, move on to the next sub-skill. A daily run that flags one broken sub-skill is more useful than a daily run that breaks halfway and leaves the others un-attempted.

### 3. Package the changes

Check what's in the working tree:

```bash
git status --short
```

Decide what to do based on three cases:

**Case A — the working tree is clean and `triage-issues` did nothing.** Quiet day:

- Don't commit. Don't push. Don't open a PR. Empty PRs are noise.
- Delete the branch you just created (`git checkout master && git branch -D daily-update-YYYY-MM-DD`) so the local branch list stays clean.
- Report "no daily changes" and stop. The cron's job is done; absence of a PR is the signal.

**Case B — the working tree is clean but `triage-issues` applied labels.** Report-only day:

- Don't open a PR. Labels on GitHub are already applied — opening an empty-diff PR just to write a summary is more friction than it's worth.
- Delete the branch (same as Case A).
- Reply with the triage summary so a human can audit the labels if they want.

**Case C — the working tree has changes.** Commit them all in one commit:

```text
chore(daily): YYYY-MM-DD daily update

- daily-changelog: <one-line outcome>
- audit-docs: <one-line outcome>
- triage-issues: <one-line outcome>

[any errors that occurred during sub-skill execution]
```

Then push and hand off to the **`create-pr`** skill (`.agents/skills/create-pr/SKILL.md`) to open the PR. That skill enforces the repo's PR template and runs the pre-flight checks (`npm run format-check`, `npm run build`, `npm test`). Do not bypass it — the daily PR plays by the same rules as any other.

PR body should list each sub-skill's outcome again with the file paths it touched (and, for `triage-issues`, the issue numbers labeled and what label was applied to each), so a reviewer can navigate the diff by sub-skill. A regular (non-draft) PR is fine; mark draft only if `audit-docs` made conceptual drift fixes that benefit from a slower read.

### 4. Report

Reply to the caller with:

- One line per sub-skill: ok / no-op / error (with the message if errored).
- The PR URL, or "no PR — labels-only run, see triage summary above" / "no changes — no PR" depending on the case.

That's it. Don't paste the PR body or the commit message back — the URL is enough for a human, and the cron only needs the success/failure signal.

## What not to do

- **Don't bundle sub-skill changes into separate commits.** One commit per daily run. The PR is the unit of review.
- **Don't open a PR with no diff.** Quiet days are valid signal; the absence of a PR is the message. Triage-only days report inline, no PR.
- **Don't push to master.** Always a branch + PR per repo convention (see `AGENTS.md`).
- **Don't skip the pre-flight checks.** `create-pr` runs `npm run format-check`, `npm run build`, `npm test` for a reason. If `audit-docs` added a new markdown file that breaks vitepress, you want to know before the PR is open.
- **Don't reuse a branch from a prior daily run.** Each run gets its own branch; same-day re-runs append a suffix.
- **Don't try to "fix" a failing sub-skill from inside this skill.** Capture the error, move on, and let a human triage it from the run report.
- **Don't reimplement sub-skill logic here.** Read the sub-skill's SKILL.md and follow it. If a sub-skill needs a behavior change, edit _that_ skill's SKILL.md and ship it as a separate PR.
- **Don't apply documentation changes from `audit-docs` and forget to update `src/release-notes.json`.** The audit skill works against rendered docs; if it surfaces a user-visible behavior gap, file an issue rather than backfilling release notes after the fact. Daily-update is housekeeping, not feature work.

## When sub-skills fight

Today the three sub-skills write to disjoint surfaces (`planning/changelog/`, `docs/`+`README.md`+`AGENTS.md`, GitHub labels). If a future sub-skill ends up touching the same files as another, run them in dependency order (whoever generates the input first) and call out the dependency in the list above. If two sub-skills genuinely conflict on the same file, that's a sign one of them is mis-scoped — flag it and stop, don't paper over it with merge logic in this skill.
