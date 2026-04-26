---
name: daily-changelog
description: Generate a daily changelog from the PRs that merged on a given date and write it to `planning/changelog/YYYY-MM-DD.md`. Use when the user asks for "the daily changelog", "what shipped today/yesterday", "what landed on <date>", "write up today's changes", "summarize the day's PRs", or any variant of "what merged on <date>". Defaults to yesterday when no date is given. Distinct from `src/release-notes.json` (per-version, user-facing) and `docs/changelog.md` (the rendered version stream) — this is an internal day-by-day record. Always writes one markdown file per day to `planning/changelog/`.
---

# Daily changelog

This skill turns a day's worth of merged PRs into a short, readable changelog at `planning/changelog/YYYY-MM-DD.md`. It exists because obsidian-gemini ships through PRs (per `AGENTS.md` and team convention — no direct pushes to master), so "what shipped on day X" is exactly "which PRs merged on day X."

The output is for humans skimming the project's history later — not for marketing, and not for users. **It is distinct from**:

- `src/release-notes.json` — the source of truth for the in-app modal and the rendered docs site changelog. That file is updated only when a new plugin **version** ships (see the `release-process` skill).
- `docs/changelog.md` — the vitepress page that renders `src/release-notes.json` for the docs site.

The daily changelog is internal. It captures the day-by-day flow between version bumps. Optimize for _what changed and why_, with enough detail that a reader can decide whether to dig into the PR.

## Workflow

### 1. Pick the date

If the user named a date, use it. Otherwise default to **yesterday in the user's local timezone** — today's work is usually still in flight, and "daily changelog" is a retrospective format.

Resolve the date to ISO `YYYY-MM-DD`. Today's date is in the system context; subtract one day for the default.

If the user says something ambiguous like "this week" or "the last few days", ask which single day they want — this skill writes one file per day. Offer to run it once per day in the range if they want a batch.

### 2. Find the PRs that merged that day

GitHub's `merged:YYYY-MM-DD` shorthand interprets the date in UTC, which silently misclassifies PRs merged late local-evening for anyone west of UTC. Always use a local-timezone-anchored ISO range so the day boundary matches what the user means by "today" / "yesterday":

```bash
TZ_OFFSET=$(date +%z)        # e.g. "-0700"
TZ_FORMATTED="${TZ_OFFSET:0:3}:${TZ_OFFSET:3}"  # → "-07:00"

gh pr list --repo allenhutchison/obsidian-gemini \
  --state merged \
  --search "merged:YYYY-MM-DDT00:00:00${TZ_FORMATTED}..YYYY-MM-DDT23:59:59${TZ_FORMATTED}" \
  --limit 200 \
  --json number,title,url,author,mergedAt,body,headRefName,additions,deletions
```

`--limit 200` is well above any realistic per-day PR count for this project. **After fetching, check whether the returned count equals the limit** — if `len(results) == 200`, you've hit the _local_ fetch cap, so bump `--limit` and re-fetch. Separately, the GitHub Search API hard-caps results at 1000 even with paging; if you ever approach that on a single day (extremely unusual here), narrow the window — split the day into morning/afternoon halves and run two queries.

If the result is empty, write the file anyway with a one-line "no PRs merged" entry. An empty day is itself signal (was the maintainer out? freeze?) and the file's existence keeps the daily cadence visible.

### 3. Pull the body for each PR

The list query above already includes `body`. If you need more (review comments, the actual diff stat by file, linked issues), use:

```bash
gh pr view <N> --json title,body,commits,files,reviews
```

You usually don't need this — the PR title plus body is enough for the summary. Only dig in if a PR's body is empty or unhelpful.

**Ignore the CodeRabbit auto-generated block at the end of every body.** It starts with `<!-- This is an auto-generated comment: release notes by coderabbit.ai -->` followed by `## Summary by CodeRabbit`, and it's a generic restatement of what the human Summary already covered. Paraphrasing both produces redundant, marketing-flavored notes. Read only the human-authored sections (typically `## Summary`, `## Changes`, `## Test plan` per the repo's PR template).

### 4. Credit external contributors

obsidian-gemini accepts external contributions (saheersk and others have shipped multiple PRs). When the PR's `author.login` is not `allenhutchison`:

- Mention the contributor in the entry: `Contributed by @<login>.`
- Don't editorialize about the maintainer's takeover/cleanup — that's PR-thread context, not changelog content.

### 5. Write the Markdown

