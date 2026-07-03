---
name: auto-dev
description: Execute one tick of the autonomous issue-to-PR pipeline — triage open issues for readiness, draft implementation plans for maintainer approval, build the oldest approved issue into a PR, and address review feedback on the open automated PR. Designed to run as a recurring scheduled task that invokes this skill directly each tick in a full-toolchain sandbox; also invocable interactively as "/auto-dev" or "run an auto-dev tick", and as "/auto-dev dry-run" for a read-only report of what a tick would do. Never merges PRs. State lives in `auto:*` GitHub labels.
---

# Auto-dev: one tick of the issue-to-PR pipeline

This skill automates the path from open issue to reviewed PR while keeping the maintainer in control of two gates: **plan approval** (nothing is built without an approved plan) and **merge** (the skill never merges — ever). It is designed to run unattended on a regular cadence (spaced comfortably longer than one build tick — see **Overlap & isolation**); each invocation is **one tick of a state machine**, does the single highest-priority piece of work, and exits. "Waiting" (for a reply, an approval, a review, a merge) is simply what happens between ticks.

## Invariants — read these first

1. **Never merge a PR.** Not with `gh pr merge`, not via the API, not by enabling auto-merge. Merging is exclusively the maintainer's act, and a merge is what unblocks the pipeline for the next issue.
2. **At most `MAX_PRS_IN_FLIGHT` automated PRs in flight (default 6).** Building is gated on the count of open `auto/` PRs being _below_ this cap — not on zero. While at the cap, no new issue is built; ticks either advance an open PR toward merge or groom the backlog. Merges remain exclusively the maintainer's act (invariant 1); this cap only widens how many built-but-unmerged PRs may await review at once — it never merges, auto-merges, or closes anything.
3. **All runs happen under the maintainer's own GitHub identity**, so authorship cannot distinguish this pipeline from the human. Every comment this skill posts MUST begin with the marker line `<!-- auto-dev -->` (invisible in rendered Markdown). Classify comments into three buckets: **pipeline** (has the marker), **third-party bot** (author login ends in `[bot]` or `app/` — e.g. `coderabbitai`, `dependabot`; CodeRabbit posts auto-enrichment boilerplate on issues), and **human** (everything else). Only _human_ comments count as replies, answers, or approvals; third-party bot comments never satisfy "the human replied" and never gate-keep anything — read them for technical signal at most.
4. **Labels are the cross-run memory, and humans always win.** If a human has changed an `auto:*` label since the last tick (e.g. removed `auto:ready`, added `auto:skip`), respect the label as found — never "correct" it back.
5. **Self-enforced hard prohibitions.** There is no external permission allowlist anymore — this skill is the only guardrail, so treat the following as absolute and, if a tick ever seems to need one, stop and report it instead of doing it: never merge, close, or reopen any PR or issue; never force-push, and never push to `master`/`main` directly; never run the release process (`npm version`, `npm publish`, `gh release …`); never create, delete, or edit labels (only **apply or remove the `auto:*` labels** named below); never edit or delete human comments; never delete the repo, issues, or `gh api -X DELETE` anything; never run destructive or privileged shell (`rm -rf` outside the throwaway build sandbox, `sudo`, or `curl`/`wget` to exfiltrate). Working-tree resets are allowed **only** in the disposable scheduled sandbox (Step 0), never in an interactive checkout.
6. **Stay inside the repo's own conventions**: pre-flight checks, documentation policy, and the PR template all come from the `create-pr` skill and AGENTS.md, exactly as for human-driven work.

## Invocation modes

- **Scheduled (the primary mode):** a recurring scheduled task (e.g. a Claude scheduled task running in the cloud) fires `/auto-dev` on a cadence, in a fresh full-toolchain sandbox — git, Node, and `gh` authenticated as the maintainer. **There is no external runner script** and no permission allowlist: the skill owns its own setup (Step 0 establishes a clean `master` baseline and installs deps) and the exit report is the run's summary output. Because the sandbox is disposable, Step 0 may hard-reset it to a clean `master` — that is the one place a reset is allowed.
- **Interactive** (`/auto-dev` in a Claude Code session): identical decision logic, but under normal permission prompts and possibly in the maintainer's working checkout. **Never reset, clean, or stash an interactive checkout.** A dirty working tree or non-master branch does NOT block the GitHub-only steps (1-reconcile, 4-triage) — it only blocks steps that touch the working tree (2's CI/feedback fixes, 3-build). If a working-tree step is what the tick needs and the tree is dirty, report that and stop rather than stashing or resetting anything.
- **Dry run** (`/auto-dev dry-run`, or the user asks for a dry run): execute the full tick logic **read-only**. Gather all state, decide exactly what a live tick would do, and print it as the exit report with every action prefixed `would:` — but post no comments, change no labels, create no branches/commits/PRs, and push nothing. This is the recommended first test and is always safe to run.

