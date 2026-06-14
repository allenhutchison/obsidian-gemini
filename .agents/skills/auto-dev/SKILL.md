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
- **Interactive** (`/auto-dev` in a Claude Code session): identical behavior, but under normal permission prompts and possibly in the maintainer's working checkout. A dirty working tree or non-master branch does NOT block the GitHub-only steps (1-reconcile, 4-triage) — it only blocks steps that touch the working tree (2's CI/feedback fixes, 3-build). If a working-tree step is what the tick needs and the tree is dirty, report that and stop rather than stashing or resetting anything.
- **Dry run** (`/auto-dev dry-run`, or the user asks for a dry run): execute the full tick logic **read-only**. Gather all state, decide exactly what a live tick would do, and print it as the exit report with every action prefixed `would:` — but post no comments, change no labels, create no branches/commits/PRs, and push nothing. This is the recommended first test and is always safe to run.

## Label state machine

| Label               | Meaning                                                                                                                       | Who sets it                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| (no `auto:*` label) | Not yet triaged by auto-dev                                                                                                   | —                                                     |
| `auto:needs-info`   | Skill asked a clarifying question; waiting on a human reply                                                                   | skill                                                 |
| `auto:planned`      | Skill posted an implementation plan; waiting on approval                                                                      | skill                                                 |
| `auto:ready`        | Plan approved; eligible to build                                                                                              | skill (on detected approval) or human (directly)      |
| `auto:in-progress`  | Being built / has an open automated PR                                                                                        | skill                                                 |
| `auto:parked`       | Assessed; the maintainer chose to hold it. Skill does not re-triage until the label is removed or a new human comment appears | human (directly), or skill on a human "park it" reply |
| `auto:skip`         | Opt-out — auto-dev never touches this issue                                                                                   | human                                                 |

**Eligibility:** all open issues, oldest first, EXCEPT issues labeled `auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, or `invalid`. Pull requests are never triaged as issues.

## The tick algorithm

Work through these steps in order — the order **is** the priority. Execute the **first step that has work**, finish it, print the exit report, and stop. The ordering puts concrete, human-approved progress ahead of speculative grooming: advancing an open PR (step 2) and **building an approved issue (step 3) both outrank the triage pass (step 4)**, because a ready build is work the maintainer has already greenlit while triage only feeds the queue. Triage therefore runs on the ticks that would otherwise idle — when an open PR is merely waiting on the human, or when nothing is queued to build. Because at most one PR is in flight and merges are human-paced, most ticks either advance the open PR or, finding it idle, fall through to triage, so the backlog is still groomed steadily; it just never preempts a ready build.

Do not fall through to later steps after completing one, with one exception: **step 2 falls through to the triage pass (step 4) when the open PR needs nothing** — that waiting tick is spent grooming the backlog instead of idling. (The build step is skipped on those ticks regardless: it is gated on no PR being open.)

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
- **No PR exists at all** (a previous tick crashed between labeling and PR creation): treat the issue as `auto:ready` in step 3 (build) — its plan is already approved.

### Step 2 — Advance the open automated PR

If an automated PR is open, this tick belongs to it.

**Draft PR** (a yielded partial build from step 3): resume the implementation first — finish the plan, run the full pre-flight, push, and mark it ready with `gh pr ready`. Only then does the review loop below apply.

**Ready PR**: run one round of the review loop. The maintainer's user-level `coderabbit-review` skill describes the same loop in more depth — follow it when it is available (it is not part of this repo, so scheduled runs may not have it); the essentials below stand alone:

1. Fetch all four feedback surfaces: PR metadata + CI rollup, review summaries, inline review comments, and issue-style comments (`gh pr view`, `gh api .../pulls/N/reviews`, `.../pulls/N/comments`, `.../issues/N/comments`).
2. **CI red?** Fix CI first — check out the `auto/` branch, fix, run the repo pre-flight (`npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`), push.
3. **New feedback since the skill's last reply?** A thread is unaddressed if its newest comment lacks the `<!-- auto-dev -->` marker. Triage each item on its merits (CodeRabbit is not always right), fix valid items with **focused commits** (one logical fix per commit, conventional subjects), push, then **reply to every thread** — including ones you decline, with a one-sentence reason. Replies carry the marker.
4. **Human feedback** outranks bot feedback. If a human reviewer and CodeRabbit conflict, follow the human and say so in the reply to the bot.
5. **Scope creep requested in review?** Acknowledge in a reply, file a follow-up issue (it enters this same pipeline untriaged), link it, and keep the PR scoped.
6. **Nothing new** (no new comments, CI green, all threads answered): the PR is waiting on review or merge. Print that in the exit report and **fall through to the triage pass (step 4, triage only)** — never build, since a PR is already in flight.

### Step 3 — Build (only if NO automated PR is open)

Runs only when no automated PR is in flight **and** there is an `auto:ready` issue (or a step-1 orphan) to build — building approved, human-greenlit work outranks the triage pass below, so it never waits behind backlog grooming. If a PR is open, or nothing is `auto:ready`, this step has no work; fall through to step 4.

Take the **oldest** `auto:ready` issue (or a step-1 orphan). Then:

1. Swap labels: remove `auto:ready`, add `auto:in-progress`.
2. Branch from fresh master: `git checkout master && git pull --ff-only && git checkout -b auto/issue-<N>-<short-slug>`.
3. Implement the approved plan as posted on the issue — the plan comment is the spec. Where reality diverges from the plan (an approach doesn't work, a file moved), prefer small sensible adaptation and document the deviation in the PR body; for a fundamental divergence, stop, comment on the issue explaining the blocker (marker), revert the label to `auto:planned`, and exit.
4. Follow the repo's documentation policy — docs updates ship in the same PR.
5. Run the full pre-flight: `npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`. All green before pushing.
6. Create the PR with the **create-pr** skill (template, checklist, AI-disclosure section). The body must include `Fixes #<N>`, the marker line, and a note that this PR was produced by the auto-dev pipeline from the approved plan.
7. Comment on the issue (marker) linking the PR.