File path: `planning/changelog/YYYY-MM-DD.md`. Create `planning/changelog/` if it doesn't exist.

If the file already exists, **read it first**. The user may have hand-edited prior notes; don't blow that away. Default behavior: regenerate fresh and overwrite, but call out in your reply that you replaced the file. If the user wants merge-don't-replace behavior, they'll say so.

Use this template:

```markdown
# Daily changelog — <Month DD, YYYY>

**Date:** YYYY-MM-DD
**PRs merged:** <N>

---

## Summary

<One short paragraph (2–4 sentences) framing the day. Lead with the most consequential change. If the day was thin, say "Quiet day — <one-liner>." Don't pad.>

## What shipped

### [#<num> <PR title>](url)

<1–3 sentences describing what the PR does and _why_, drawn from the PR body. If the PR body is empty or just "see commit", fall back to the title and `gh pr view`'s commit messages.>

<Optional second paragraph if the PR has a non-obvious follow-up, caveat, or migration step worth flagging.>

<Optional `Contributed by @<login>.` line for external contributors.>

### [#<num> <PR title>](url)

...
```

Order PRs by `mergedAt` ascending (chronological). Don't try to invent thematic groupings unless the day genuinely clusters into 2–3 themes — chronological is honest and easy to scan.

### 6. Tell the user what you wrote

After writing, reply with:

- The file path
- The PR count
- One line on the day's shape (e.g., "mostly bugfixes" / "feature-heavy day" / "scheduler infra cleanup")

Don't paste the whole file back. The user can open it.

## Voice and style

Match the PR-template voice — prose-forward, explains the _why_, doesn't shout in all-caps. A few specifics:

- **No emojis** in the file. The PR template doesn't use them and neither should this.
- **No marketing language** ("excited to announce", "powerful new"). State what changed.
- **Link to the PR**, always. The PR is the source of truth; the changelog entry is a pointer.
- **Don't list every commit.** A PR can have 12 commits; the reader cares about the PR's net effect, not the commit-by-commit history. Use commits only when the PR body is unhelpful and you need to reconstruct what happened.
- **Quote the PR body sparingly.** Paraphrase to one tight paragraph. If the PR body is already a clean two-sentence Summary, you can lift it nearly verbatim — but trim ceremony.
- **Be honest about scope.** A PR that's "Address CR feedback" is a fixup, not a feature. Say so. Trivial PRs can collapse to a single line.

## What not to do

- **Don't write release notes for an arbitrary date range in one file.** One date → one file. If asked for a week, generate seven files (or ask the user to pick a single day).
- **Don't include direct commits to master.** The repo's convention is PR-only (per `AGENTS.md`). If a stray non-merge commit landed on master on that date, mention it in the Summary as an exception, but don't fabricate a "PR" entry for it.
- **Don't fetch the full diff** unless a PR body is actively unhelpful. The diff is large and you rarely need it; the PR body and commit messages are usually sufficient.
- **Don't commit the file** as part of this skill unless the user asks. Just write it. When invoked by `daily-update`, the wrapper handles the commit + PR flow. When invoked manually, the user reviews and decides.
- **Don't update `src/release-notes.json` or `docs/changelog.md`.** Those are the user-facing version-release surface, not the daily activity log. They're handled by the `release-process` skill on version-bump days.
- **Don't generate "Future work" or "Next steps" sections.** This is a retrospective of what shipped, not a plan. Forward-looking content lives in PR descriptions and issues.

## Edge cases

- **Squash-merged PRs with no merge commit.** Doesn't matter — `gh pr list --search "merged:DATE"` finds them by merge timestamp regardless of merge strategy. The repo predominantly uses squash merges.
- **PRs merged across midnight UTC.** Already handled by the local-tz query in step 2 — every PR sorts onto the user-local day it actually shipped on. Nothing extra to do here.
- **Reverts.** Treat the revert PR as its own entry. Don't try to silently retract the original PR's entry from a prior day's file.
- **Dependabot / automated PRs.** Include them. Group multiple bot PRs under one entry if there are many on the same day ("Dependency bumps: #X, #Y, #Z — minor/patch updates to A, B, C"). The repo's auto-applied `dependencies` label makes them easy to spot.
- **Version-bump PRs.** When a PR is the version-bump that triggers a release (touches `package.json`, `manifest.json`, `versions.json`, `src/release-notes.json`), call out the new version in the entry. The reader benefits from the version landmark.
