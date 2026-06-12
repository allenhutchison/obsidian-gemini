---
name: auto-dev
description: Execute one tick of the autonomous issue-to-PR pipeline — triage open issues for readiness, draft implementation plans for maintainer approval, build the oldest approved issue into a PR, and address review feedback on the open automated PR. Designed for unattended scheduled runs (`scripts/auto-dev.sh`); also invocable interactively as "/auto-dev" or "run an auto-dev tick", and as "/auto-dev dry-run" for a read-only report of what a tick would do. Never merges PRs. State lives in `auto:*` GitHub labels.
---

# Auto-dev: one tick of the issue-to-PR pipeline

This skill automates the path from open issue to reviewed PR while keeping the maintainer in control of two gates: **plan approval** (nothing is built without an approved plan) and **merge** (the skill never merges — ever). It is designed to run unattended every 15–30 minutes; each invocation is **one tick of a state machine**, does the single highest-priority piece of work, and exits. "Waiting" (for a reply, an approval, a review, a merge) is simply what happens between ticks.

## Invariants — read these first

1. **Never merge a PR.** Not with `gh pr merge`, not via the API, not by enabling auto-merge. Merging is exclusively the maintainer's act, and a merge is what unblocks the pipeline for the next issue.
2. **At most one automated PR in flight.** While any auto-dev PR is open, no new issue gets built. Ticks spent in that state only advance the open PR.
3. **All runs happen under the maintainer's own GitHub identity**, so authorship cannot distinguish this pipeline from the human. Every comment this skill posts MUST begin with the marker line `<!-- auto-dev -->` (invisible in rendered Markdown). Classify comments into three buckets: **pipeline** (has the marker), **third-party bot** (author login ends in `[bot]` or `app/` — e.g. `coderabbitai`, `dependabot`; CodeRabbit posts auto-enrichment boilerplate on issues), and **human** (everything else). Only _human_ comments count as replies, answers, or approvals; third-party bot comments never satisfy "the human replied" and never gate-keep anything — read them for technical signal at most.
4. **Labels are the cross-run memory, and humans always win.** If a human has changed an `auto:*` label since the last tick (e.g. removed `auto:ready`, added `auto:skip`), respect the label as found — never "correct" it back.
5. **Never force-push**, never push to `master` directly, never run the release process, never create or delete labels, never close issues, never edit or delete human comments.
6. **Stay inside the repo's own conventions**: pre-flight checks, documentation policy, and the PR template all come from the `create-pr` skill and AGENTS.md, exactly as for human-driven work.

## Invocation modes

- **Scheduled** (`scripts/auto-dev.sh`): headless, in the dedicated clone, against the curated allowlist. The runner guarantees a clean tree on fresh master.
- **Interactive** (`/auto-dev` in a Claude Code session): identical behavior, but under normal permission prompts and possibly in the maintainer's working checkout. A dirty working tree or non-master branch does NOT block the GitHub-only steps (1-reconcile, 3-triage) — it only blocks steps that touch the working tree (2's CI/feedback fixes, 4-build). If a working-tree step is what the tick needs and the tree is dirty, report that and stop rather than stashing or resetting anything.
- **Dry run** (`/auto-dev dry-run`, or the user asks for a dry run): execute the full tick logic **read-only**. Gather all state, decide exactly what a live tick would do, and print it as the exit report with every action prefixed `would:` — but post no comments, change no labels, create no branches/commits/PRs, and push nothing. This is the recommended first test and is always safe to run.

## Label state machine

| Label               | Meaning                                                     | Who sets it                                      |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| (no `auto:*` label) | Not yet triaged by auto-dev                                 | —                                                |
| `auto:needs-info`   | Skill asked a clarifying question; waiting on a human reply | skill                                            |
| `auto:planned`      | Skill posted an implementation plan; waiting on approval    | skill                                            |
| `auto:ready`        | Plan approved; eligible to build                            | skill (on detected approval) or human (directly) |
| `auto:in-progress`  | Being built / has an open automated PR                      | skill                                            |
| `auto:skip`         | Opt-out — auto-dev never touches this issue                 | human                                            |