If the build cannot complete inside this tick's budget, push the WIP commits and open a **draft** PR (`gh pr create --draft`) before exiting — a bare pushed branch is invisible to the next tick, whose discovery queries only look at PRs and issues. The draft body still carries `Fixes #<N>` and the marker, plus a note that the build is incomplete and will be resumed. Never mark a PR ready for review (`gh pr ready`) while pre-flight checks fail.

### Step 4 — Triage pass (bounded)

Walk eligible open issues oldest→newest. Act on at most **5** issues per tick (count only issues where you actually post/relabel; skipped issues are free). To stay cheap on idle ticks, only deep-read an issue's thread when it might have changed: an `auto:*`-labelled issue whose `updatedAt` is no newer than the skill's own last marker comment on it has nothing new — skip it without re-reading. For each issue that needs a look, read the full thread, then branch on its current `auto:*` state:

- **No `auto:*` label** — assess whether the issue contains enough to plan from (clear problem, scoped outcome, no unresolved design fork):
  - _Plannable_ → draft an implementation plan (format below), post it as a comment, add `auto:planned`.
  - _Not plannable, and the gap is missing facts the maintainer can supply_ → post one comment asking the specific missing questions (numbered, concrete — not "please clarify"), add `auto:needs-info`.
  - _Not plannable because it needs a maintainer decision the skill can't make_ — a design fork that's theirs to resolve, a dependency on still-open work, or the issue body itself signals deferral ("not actionable yet", "revisit once X lands") → post a **park proposal** (format below): name the blocker, offer to park it, and say what would unblock it. Add `auto:needs-info` (the proposal is awaiting the maintainer's call). **The skill never parks on its own — it only proposes; the maintainer parks.**
- **`auto:needs-info`** — is there a _human_ comment (no marker, not a third-party bot) newer than the skill's last marker comment?
  - _No_ → skip silently. This is the "already asked, no reply" rule.
  - _Yes, and it says to park_ ("park it", "hold", "not now", "park", or a 👍 on a park proposal) → swap label to `auto:parked`.
  - _Yes, and it resolves the questions_ → draft and post the plan, swap label to `auto:planned`.
  - _Yes, but it raises new ambiguity_ → ask the follow-up (stay `auto:needs-info`) — but if this would be the third unanswered round-trip, stop asking and either propose parking or leave a final note that the issue needs maintainer attention.
- **`auto:planned`** — is there a _human_ comment (not a third-party bot) newer than the plan?
  - _Approval_ (e.g. "approved", "LGTM", "go ahead", "yes do it", a 👍-only reply) → swap label to `auto:ready`. "Approved, but change X" counts as approval: update the plan comment-thread with the revision first, then mark ready.
  - _Substantive feedback / objections_ → revise, post the updated plan (marker), stay `auto:planned`.
  - _A request to park_ ("not now", "let's hold this") → swap label to `auto:parked`.
  - _No reply_ → skip silently.
  - The human adding `auto:ready` directly is always approval, reply or not.
- **`auto:parked`** — the maintainer chose to hold this; it rests until they re-engage. Two unblock signals:
  - _A new human comment since the skill's last marker comment_ (the maintainer added detail or direction) → unblocked: remove `auto:parked` and re-triage it this tick as if freshly labelled (plan if now plannable, otherwise ask / re-propose).
  - _The human removed the label_ → it reappears with no `auto:*` label and re-enters triage through the no-label branch; nothing special to do.
  - _Otherwise_ (still parked, no new human comment) → skip silently. **Never re-propose parking, re-ask, or re-plan a parked issue.**
- **`auto:ready` / `auto:in-progress`** — leave for steps 1 and 3.

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

## Park proposal comment format

Use this when an issue can't move forward because it needs a maintainer decision the skill can't make — not missing facts, but a judgement call, a design fork, or a dependency on other work. It **proposes** parking and waits; it never parks on its own.

```markdown
<!-- auto-dev -->

This isn't blocked on missing detail — it's waiting on a call that's yours to make:

<1–3 sentences naming the blocker: the design fork, the open dependency, or why the issue reads as deferred>

Want me to **park** it for now? Reply "park it" (or add the `auto:parked` label) and I'll leave it untouched until you remove the label or add more detail to the issue. If you'd rather move it forward, here's what would unblock it: <the specific decision or input needed>.
```

A parked issue is durable rest, not abandonment: the skill picks it back up the moment the maintainer removes `auto:parked` or adds a new comment.

## Exit report

Every tick ends by printing a structured report to stdout (the runner appends it to the log):

```text
auto-dev tick — <ISO timestamp>
step executed: <0-failed | 1-reconcile | 2-pr-advance | 3-build | 4-triage | 5-idle>
open auto PR: #<n> (<status>) | none
actions:
- #123: asked 2 clarifying questions → auto:needs-info
- #145: plan approved by reply → auto:ready
- #151: proposed parking (design fork is the maintainer's call) → auto:needs-info
- #152: maintainer replied "park it" → auto:parked
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
- Don't park an issue on your own initiative — only _propose_ parking; the maintainer parks by replying "park it" or adding the label. (`auto:parked` is set by the skill solely on a human park reply, or by the human directly.)
- Don't re-propose parking, re-ask, or re-plan an `auto:parked` issue — it rests until the maintainer removes the label or adds a new comment. Don't remove `auto:parked` yourself except when re-triaging it because the maintainer just commented.
- Don't touch `auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, or `invalid` issues, and don't remove `auto:skip` ever.
- Don't apply or change non-`auto:*` labels — categorization belongs to the `triage-issues` skill.
- Don't close issues, edit issue bodies, or modify human comments.
- Don't expand a PR's scope in response to review; file a follow-up issue instead.
- Don't bypass failing checks (`--no-verify`, skipping tests) to get a PR out.
- Don't work around permission denials from the runner's allowlist — report them in the exit report so the allowlist can be tuned deliberately.
