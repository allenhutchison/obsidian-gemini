---
name: triage-issues
description: Walk every open issue with no labels and apply appropriate labels via `gh`. Conservative — never closes, reassigns, or invents labels; only adds existing ones. Use when the user asks to "triage issues", "label issues", "do issue triage", "label the unlabeled issues", "clean up the issue tracker", or similar. Has direct GitHub side-effects (label mutations); the working tree is unaffected. Reports a structured summary so the `daily-update` meta-skill or a human caller can audit what was applied.
---

# Triage open issues

obsidian-gemini's issue tracker accumulates issues from users, contributors, and the maintainer. Many land without labels, which makes filtering and reporting harder later. This skill works through the unlabeled backlog and applies labels from the repo's existing label vocabulary based on the issue's content.

This skill is **deliberately conservative**:

- It only **applies** labels — never closes, reassigns, links, or comments.
- It only uses labels that already exist in the repo.
- When the issue is ambiguous, it abstains rather than guess.
- It is safe to run repeatedly; previously-labeled issues are skipped automatically.

## Workflow

### 1. Load the repo's label vocabulary

```bash
gh label list --repo allenhutchison/obsidian-gemini --limit 100 \
  --json name,description
```

Hold this list in working memory. **Do not invent labels.** If the issue genuinely needs a label that doesn't exist, flag it in the report and let the human decide whether to create it (label creation is out of scope for this skill).

The repo currently has two practical label families. Check the live list each run; the exact set drifts:

- **General intent**: `bug`, `enhancement`, `documentation`, `question`, `help wanted`, `good first issue`, `duplicate`, `invalid`, `wontfix`
- **Area**: `agent-config`, `architecture`, `chat-ux`, `file-context`, `tool-execution`, `models`, `quick-win`, `epic`
- **Auto-applied** (do not apply by hand): `codex`, `automated`, `dependencies`, `javascript`, `github_actions` — these are set by automation and labelling them manually adds noise.

### 2. List unlabeled open issues

```bash
gh issue list --repo allenhutchison/obsidian-gemini \
  --state open --search "no:label" \
  --limit 100 \
  --json number,title,body,author,createdAt
```

If the result is empty, write a one-line "no unlabeled issues" report and stop. This is the common case on a well-tended tracker.

If the count is unusually large (>20 in a single run), still process them, but flag the pile-up in the report — it usually means triage hasn't run recently, or new issues are arriving faster than expected.

### 3. Read and classify each issue

For each issue:

1. **Read the title and body in full.** Don't classify from the title alone — bug reports and feature requests can look identical at a glance.
2. **Decide the intent label** (exactly one):
   - `bug` — describes broken behavior, includes reproduction steps or "expected vs. actual"
   - `enhancement` — proposes new functionality or an improvement to existing functionality
   - `documentation` — reports a doc problem or asks for documentation
   - `question` — asks how to do something, or seeks clarification on existing behavior
   - **abstain** if the issue is too vague to classify (very short, no context, or genuinely ambiguous) — leave it unlabeled and surface in the report
3. **Decide area label(s)** (zero or more, additive):
   - `agent-config` — agent prompts, system prompt, model selection, agent profiles, projects
   - `tool-execution` — tool calls, tool registry, tool safety, loop detection, tool permission tiers
   - `file-context` — context system, file linking, attachment pipeline, drag-and-drop
   - `chat-ux` — chat view UI, agent view UI, modals, status bar, ergonomics
   - `architecture` — plumbing, services, lifecycle, refactors, internal structure
   - `models` — model availability, model migration, model-specific bugs
   - `quick-win` — only if the issue is small and self-contained AND the maintainer would likely accept the change without further design discussion
   - `epic` — only for explicit tracking issues that group multiple sub-issues together; very rarely the right call from triage
4. **Hold the proposed labels in memory.** Don't apply yet — apply in step 4 so the report reflects what was actually requested.

Calibration:

- A bug _can_ have an area label, and usually does.
- A `question` rarely needs an area label — it's usually best left as a single label until the user clarifies what they're asking about.
- Don't reach for `quick-win` unless the issue is genuinely small. The label exists to help contributors find approachable work; mislabelling it teaches contributors to ignore the label.
- `documentation` issues should also get an area label when the affected doc is area-specific (`docs/guide/agent-mode.md` → `agent-config`); skip it for cross-cutting doc changes.

### 4. Apply the labels

For each issue with at least one proposed label, apply them:

```bash
gh issue edit <NUMBER> --repo allenhutchison/obsidian-gemini \
  --add-label "<label1>" --add-label "<label2>"
```

`gh issue edit --add-label` is idempotent — re-running on an already-labeled issue is a no-op. The "no:label" filter in step 2 should already exclude these, but the idempotency is a useful safety net if a previous run was partial.

Capture each application as `(issue_number, [labels_applied], one-line-rationale)` for the report.

If `gh` errors on a particular issue (rate limit, transient failure), capture the error, **continue with the next issue**, and surface the failed issue in the report. A failed run partway through is worse than a complete-with-warnings run.

### 5. Report

Print a structured summary so the caller (a human, or the `daily-update` meta-skill) can audit:

```text
Triage report — YYYY-MM-DD

Issues processed: N
Issues labeled: M
Issues abstained: K (left unlabeled, see below)
Errors: E

Labeled:
- #710 bug + tool-execution — "tool call hangs after model returns empty function-call array"
- #715 enhancement + agent-config — "let me share an agent profile via deep link"
- ...

Abstained (need human review):
- #720 — "this is great" (no actionable content)
- ...

Suggested new labels (issue mentioned a category that doesn't exist):
- "ios-mobile" suggested by 3 issues; not currently a label
- ...

Errors:
- #722 — gh returned 502; retry needed
```

When invoked by `daily-update`, this report becomes the "triage-issues" line in the day's PR body — the meta-skill paraphrases the structured form into prose for the PR, but should preserve the issue numbers and applied labels verbatim so a reviewer can audit.

## What not to do

- **Don't close issues.** Even obvious "no longer relevant" cases get a `wontfix` label at most, and even then only if the maintainer has previously closed similar issues — not on this skill's first hunch. Closing is a maintainer call.
- **Don't reassign issues** or set milestones. This skill is read-and-label only.
- **Don't comment on issues.** Triage labels are silent — they don't notify the reporter, which is the right behavior. A comment turns a quiet curation pass into noise in the reporter's notifications.
- **Don't invent labels.** If the issue genuinely calls for a category that doesn't exist (`mobile`, `windows`, `gemini-2.5`), surface it in the "Suggested new labels" section of the report. Let the maintainer decide whether to create the label.
- **Don't reapply auto-labels.** `codex`, `automated`, `dependencies`, `javascript`, `github_actions` are owned by automation. If they're missing from a bot-generated PR or issue, that's a CI bug, not a triage gap.
- **Don't process pull requests.** This skill operates on issues only. PR labels are a different vocabulary (auto-applied by Dependabot, CodeRabbit, etc.) and editing them would interfere with that automation. If you accidentally pull PRs in the listing, filter them client-side (`gh issue list` should not include PRs, but verify the result shape).
- **Don't update the daily changelog or docs.** This skill has GitHub side-effects, not working-tree side-effects. The `daily-update` meta-skill includes the triage summary in the daily PR body even when the working tree is clean.

## Calibrating scope

A healthy tracker accumulates 0–3 unlabeled issues per day. A run that processes that many is the steady state. A run that finds >10 means the backlog has grown — flag it so the maintainer knows to look. A run that finds 0 is a no-op; report and stop.
