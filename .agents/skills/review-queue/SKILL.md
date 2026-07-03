---
name: review-queue
description: The maintainer's daily console for the auto-dev pipeline — the human half of the auto-dev skill. Gathers everything currently blocked on you (the open automated PR awaiting review/merge, plans awaiting approval, questions and park proposals awaiting an answer, parked issues to revisit, and brand-new untriaged issues), presents it as a one-line worklist, then loops: you reply with an issue/PR number and your decision, the skill executes that decision against the `auto:*` state machine **as you** (never with the auto-dev marker), and re-presents the shrinking list until the queue is drained or you say you're done. Use when the user says "review the pipeline", "what needs my input", "review the issue queue", "process the auto-dev queue", "check what auto-dev is waiting on", "let's do the daily review", "approve/answer/park #N", or similar. Never merges on its own. Never builds issues — it only feeds your decisions back to the pipeline.
---

# Review queue: the maintainer's console for the auto-dev pipeline

`auto-dev` runs headless on a cron schedule and advances the **machine half** of the issue-to-PR pipeline — triaging, planning, building, and answering review feedback. It deliberately stops at the two gates only a human can clear: **plan approval** and **merge**, plus anything it flags as needing your judgement (clarifying questions, park proposals, design forks).

This skill is the **human half**: a single interactive session where you clear those gates. It surfaces everything blocked on you, you decide item by item, and it writes your decisions back into the `auto:*` labels and issue comments that the next cron tick reads. Think of it as processing an inbox to empty.

The label state machine, eligibility rules, and comment-classification conventions are owned by the **auto-dev** skill (`.agents/skills/auto-dev/SKILL.md`) and `AGENTS.md` — read those for the authoritative semantics. This skill only **drives** that machine from the human side; it never duplicates the machine's own work (it does not triage-plan or build).

## Invariants — read these first

1. **You are the human. Never use the auto-dev marker.** Every comment this skill posts is _your_ input to the pipeline. It MUST NOT begin with `<!-- auto-dev -->` and MUST NOT imitate the pipeline's comment templates. auto-dev classifies any marker comment as its _own_ output and ignores it as human input — so a marked comment would make your decision **invisible** to the next tick. This is the single most important rule.
2. **Never merge automatically.** Merging is your deliberate act and is what unblocks the pipeline for the next build. The skill may run `gh pr merge` ONLY when you explicitly tell it to merge a specific PR in this session, and even then it confirms first. Default posture: it surfaces the PR and you merge (in the browser or by explicit instruction). Never enable auto-merge.
3. **You decide; the skill executes.** It never invents or infers a decision you didn't state. For each item it shows the context and waits for your call, then performs exactly the state transition you asked for.
4. **Humans always win, but don't fight a tick mid-flight.** Your label/comment edits are always safe (the pipeline treats human label changes as authoritative). But don't implement/build issues from this skill — that's auto-dev's job. If you want to take an issue over yourself, the skill adds `auto:skip` first so a scheduled tick can't build it concurrently.
5. **Stay within the `auto:*` namespace.** Don't add or change non-`auto:*` labels (categorization belongs to the `triage-issues` skill). Don't remove `auto:skip` unless you say so. Don't close human issues or edit human comments without your explicit instruction.

## The session loop