**Eligibility:** all open issues, oldest first, EXCEPT issues labeled `auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, or `invalid`. Pull requests are never triaged as issues.

## The tick algorithm

Work through these steps in order. Execute the **first step that has work**, finish it, print the exit report, and stop. Do not fall through to later steps after completing one (exception: step 2 falls through to step 3 when the open PR needs nothing).

### Step 0 — Preflight

```bash
gh auth status                      # must be authenticated
gh repo view --json nameWithOwner   # confirm the repo
git status --porcelain              # clean in scheduled runs; in interactive runs a dirty tree only blocks working-tree steps
```

Gather the current state in parallel:

```bash
# Open automated PRs (branch prefix is the identity signal)
gh pr list --state open --json number,headRefName,title,reviewDecision,mergeable \
  | jq '[.[] | select(.headRefName | startswith("auto/"))]'

# All open issues, oldest first
gh issue list --state open --limit 200 \
  --json number,title,labels,createdAt,updatedAt --search "sort:created-asc"

# Recently closed automated PRs (for step 1's orphan/closure handling)
gh pr list --state closed --limit 10 --json number,headRefName,mergedAt,closedAt \
  | jq '[.[] | select(.headRefName | startswith("auto/"))]'
```

If `gh` auth or repo resolution fails, print the failure in the exit report and stop — do not attempt repairs.

### Step 1 — Reconcile finished work

For issues labeled `auto:in-progress`:

- **PR merged** (or issue closed by `Fixes #N`): remove `auto:in-progress`. If the issue is somehow still open after its PR merged, comment (with marker) linking the merged PR and noting it may be closable — but leave closing to the human.
- **PR closed without merging**: treat as rejection of the approach. Remove `auto:in-progress`, add `auto:skip`, and comment (with marker) that the PR was closed unmerged and the issue needs human direction before auto-dev will touch it again.
- **No PR exists at all** (a previous tick crashed between labeling and PR creation): treat the issue as `auto:ready` in step 4 — its plan is already approved.

### Step 2 — Advance the open automated PR

If an automated PR is open, this tick belongs to it. Follow the `coderabbit-review` skill's loop if it is available; the essentials:

1. Fetch all four feedback surfaces: PR metadata + CI rollup, review summaries, inline review comments, and issue-style comments (`gh pr view`, `gh api .../pulls/N/reviews`, `.../pulls/N/comments`, `.../issues/N/comments`).
2. **CI red?** Fix CI first — check out the `auto/` branch, fix, run the repo pre-flight (`npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`), push.
3. **New feedback since the skill's last reply?** A thread is unaddressed if its newest comment lacks the `<!-- auto-dev -->` marker. Triage each item on its merits (CodeRabbit is not always right), fix valid items with **focused commits** (one logical fix per commit, conventional subjects), push, then **reply to every thread** — including ones you decline, with a one-sentence reason. Replies carry the marker.
4. **Human feedback** outranks bot feedback. If a human reviewer and CodeRabbit conflict, follow the human and say so in the reply to the bot.
5. **Scope creep requested in review?** Acknowledge in a reply, file a follow-up issue (it enters this same pipeline untriaged), link it, and keep the PR scoped.
6. **Nothing new** (no new comments, CI green, all threads answered): the PR is waiting on review or merge. Print that in the exit report and **fall through to step 3 (triage only)** — never to step 4.

### Step 3 — Triage pass (bounded)

Walk eligible open issues oldest→newest. Act on at most **5** issues per tick (count only issues where you actually post/relabel; skipped issues are free). For each issue, read the full thread, then branch on its current `auto:*` state:

- **No `auto:*` label** — assess whether the issue contains enough to plan from (clear problem, scoped outcome, no unresolved design fork):
  - _Plannable_ → draft an implementation plan (format below), post it as a comment, add `auto:planned`.
  - _Not plannable_ → post one comment asking the specific missing questions (numbered, concrete — not "please clarify"), add `auto:needs-info`.
- **`auto:needs-info`** — is there a _human_ comment (no marker, not a third-party bot) newer than the skill's last marker comment?
  - _No_ → skip silently. This is the "already asked, no reply" rule.
  - _Yes_ → incorporate the reply. If it resolves the questions, draft and post the plan, swap label to `auto:planned`. If it raises new ambiguity, ask the follow-up (stay `auto:needs-info`) — but if this would be the third unanswered round-trip, stop asking and leave a final note that the issue needs maintainer attention.