**Overlap & isolation.** With no lockfile, the scheduled task must not overlap its own runs — set the cadence comfortably longer than a typical tick (a tick that builds can take many minutes). The label state machine is the backstop: work is claimed by swapping to `auto:in-progress`, and the build step is gated on the count of open `auto/` PRs being below `MAX_PRS_IN_FLIGHT`. Two truly concurrent ticks could still race — both picking the same oldest `auto:ready`, or a fresh tick mistaking a build that's mid-flight (labelled `auto:in-progress` but not yet PR'd) for a crashed orphan and rebuilding it. Step 1's **orphan age-gate** closes the second race (only reclaim a PR-less `auto:in-progress` issue once its label event is older than `ORPHAN_RECLAIM_MINUTES`); for the first, still don't schedule tighter than a build tick can finish. Each scheduled run is its own disposable sandbox, so runs never share a working tree.

**Tunables** (single source of truth — adjust here): `MAX_PRS_IN_FLIGHT = 6` — the most simultaneously-open `auto/` PRs allowed; while at the cap, ticks advance open PRs and groom the backlog but start no new build. `ORPHAN_RECLAIM_MINUTES = 90` — minimum age of a PR-less `auto:in-progress` issue before Step 1 treats it as a crashed build rather than one running concurrently. `FALLBACK_REVIEW_MINUTES = 60` — how long a ready, CI-green `auto/` PR may sit with zero review activity before Step 2 posts a fallback self-review (CodeRabbit normally reviews within minutes; past this window, assume it's rate-limited).

## Label state machine

| Label               | Meaning                                                                                                                                     | Who sets it                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| (no `auto:*` label) | Not yet triaged by auto-dev                                                                                                                 | —                                                     |
| `auto:needs-info`   | Skill asked a clarifying question; waiting on a human reply                                                                                 | skill                                                 |
| `auto:planned`      | Skill posted an implementation plan; waiting on approval                                                                                    | skill                                                 |
| `auto:ready`        | Plan approved; eligible to build                                                                                                            | skill (on detected approval) or human (directly)      |
| `auto:in-progress`  | Being built / has an open automated PR                                                                                                      | skill                                                 |
| `auto:parked`       | Assessed; the maintainer chose to hold it. Skill does not re-triage until the label is removed or a human comment is added _after_ the park | human (directly), or skill on a human "park it" reply |
| `auto:skip`         | Opt-out — auto-dev never touches this issue                                                                                                 | human                                                 |

**Eligibility:** all open issues, oldest first, EXCEPT issues labeled `auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, or `invalid`. Pull requests are never triaged as issues.

## The tick algorithm

Work through these steps in order — the order **is** the priority. Execute the **first step that has work**, finish it, print the exit report, and stop. The ordering puts concrete, human-approved progress ahead of speculative grooming: advancing an open PR (step 2) and **building an approved issue (step 3) both outrank the triage pass (step 4)**, because a ready build is work the maintainer has already greenlit while triage only feeds the queue. The key change from a single-PR pipeline: an open PR **no longer blocks building**. A tick advances an open PR only when one actually needs work (CI red, unaddressed feedback, a draft to resume, or a review-window timeout that triggers a fallback self-review); when every open PR is quiescent (waiting on the maintainer's review or merge) and the in-flight count is below `MAX_PRS_IN_FLIGHT`, the tick builds the next `auto:ready` issue instead. That's what drains the queue overnight — each merge-blocked-but-quiescent PR simply frees the tick to build the following issue, up to the cap. Triage runs on the ticks that would otherwise idle (all PRs quiescent, and either nothing is `auto:ready` or the cap is reached).

Do not fall through to later steps after completing one, with one exception chain for the **idle** case: when **step 2 finds every open PR quiescent** (nothing to advance), it falls through to **step 3 (build)**, which runs if the in-flight count is below `MAX_PRS_IN_FLIGHT` and something is `auto:ready`; if step 3 also has no work (at the cap, or nothing ready), it falls through to **step 4 (triage)**. A tick that _does_ advance a PR (fixes CI, answers feedback) stops there — that was its unit of work.

### Step 0 — Preflight & environment

First establish the working baseline. **The skill owns this now that there is no runner script.**

- **Scheduled (disposable sandbox)** — put the repo on a clean, current `master` and install deps (safe precisely because the sandbox is throwaway):

  ```bash
  git fetch origin --prune
  git checkout master && git reset --hard origin/master && git clean -fd
  git pull --ff-only origin master
  npm install --no-audit --no-fund
  ```

- **Interactive checkout** — do NOT reset, clean, or stash. Just observe state with `git status --porcelain`; a dirty tree or non-master branch only blocks the working-tree steps (see Invocation modes).

Then confirm GitHub access and identity:

```bash
gh auth status                      # must be authenticated (as the maintainer)
gh repo view --json nameWithOwner   # confirm the repo
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
- **No PR exists at all** — either a previous tick crashed between labeling and PR creation, or a build is running _right now_ in a concurrent tick. Distinguish by the age of the most recent `auto:in-progress` `labeled` event: if it is older than `ORPHAN_RECLAIM_MINUTES`, treat the issue as a crashed orphan and let step 3 rebuild it (its plan is already approved); if it is younger, assume a build is mid-flight and **leave the issue untouched this tick** — do not reclaim or rebuild. Read the label age from the timeline:

  ```bash
  gh api "repos/{owner}/{repo}/issues/<N>/timeline" --paginate \
    | jq -r '[.[] | select(.event=="labeled" and .label.name=="auto:in-progress")] | last | .created_at'
  ```

### Step 2 — Advance an open automated PR

If one or more automated PRs are open, pick the **single most-urgent** one to advance this tick (one PR per tick keeps the tick bounded). Urgency order, oldest-first within a tier: (1) a **draft** to resume, (2) **CI red**, (3) **unaddressed feedback** (the newest comment on a thread lacks the marker), (4) **unreviewed past the review window** — ready, CI green, no review activity from any human or third-party bot, older than `FALLBACK_REVIEW_MINUTES`, and no prior fallback self-review (see **Fallback self-review** below). A PR with none of these is **quiescent** — waiting on the maintainer's review or merge. If every open PR is quiescent, step 2 has no work: fall through to step 3 (build). Otherwise advance that one PR with the loop below and stop.

**Draft PR** (a yielded partial build from step 3): resume the implementation first — finish the plan, run the full pre-flight, push, and mark it ready with `gh pr ready`. Only then does the review loop below apply.

**Ready PR**: run one round of the review loop. The maintainer's user-level `coderabbit-review` skill describes the same loop in more depth — follow it when it is available (it is not part of this repo, so scheduled runs may not have it); the essentials below stand alone:

1. Fetch all four feedback surfaces: PR metadata + CI rollup, review summaries, inline review comments, and issue-style comments (`gh pr view`, `gh api .../pulls/N/reviews`, `.../pulls/N/comments`, `.../issues/N/comments`).
2. **CI red?** Fix CI first — check out the `auto/` branch, fix, run the repo pre-flight (`npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`), push.
3. **New feedback since the skill's last reply?** A thread is unaddressed if its newest comment lacks the `<!-- auto-dev -->` marker. Triage each item on its merits (CodeRabbit is not always right), fix valid items with **focused commits** (one logical fix per commit, conventional subjects), push, then **reply to every thread** — including ones you decline, with a one-sentence reason. Replies carry the marker.
4. **Human feedback** outranks bot feedback. If a human reviewer and CodeRabbit conflict, follow the human and say so in the reply to the bot.
5. **Scope creep requested in review?** Acknowledge in a reply, file a follow-up issue (it enters this same pipeline untriaged), link it, and keep the PR scoped.
6. **Nothing new** (no new comments, CI green, all threads answered, and the PR has review activity or a posted fallback self-review): this PR is quiescent, waiting on the maintainer's review or merge. Note it in the exit report; it isn't this tick's work. Since advancing it produced nothing, **fall through to step 3 (build)** — which builds the next `auto:ready` issue if the in-flight count is below `MAX_PRS_IN_FLIGHT`, or itself falls through to triage.

**Fallback self-review** (tier 4 — when CodeRabbit can't keep up): CodeRabbit normally reviews within minutes of a PR going ready; when it hits its rate limits it stays silent or posts only a rate-limit/"in queue" notice, and the PR would otherwise sit with no review signal at all, blocking the maintainer's merge decision. A PR qualifies when **all** of these hold:

- it is ready (not draft) and CI is green;
- it has **no review activity from any human or third-party bot** — no reviews, no inline review comments (a CodeRabbit rate-limit or queue notice does _not_ count as review activity);
- it has been ready for review longer than `FALLBACK_REVIEW_MINUTES` (from the PR's `createdAt`, or the latest `ready_for_review` timeline event if it started as a draft);
- it has no prior fallback self-review — no marker comment containing the `## Fallback review` heading. **At most one fallback self-review per PR**; that comment is the cross-tick memory.

Then review it yourself:

1. **Fresh-eyes adversarial review.** The pipeline wrote this diff, so don't trust the memory of writing it — re-read the full diff from scratch (`gh pr diff`) against the approved plan on the issue, applying the repo's **code-review** skill standards: correctness, error handling, edge cases, test coverage and quality, documentation policy, and AGENTS.md conventions. Actively look for reasons the change is wrong, not confirmation that it's right.
2. **Fix what's real.** Valid findings get fixed now, in this tick: check out the `auto/` branch, focused commits (one logical fix per commit), full pre-flight (`npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`), push.
3. **Post one summary comment** in the fallback-review format below: what was examined, findings fixed (with commit SHAs), and observations left to the maintainer's judgement. "No findings" is a valid, useful outcome — say it plainly rather than inventing nitpicks.
4. **Never submit a formal GitHub review** — no approval, no request-changes, not even a comment-type review. The summary is an ordinary PR comment. A self-review is a signal for the maintainer, not independent sign-off, and must never be dressed up to look like one.

After the fallback review is posted, the PR counts as quiescent. If CodeRabbit later catches up and reviews the PR, its feedback flows through the normal tier-3 handling — the fallback review never suppresses or substitutes for a real external review.

### Step 3 — Build (only if under the in-flight cap)

Runs when the number of open `auto/` PRs is **below `MAX_PRS_IN_FLIGHT`** **and** there is an `auto:ready` issue (or a reclaimed step-1 orphan) to build — building approved, human-greenlit work outranks the triage pass below, so it never waits behind backlog grooming. If the in-flight count is already at the cap, or nothing is `auto:ready`, this step has no work; fall through to step 4.

Because several PRs may be open at once, each build still branches from **fresh master** and is blind to the other open PRs' changes. Independent issues (disjoint files) are safe. When the oldest `auto:ready` issue obviously overlaps an already-open `auto/` PR's files, prefer the next non-overlapping `auto:ready` issue to reduce merge-time conflicts and note the skip in the exit report — a best-effort heuristic, not a guarantee; the maintainer resolves any residual conflict at merge/rebase time.

Take the **oldest** eligible `auto:ready` issue (or a step-1 orphan). Then:

1. Swap labels: remove `auto:ready`, add `auto:in-progress`.
2. Branch from fresh master: `git checkout master && git pull --ff-only && git checkout -b auto/issue-<N>-<short-slug>`.
3. Implement the approved plan as posted on the issue — the plan comment is the spec. Where reality diverges from the plan (an approach doesn't work, a file moved), prefer small sensible adaptation and document the deviation in the PR body; for a fundamental divergence, stop, comment on the issue explaining the blocker (marker), revert the label to `auto:planned`, and exit.
4. Follow the repo's documentation policy — docs updates ship in the same PR.
5. Run the full pre-flight: `npm run format-check`, `npm run build`, `npm test`, `npm run typecheck:test`. All green before pushing.
6. Create the PR with the **create-pr** skill (template, checklist, AI-disclosure section). The body must include `Fixes #<N>`, the marker line, and a note that this PR was produced by the auto-dev pipeline from the approved plan.
7. Comment on the issue (marker) linking the PR.

If the build cannot complete within this run's time/effort budget, push the WIP commits and open a **draft** PR (`gh pr create --draft`) before exiting — a bare pushed branch is invisible to the next tick, whose discovery queries only look at PRs and issues. The draft body still carries `Fixes #<N>` and the marker, plus a note that the build is incomplete and will be resumed. Never mark a PR ready for review (`gh pr ready`) while pre-flight checks fail.

### Step 4 — Triage pass (bounded)

Walk eligible open issues oldest→newest. Act on at most **5** issues per tick (count only issues where you actually post/relabel; skipped issues are free). To stay cheap on idle ticks, only deep-read an issue's thread when it might have changed: an `auto:*`-labelled issue whose `updatedAt` is no newer than the skill's own last marker comment on it has nothing new — skip it without re-reading (for `auto:parked`, the baseline is the park-time label event, not a marker comment). For each issue that needs a look, read the full thread, then branch on its current `auto:*` state:

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
- **`auto:parked`** — the maintainer chose to hold this; it rests until they re-engage. The unblock baseline is **when `auto:parked` was applied**, _not_ the skill's last marker comment — so a rationale the maintainer records _at park time_ doesn't bounce the issue straight back out. Read the park time from the most recent `auto:parked` `labeled` event on the issue timeline:

  ```bash
  gh api "repos/{owner}/{repo}/issues/<N>/timeline" --paginate \
    | jq -r '[.[] | select(.event=="labeled" and .label.name=="auto:parked")] | last | .created_at'
  ```

  Two unblock signals:
  - _A human comment (no marker, not a third-party bot) newer than the park time_ (the maintainer came back with detail or direction) → unblocked: remove `auto:parked` and re-triage it this tick as if freshly labelled (plan if now plannable, otherwise ask / re-propose).
  - _The human removed the label_ → it reappears with no `auto:*` label and re-enters triage through the no-label branch; nothing special to do.
  - _Otherwise_ (still parked, no human comment after the park) → skip silently. **Never re-propose parking, re-ask, or re-plan a parked issue.**

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

A parked issue is durable rest, not abandonment: the skill picks it back up the moment the maintainer removes `auto:parked` or adds a comment _after_ the park (a rationale left at park time is recorded but does not re-activate it — see the `auto:parked` triage branch).

## Fallback review comment format

Posted on a PR by step 2's fallback self-review. The `## Fallback review` heading is load-bearing — it is how later ticks detect that a fallback review already exists — so keep it verbatim.

```markdown
<!-- auto-dev -->

## Fallback review

No external review arrived within the review window (CodeRabbit appears rate-limited), so this is the pipeline's own fresh-eyes review of the diff against the approved plan. It is a **self-review** — treat it as a signal, not independent sign-off.

**Examined:** <scope: files/areas reviewed, and what they were checked against>

**Fixed in this review:**

- <finding> — fixed in <sha>
- _(or "nothing — no defects found")_

**For your judgement:**

- <observation or trade-off the maintainer should weigh before merging>
- _(or "nothing flagged")_
```

## Exit report

Every tick ends by printing a structured report — it is the run's summary output (the scheduled task surfaces it; an interactive run shows it inline):

```text
auto-dev tick — <ISO timestamp>
step executed: <0-failed | 1-reconcile | 2-pr-advance | 3-build | 4-triage | 5-idle>
open auto PRs: <count>/<MAX_PRS_IN_FLIGHT> — #<n> (<status>), … | none
actions:
- #123: asked 2 clarifying questions → auto:needs-info
- #145: plan approved by reply → auto:ready
- #151: proposed parking (design fork is the maintainer's call) → auto:needs-info
- #152: maintainer replied "park it" → auto:parked
- PR #210: fixed 2 CodeRabbit findings, replied to 4 threads, pushed <sha>
- PR #212: no external review after 60m — self-reviewed, fixed 1 finding (<sha>), posted fallback review
blocked on human:
- PR #210 awaiting review/merge
- #145 ready to build once #210 merges
errors: <none | details>
```

## What not to do

- Don't merge, approve, or enable auto-merge on any PR.
- Don't submit a formal GitHub review of any kind on the pipeline's own PRs — the fallback self-review is a plain comment, never an approval or request-changes.
- Don't post more than one fallback self-review per PR, and don't self-review a PR that already has human or third-party review activity — the fallback exists only to fill the gap when CodeRabbit can't keep up.
- Don't start a new build while already at `MAX_PRS_IN_FLIGHT` open `auto/` PRs.
- Don't post a second question/plan when the previous one is still unanswered.
- Don't park an issue on your own initiative — only _propose_ parking; the maintainer parks by replying "park it" or adding the label. (`auto:parked` is set by the skill solely on a human park reply, or by the human directly.)
- Don't re-propose parking, re-ask, or re-plan an `auto:parked` issue — it rests until the maintainer removes the label or adds a comment _after_ the park. Don't remove `auto:parked` yourself except when re-triaging it because the maintainer commented after parking.
- Don't touch `auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, or `invalid` issues, and don't remove `auto:skip` ever.
- Don't apply or change non-`auto:*` labels — categorization belongs to the `triage-issues` skill.
- Don't close issues, edit issue bodies, or modify human comments.
- Don't expand a PR's scope in response to review; file a follow-up issue instead.
- Don't bypass failing checks (`--no-verify`, skipping tests) to get a PR out.
- Don't reach for any of the self-enforced hard prohibitions (invariant 5) — there is no external allowlist to catch you now, so the skill's own discipline is the only guardrail. If a tick seems to require one, stop and report it in the exit report instead.