Repeat until the queue is **drained** (nothing is blocked on you — every open item is closed, `auto:ready`/`auto:in-progress`, or resting in a state that's waiting on the _bot_, not you) or you say **"done"** / "that's enough for today".

### 1 — Gather (one batch of read-only calls)

```bash
gh auth status >/dev/null && gh repo view --json nameWithOwner

# Open automated PR(s): the merge gate
gh pr list --state open --json number,title,headRefName,reviewDecision,mergeable,updatedAt \
  | jq '[.[] | select(.headRefName | startswith("auto/"))]'

# Everything in a human-gated label state, plus brand-new untriaged issues
gh issue list --state open --limit 200 \
  --json number,title,labels,createdAt,updatedAt --search "sort:created-asc"
```

Bucket the open issues by their `auto:*` state. For new/untriaged ones, apply the same eligibility exclusions auto-dev uses (`auto:skip`, `epic`, `question`, `wontfix`, `duplicate`, `invalid`) — surface the rest. For the open PR, also pull its CI + review surfaces only when you choose to act on it (don't fetch all threads for every item up front — keep the gather cheap).

To keep the list signal-dense, note how long each item has waited (from `updatedAt` / the relevant comment time) so stale items stand out.

### 2 — Present the worklist

One line per item, grouped and prioritized so the most pipeline-unblocking work is first. Lead each line with the number and a 3–8 word gist of what's blocked on you:

```
Pipeline review — <date>

🔴 PR awaiting your review/merge (unblocks the next build)
  • PR #986  per-use-case thinkingLevel — CI green, CodeRabbit approved, mergeable

🟠 Plans awaiting approval (auto:planned)        — approve → queues a build
  • #663  AgentLoop streaming follow-ups — plan posted 1d ago
  • #670  obsidian:// URI handler — v1-slice plan posted 1d ago

🟡 Questions / park proposals awaiting you (auto:needs-info)
  • #641  SVG support — 3 questions (rasterize now vs. block on #536)
  • #447  Gemini API capabilities — 3 questions, 2d unanswered

🟢 Parked — revisit? (auto:parked)
  • (none)

⚪ New / untriaged — weigh in before a tick plans it
  • #990  bug: completions stall on large notes

Reply with an item and your decision — e.g. "#663 approved", "#641 use client-side
rasterization now", "park #447", "skip #990", "merge #986" — or "done" to end.
```

If nothing is blocked on you, say so plainly (e.g. "Queue's clear — the only open item is PR #986 waiting on you to merge" or "Nothing needs you right now") and stop.

### 3 — Act on your reply

Parse the item number and your stated decision, map it to the transition below, and execute it. Post comments **as you, with no marker.** Confirm before anything outward-facing-and-hard-to-reverse (merge, close, `auto:skip`); routine label flips and comments that carry your stated decision can proceed without a second prompt. If your reply is ambiguous (e.g. an approval that also reshapes the plan), ask one quick disambiguating question rather than guessing.

When you give your answer/feedback in chat, the skill posts a faithful rendering of _your words_ as the issue/PR comment — it doesn't editorialize, summarize away your intent, or add pipeline boilerplate.

### 4 — Re-gather and re-present

Pull fresh state and show the now-shorter list. Loop.

### 5 — Stop and summarize

When drained or dismissed, print a short session summary: what you decided, what's now queued to build (`auto:ready`, oldest-first), what's still waiting on the bot, and anything still genuinely needing you later.

## Decision → action map

**A plan (`auto:planned`):**

- **Approve** ("approved", "lgtm", "go", "ship it") → add `auto:ready`. The oldest `auto:ready` builds on the next tick that's under the in-flight cap (`MAX_PRS_IN_FLIGHT`).
- **Approve with a tweak** ("approved, but use X") → post your tweak as a plain comment, then add `auto:ready` (the build adapts to the latest comment). If the change is large enough to reshape the plan, instead post the change and leave `auto:planned` so the next tick re-plans — ask which you want if it's unclear.
- **Request changes** → post your feedback as a comment; leave `auto:planned` (next tick revises the plan).
- **Not now** → `auto:parked` (hold, revisit later) or `auto:skip` (opt out entirely), per your words. If you give a reason, record it the park-safe way (below).
- **I'll do this one** → `auto:skip` (so a tick won't build it concurrently); you implement it normally and remove `auto:skip` later to hand it back, or close it via your PR.

**A question or park proposal (`auto:needs-info`):**

- **Answer it** → post your answer as a comment; the next tick incorporates it (plans, or asks a follow-up).
- **Park it** → add `auto:parked` (it rests until you remove the label or add a comment _after_ the park). If you give a reason, record it the park-safe way (below).
- **Skip** → `auto:skip`.

**A parked issue (`auto:parked`):**

- **Unpark with direction** → remove `auto:parked` and post the new detail/decision as a comment; it re-enters triage with your input.
- **Decide the design** → post your decision; either remove `auto:parked` to let the bot re-plan, or, if you've fully specced it, write the plan yourself and set the label you want (`auto:planned` for the bot to confirm, or straight to `auto:ready`).
- **Keep holding** → leave it; move on.

> **Parking with a reason — order matters.** auto-dev keys a parked issue's unblock off **when `auto:parked` was applied** (the label event on the timeline). So when you park _with_ a rationale, post the reason as a plain comment **first, then apply the label** — the comment ends up older than the park event, so it's recorded without bouncing the issue back into triage. Apply the label first and comment after, and the next tick reads that comment as "the maintainer came back" and un-parks it. (Unparking later is exactly this: a comment _after_ the park, or removing the label.)

**A new / untriaged issue:**

- **Pre-empt** → `auto:skip` (bot never touches it), `auto:parked` (hold), or hand-write a plan + `auto:planned`/`auto:ready`.
- **Add detail** → comment, then leave it for the next tick to triage.
- **Leave it** → do nothing; the bot will triage it on a future tick.

**The open automated PR:**

- **Surface** its CI rollup, CodeRabbit/human review threads, and mergeable state (`gh pr view`, `gh pr checks`, the reviews/comments APIs). Say where the review signal came from: CodeRabbit, a human, or the pipeline's own **fallback self-review** (a marker comment with a `## Fallback review` heading, posted when CodeRabbit was rate-limited) — a PR whose only review is the pipeline's self-review deserves your closer look before merging.
- **Review deeper** → hand off to the user-level `coderabbit-review` skill or `/code-review`; don't reimplement a review here.
- **Leave feedback** → post review comments **as you** (no marker). The next tick addresses them and replies.
- **Merge** → only on your explicit instruction for that PR, with a confirmation. After a merge, offer to clear a stale `auto:in-progress` label on the fixed issue (the next reconcile tick would otherwise do it).
- **Close without merging** → only if you say so; the next tick will treat that as rejecting the approach.

## What not to do

- Never add `<!-- auto-dev -->` to anything you post, and never mimic the pipeline's plan/question/park templates — your comments must read as human input or the pipeline ignores them.
- Never merge, close, or `auto:skip` without your explicit say-so (and confirm merges/closes first). Never enable auto-merge.
- Never build or implement an issue from this skill — feed the decision to the pipeline, or take it over manually after adding `auto:skip`.
- Never change non-`auto:*` labels; never remove `auto:skip` unless told.
- Never post a decision you inferred rather than one the maintainer stated. When unsure, ask.

## Example turn

> **Worklist shows #663 (plan), #670 (plan), #641 (question), PR #986.**
>
> **You:** "#663 approved. For #641 let's do client-side rasterization now, cap at 2048px. Merge #986."
>
> **Skill:**
>
> - #663 → adds `auto:ready` (queued to build).
> - #641 → posts your comment ("Let's go with client-side rasterization now, capped at 2048px on the longest edge…") as you, no marker; leaves `auto:needs-info` so the next tick re-reads it and plans. (Or, if you'd rather, swaps to no-label to force a fresh triage — it asks if unsure.)
> - PR #986 → confirms ("Merge #986 into master?"), then `gh pr merge`, then offers to clear `auto:in-progress` on #621.
> - Re-presents the shorter list.