- **`auto:planned`** — is there a _human_ comment (not a third-party bot) newer than the plan?
  - _Approval_ (e.g. "approved", "LGTM", "go ahead", "yes do it", a 👍-only reply) → swap label to `auto:ready`. "Approved, but change X" counts as approval: update the plan comment-thread with the revision first, then mark ready.
  - _Substantive feedback / objections_ → revise, post the updated plan (marker), stay `auto:planned`.
  - _No reply_ → skip silently.
  - The human adding `auto:ready` directly is always approval, reply or not.
- **`auto:ready` / `auto:in-progress`** — leave for steps 1 and 4.

### Step 4 — Build (only if NO automated PR is open)

Take the **oldest** `auto:ready` issue (or a step-1 orphan). Then:

1. Swap labels: remove `auto:ready`, add `auto:in-progress`.
2. Branch from fresh master: `git checkout master && git pull --ff-only && git checkout -b auto/issue-<N>-<short-slug>`.
3. Implement the approved plan as posted on the issue — the plan comment is the spec. Where reality diverges from the plan (an approach doesn't work, a file moved), prefer small sensible adaptation and document the deviation in the PR body; for a fundamental divergence, stop, comment on the issue explaining the blocker (marker), revert the label to `auto:planned`, and exit.
4. Follow the repo's documentation policy — docs updates ship in the same PR.
5. Run the full pre-flight: `npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`. All green before pushing.
6. Create the PR with the **create-pr** skill (template, checklist, AI-disclosure section). The body must include `Fixes #<N>`, the marker line, and a note that this PR was produced by the auto-dev pipeline from the approved plan.
7. Comment on the issue (marker) linking the PR.

If the build cannot complete inside this tick's budget, push the branch with WIP commits and exit reporting partial progress — the next tick's step 1/2 will find the branch. Do **not** open a PR that fails pre-flight checks.

### Step 5 — Nothing to do

If no step had work: print "no work to be done" with the counts (open PRs awaiting human review/merge, issues awaiting replies, issues awaiting approval) and exit.

## Plan comment format

```markdown
<!-- auto-dev -->

## Proposed implementation plan

**Approach:** <2–4 sentences: what will change and why this approach>

**Changes:**

- `path/to/file.ts` — <what>
- <new files, tests, docs to update>

**Testing:** <unit tests to add/extend; manual verification if UI>

**Out of scope:** <explicitly excluded, if anything notable>

---

Reply with an approval ("approved", "LGTM", "go ahead") to queue this for implementation, reply with changes to revise the plan, or add the `auto:skip` label to opt this issue out of automation.
```

Plans follow the repo's "Implementation Planning" convention (plans live in the issue). Keep them honest about size — if an issue is too large to land as one reviewable PR, the plan should say so and propose the first slice only.

## Question comment format

```markdown
<!-- auto-dev -->

Before this can be planned for implementation, a few things need clarification:

1. <specific question>
2. <specific question>

---

Reply here and the next automation pass will pick it up, or add the `auto:skip` label to opt this issue out of automation.
```

## Exit report

Every tick ends by printing a structured report to stdout (the runner appends it to the log):

```text
auto-dev tick — <ISO timestamp>
step executed: <0-failed | 1-reconcile | 2-pr-advance | 3-triage | 4-build | 5-idle>
open auto PR: #<n> (<status>) | none
actions:
- #123: asked 2 clarifying questions → auto:needs-info
- #145: plan approved by reply → auto:ready
- PR #210: fixed 2 CodeRabbit findings, replied to 4 threads, pushed <sha>
blocked on human:
- PR #210 awaiting review/merge
- #145 ready to build once #210 merges
errors: <none | details>
```

## What not to do

- Don't merge, approve, or enable auto-merge on any PR.
- Don't start a second build while an automated PR is open.
- Don't post a second question/plan when the previous one is still unanswered.
- Don't touch `auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, or `invalid` issues, and don't remove `auto:skip` ever.
- Don't apply or change non-`auto:*` labels — categorization belongs to the `triage-issues` skill.
- Don't close issues, edit issue bodies, or modify human comments.
- Don't expand a PR's scope in response to review; file a follow-up issue instead.
- Don't bypass failing checks (`--no-verify`, skipping tests) to get a PR out.
- Don't work around permission denials from the runner's allowlist — report them in the exit report so the allowlist can be tuned deliberately.
