---
name: plugin-test
description: Three-pass acceptance test for the obsidian-gemini plugin — unit tests, then UI/state via the Obsidian CLI (cheap pass), then API-spending verification (only with explicit user authorization). Driven by the user-facing docs as the source of truth for what should work, with extra focus on functionality shipped since the last release. The agent acts as judge between passes; later passes only run when the earlier ones pass cleanly. Use when the user asks to "test the plugin", "smoke test the release", "verify before release", "run the pre-release tests", "act as a judge on the plugin", or similar. Has Obsidian-CLI side effects (modal opens, plugin reloads, screenshots) but does NOT modify source code or commit; reports go to the working tree under `planning/test-reports/`.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: Requires Obsidian desktop with the CLI enabled and the plugin installed in a vault. The Obsidian CLI must be reachable on PATH.
---

# Plugin acceptance test (three passes, agent as judge)

This skill is the deterministic counterpart to a human pre-release run-through. It tests the plugin in three escalating passes — cheapest first, most expensive last — and the agent decides between each pass whether it makes sense to continue. The test list comes from the user-facing docs (so anything documented stays honest), with extra weight on functionality merged since the last release tag (so the most likely regressions get the most attention).

The skill is conservative on cost and side effects. Pass 1 spends nothing. Pass 2 takes screenshots and clicks through UI but never makes a Gemini API call. Pass 3 is the only pass that spends real API tokens, and it only runs after the agent has reported pass-2 results to the user and the user has explicitly said to proceed.

## When to use this skill

- The user is preparing a release and wants the plugin smoke-tested first
- The user asks "act as a judge on the plugin" / "test what's new" / "verify before I tag"
- A maintainer wants a regression sweep after a large refactor
- Don't use this skill for normal development debugging — for that, use the `obsidian-cli` skill directly. This skill is heavyweight; reach for it when you need a top-to-bottom check.

## Inputs

The user usually invokes this with no arguments. They may optionally specify:

- A vault name to target (defaults to `Test Vault` — see vault guard below)
- A focus area ("just test the scheduler", "skip pass 3") — if specified, narrow the relevant pass

## Vault guard (mandatory preflight, before any other action)

This skill performs destructive actions: plugin reloads, opening modals, planting fake state, taking screenshots, and (in Pass 3) generating files via the API. Running it against the wrong vault — particularly the user's production vault — is unacceptable.

**The Obsidian CLI has a critical footgun**: `vault=<name>` is effectively decorative — empirically it does not route by name. The CLI always targets the focused Obsidian window regardless of what's passed. So you cannot redirect the skill to a non-focused vault by passing a flag; the user has to make the test vault the active window themselves. And because focus can drift (a click into another window) or the user may Cmd-Tab without realizing it, the safest posture is: **only the test vault should be open at all** for the duration of the run.

The guard has two parts. Both are mandatory; do not skip either.

### Part 1 — Ask the user to prepare Obsidian (before any CLI call)

Before running any `obsidian` command, post this exact preparation message in the conversation and **wait for explicit confirmation**:

> Before I start the test run, please prepare Obsidian:
>
> 1. **Close every Obsidian vault except the test vault.** Even if the CLI is supposed to target a specific window, focus can drift mid-run, so the only safe way to avoid accidentally modifying production is to have just the test vault open.
> 2. **Open the test vault** (default: `Test Vault`) and make sure it's the focused window.
> 3. **Save and close any unsaved work** in the test vault — Pass 2 reloads the plugin and opens modals; Pass 3 may write generated files.
>
> Reply "ready" once Obsidian has only the test vault open and focused. If you'd like to use a different test vault, tell me the name.

Do not proceed until the user replies affirmatively. If they reply with a different vault name, use that as `EXPECTED` below.

### Part 2 — Programmatic guard (after the user confirms)

Even with the confirmation above, run a programmatic check before any destructive action:

```bash
EXPECTED="Test Vault"   # Or whatever the user said
ACTIVE=$(obsidian eval code="app.vault.getName()" | sed 's/^=> //')

if [ "$ACTIVE" != "$EXPECTED" ]; then
  cat <<EOF
Aborting plugin-test: vault guard failed.
  Expected (focused vault): "$EXPECTED"
  Got:                      "$ACTIVE"

The Obsidian CLI always targets the currently focused Obsidian window. The vault=
flag does NOT actually route to a different vault. Switch focus to "$EXPECTED"
(Cmd-Tab on macOS, or click the window) and re-invoke the skill. If "$EXPECTED"
is not open at all, open it from the Obsidian vault switcher first.

For maximum safety, close every other Obsidian vault before retrying — that way
focus drift cannot redirect the run to the wrong vault.
EOF
  exit 1
fi
```

If the guard fails, **stop the skill entirely**. Tell the user exactly what was expected vs. what was found, and ask them to fix the setup. Do not proceed under any circumstance — the cost of accidentally modifying the production vault is too high.

**Throughout the run**, re-verify focus at the start of each pass. The user could click into another window mid-run, which would silently redirect every subsequent CLI call. Re-running the same `app.vault.getName()` check at each pass boundary catches this for no real cost.

**Continue passing `vault="$EXPECTED"` on every CLI command** even though it doesn't currently route — it documents intent, and may start working in a future Obsidian release.

> **About the examples in this file**: many subsequent code blocks omit `vault="$EXPECTED"` for readability — the directive above still applies to every CLI invocation in the actual run. Treat the examples as templates: when executing them, append `vault="$EXPECTED"` to every `obsidian` command. Don't take the omission in the docs as permission to skip it in execution.

## Heavy use of the obsidian-cli skill

This skill is layered on top of the `obsidian-cli` skill. Read that skill before starting if you haven't recently — it documents the full command surface (`eval`, `command`, `dev:screenshot`, `dev:cdp`, `dev:mobile`, `files`, `plugin:reload`, `dev:console`, etc.). Don't reinvent commands here; just call them.

Common pattern for any UI surface check:

1. Ensure plugin is loaded: `obsidian eval code="app.plugins.plugins['gemini-scribe'] !== undefined"`
2. Open the surface: `obsidian command id=<command-id>` or `obsidian eval code="<workspace API call>"`
3. Settle: brief `sleep 1` so the DOM lands
4. Screenshot: `obsidian dev:screenshot path=planning/test-reports/<timestamp>/<surface>.png`
5. Inspect: `obsidian dev:dom selector=<css>` or `obsidian eval code="..."`
6. Close: typically `obsidian eval code="document.querySelector('.modal-close-button')?.click()"`
7. Judge: based on the screenshot + DOM, write a one-line verdict for the report

## Workflow

Use `TodoWrite` from the start. Each pass is a top-level todo; each surface within a pass is a sub-task. The user wants visible progress because this skill takes a while.

### Phase 0 — Discover scope

Before any test runs, build the test list:

1. **What does the docs say works?** Read every file under `docs/guide/` (these are the user-facing feature guides). For each guide, extract:
   - Commands the doc mentions (text like "Command Palette → X" → command ID needed)
   - Settings the doc mentions
   - UI surfaces the doc mentions (modals, views, panels)
   - File/folder paths the doc claims are created
   - Schedule formats / frontmatter fields the doc claims are accepted
   - Tools the doc says the agent has

2. **What's new since the last release?** Find the last tag and diff:

   ```bash
   LAST=$(git tag --sort=-v:refname | head -1)
   git log "$LAST..HEAD" --oneline
   git diff "$LAST..HEAD" --stat -- src/ docs/
   gh pr list --state merged --search "merged:>$(git log -1 --format=%aI $LAST)" --limit 50
   ```

   Cross-reference this with `src/release-notes.json` (entries above the last-released version) and `planning/changelog/` (per-day rollups) to understand the _intent_ of what shipped, not just the diff.

3. **Build a weighted test list.** Combine the two sources:
   - Every documented surface gets one line: `surface | which doc | last-touched-date`
   - Every new-since-last-release surface gets a `[NEW]` tag and a higher priority
   - Surfaces that are both documented AND new are the most important
   - Anything new that has no documentation is a **doc gap** — flag it for the report but still test it (best-effort against what the code does)

Write this list to the report file before starting Pass 1, so the user can sanity-check the scope before you start spending time.

### Phase 1 — Pass 1: smoke (no Obsidian, no API)

Cheap, deterministic, and a hard gate. If anything here fails, stop and report immediately — passes 2 and 3 are pointless against a build that doesn't compile or tests that don't pass.

```bash
npm run format-check    # Style hygiene
npm run build           # Type-check + bundle (also runs `tsc --noEmit`)
npm test                # Full vitest suite
```

Also run the stricter test typecheck that CI runs (this catches type issues the build's plain `tsc --noEmit` misses — e.g. the `vi.hoisted` class-as-type case from PR #739):

```bash
npx tsc --noEmit --skipLibCheck --project tsconfig.test.json
```

**Judge:** all four must pass. Report:

- Test count (e.g. "1534 passed, 5 skipped")
- Whether the count moved since the last test report (read prior `planning/test-reports/*/REPORT.md` and grep for the test-count line — non-mutating, no git operations needed)
- Any new test files added since last release (`git diff $LAST..HEAD --stat -- test/`)

**Don't `git stash` or `git checkout <tag>` to compute a baseline.** This skill must not mutate the working tree. If the user wants a richer baseline comparison than "previous report file", offer to run a separate baseline pass in a clean git worktree (`git worktree add ../baseline $LAST`) — but only with explicit user authorization, and as its own task, not inline.

If any check fails, write a short report under `planning/test-reports/<timestamp>/pass-1-failure.md` with the failing output and stop. Do not proceed to Pass 2.

### Phase 2 — Pass 2: UI + state (Obsidian CLI, no Gemini API)

This is the cheap visual + behavioural pass. The Obsidian CLI is essentially a remote-control + screenshot tool here. Spend nothing, but exercise everything.

**Preflight: verify required CLI subcommands exist.** The Obsidian CLI evolves — commands get renamed, removed, or gated behind plugins. Failing fast at the start with a clear "command X is missing" message is far better than a mid-pass mystery. Run this check before anything else:

```bash
required="plugin:reload dev:debug dev:console dev:errors dev:screenshot dev:dom dev:cdp dev:mobile command commands eval"
missing=""
for cmd in $required; do
  if ! obsidian "$cmd" --help >/dev/null 2>&1; then
    # --help on most CLI commands prints usage and exits 0; missing commands fail
    missing="$missing $cmd"
  fi
done
if [ -n "$missing" ]; then
  echo "Aborting Pass 2: required CLI subcommands missing:$missing" >&2
  echo "The Obsidian CLI may have changed. Update the obsidian-cli skill and this list, then retry." >&2
  exit 1
fi
```

If this check fails, **stop and report** — don't try to work around the missing command. The skill must be honest about what it can no longer do, so the maintainer can update both this skill and the `obsidian-cli` skill in tandem.

**Setup once at the start of the pass (after preflight):**

```bash
obsidian plugin:reload id=gemini-scribe
obsidian dev:debug on
obsidian dev:console clear
sleep 1
obsidian dev:errors                    # baseline: no errors after a clean reload
obsidian eval code="app.vault.getName()"   # confirm we're hitting the right vault
```

If `dev:errors` shows anything after a fresh reload, that's a regression — note it and proceed (don't auto-fail the pass).

**For each surface in the test list, run this sub-recipe:**

1. **Pre-state inspection** — eval whatever services/state the surface depends on, capture before-state.
2. **Trigger the surface** — `obsidian command id=<id>` for command-palette entries; for settings panes use `app.setting.openTabById('gemini-scribe')`; for views use `app.workspace.getLeavesOfType(...)`.
3. **Settle** (`sleep 1`) and **screenshot**: `obsidian dev:screenshot path=planning/test-reports/<timestamp>/<surface-name>.png`
4. **DOM inspection** — `obsidian dev:dom selector="..."` to verify expected elements exist
5. **Drive interactions where it matters** — for forms with conditional UI (e.g. the scheduler's "Daily at time" preset showing a time picker), click via `dev:cdp` (`Input.dispatchMouseEvent`) then re-screenshot
6. **Verify state changes** — eval whatever state the action should have changed
7. **Close the surface** — click the close button, dismiss the modal, or revert state changes
8. **Console check** — `obsidian dev:console level=error` to catch errors raised during the interaction

**Specific surfaces every run should cover** (in addition to whatever Phase 0 surfaces up):

- **Settings panes** — open the plugin's settings tab, screenshot each section. Verify defaults match `docs/reference/settings.md` and `docs/reference/advanced-settings.md`.
- **Command palette** — `obsidian commands filter=gemini-scribe` and verify every documented command exists with the documented label.
- **Agent view** — open the agent view, screenshot, verify chat input + tool list render.
- **Scheduler modal** — open Scheduler, screenshot. For each preset (`Once`, `Daily (every 24h)`, `Daily at time`, `Weekly (every 7d)`, `Weekly on days at time`, `Custom interval`) click and screenshot. Confirm the conditional inputs (time picker, day checkboxes, custom interval text) appear/disappear as expected.
- **Background tasks panel** — open it via the status bar entry or command, screenshot.
- **Folder layout** — `obsidian files folder=gemini-scribe` and verify `Agent-Sessions/`, `Background-Tasks/`, `Prompts/`, `Skills/`, `Scheduled-Tasks/`, `Scheduled-Tasks/Runs/` all exist after plugin load.
- **Mobile emulation pass** — `obsidian dev:mobile on`, reload the plugin, repeat the most user-facing surfaces (settings, agent view, scheduler), screenshot. Then `obsidian dev:mobile off`. This is the only way to exercise mobile-only code paths (e.g. PR #723's `Platform.isMobile` catch-up modal).
- **Catch-up modal scenario** — write a fake overdue entry into `<state-folder>/Scheduled-Tasks/scheduled-tasks-state.json`, reload the plugin, observe the badge / modal. Restore the original state file at the end.

**Judging Pass 2 (this is the agent-as-judge step):**

For each surface, write a one-line verdict in the report:

- ✅ **Looks right** — UI matches what the docs describe, state changes happened correctly, no console errors
- ⚠️ **Looks suspicious** — something visible is off (missing element, wrong default, console warning) but the surface basically works
- ❌ **Looks broken** — surface failed to open, threw an error, or contradicts the docs in a load-bearing way

The agent's bar for ⚠️/❌ should be calibrated: a screenshot that _looks ugly_ but matches the docs is ✅. A screenshot that _looks fine_ but contradicts a setting default is ❌.

After all surfaces are judged, write a Pass 2 summary to the report and **stop**. Tell the user:

- The path to the report
- The count of ✅ / ⚠️ / ❌
- The most concerning ⚠️/❌ items inline
- Ask explicitly: "Pass 2 surfaced N issues. Pass 3 will spend ~$X in Gemini API tokens to verify image generation, deep research, and a scheduled-task end-to-end run. Proceed?"

Do **not** auto-continue to Pass 3. The cost gate is the user's decision.

### Phase 3 — Pass 3: API spending (only with explicit user authorization)

Run only after the user replies "yes, proceed" (or equivalent) to the Pass 2 summary. If the user doesn't reply, or replies "no" / "skip pass 3", stop and write the final report at the Pass 2 boundary.

Each API-spending check should:

1. State its expected cost up-front in the report (token estimates, dollar estimates where possible — see `src/models.ts` and `docs/reference/` for pricing if available)
2. Use the **smallest** model appropriate for the check unless the test specifically targets a larger one
3. Verify against a deterministic expectation, not just "didn't throw"
4. Capture the response (or a snippet) into the report for human spot-check

**Coverage** (run only the ones relevant to surfaces that were exercised in Pass 2):

- **Foreground chat round-trip** — send a one-shot prompt via the agent view, verify a response comes back, capture token usage
- **Image generation, palette flow** — open the palette command, fill a prompt, submit. Verify (a) the "submitted" Notice fires synchronously, (b) `BackgroundTaskManager.getActiveTasks()` shows the task, (c) the task completes with a vault path, (d) the wikilink lands at the captured cursor in the right note. ~$0.04/image.
- **Image generation, agent-tool background mode** — invoke `generate_image` from the agent view with `background: true`. Verify the immediate `{taskId, output_path}` return and the eventual file at the predicted path. ~$0.04/image.
- **Deep research, background mode** — kick off a research task with a small topic. Verify the report file lands under `[state-folder]/Background-Tasks/`. Costs vary; usually a few cents.
- **Scheduled task `runNow`** — pick (or create) a `daily@<near-future>` task, then call `app.plugins.plugins['gemini-scribe'].scheduledTaskManager.runNow('<slug>')`. Verify the run output appears at the resolved `outputPath`, frontmatter is correct, and `state.lastRunAt` was updated. ~$0.01–0.05 depending on prompt.

**Cleanup after Pass 3:**

- Delete any test-only scheduled tasks created during the pass
- Delete (or move to a clearly-labelled subfolder) any generated images, research reports, run outputs that the user didn't ask for
- The user's vault should look the same after Pass 3 as it did before (modulo intentional state changes the user signed up for)

### Phase 4 — Final report

Write the complete report to `planning/test-reports/<YYYY-MM-DD-HH-MM>/REPORT.md` with this shape:

```markdown
# Plugin acceptance test — <date>

## Scope

- Vault: <name>
- Plugin version: <from manifest.json>
- Last release: <tag>, <date>
- Surfaces tested: <count>
- Surfaces marked NEW (since last release): <count>

## Pass 1 — Smoke

✅/❌ format-check, build, typecheck:test, npm test (<pass count>)
[any failures inline]

## Pass 2 — UI + state

| Surface                   | Verdict | Notes                                                     |
| ------------------------- | ------- | --------------------------------------------------------- |
| Settings (general)        | ✅      | matches docs                                              |
| Settings (advanced)       | ⚠️      | "stopOnToolError" default is true in code, docs say false |
| Scheduler — Daily at time | ✅      | time picker shows                                         |
| Scheduler — mobile        | ✅      | renders correctly under dev:mobile                        |
| Catch-up modal            | ✅      | auto-opens on mobile when pending                         |
| ...                       |         |                                                           |

Screenshots: planning/test-reports/<dir>/\*.png

## Pass 3 — API spending

[skipped / completed]
[per-check verdict + actual costs]

## Recommendation

ship / hold (<reason>)

## Doc gaps surfaced

[any new-since-last-release feature with zero documentation, flagged in Phase 0 — list here]
```

The report is the deliverable. Don't commit it; the user decides whether to keep it. (`planning/` is gitignored or reviewed-by-hand depending on repo convention; check before suggesting a commit.)

## Anti-patterns

- ❌ **Skipping the vault guard or its prep message.** Both halves are mandatory. The user must close other vaults AND confirm before any CLI call. Even one premature `obsidian` command could land in production.
- ❌ **Skipping Phase 0.** Without it the test list is "whatever I felt like checking" and regressions slip past.
- ❌ **Auto-running Pass 3.** Real money is at stake. Always wait for explicit go-ahead after the Pass 2 summary.
- ❌ **Failing the whole pass on a single ⚠️.** ⚠️ means "user should look", not "stop the world". Only ❌ is a hard stop.
- ❌ **Using `console.log` to check anything.** Use `obsidian dev:console` (with level/limit filters) or `dev:errors` — `console.log` from this skill's process doesn't see Obsidian's runtime.
- ❌ **Leaving the dev:mobile flag on after the mobile sub-pass.** It changes the app's behavior for the next user who opens Obsidian. Always toggle it off in the same task.
- ❌ **Polluting the user's vault.** Pass 3 cleanup is mandatory. If a generated file would be useful to keep, ask the user before keeping it.
- ❌ **Reporting ✅ without evidence.** Every ✅ in the table should have either a screenshot path, an eval result, or a one-line behavioral observation in the Notes column.
- ❌ **Trusting `vault=<name>` to do anything.** It doesn't route. The CLI always targets focus. Don't let "I passed `vault=Test Vault`" lull you into skipping the focus check.

## Failure modes to watch for

- **Focus drifts mid-run.** The CLI always targets the focused Obsidian window. If the user clicks into another vault between your CLI calls, every subsequent action goes there. Re-verify focus at every pass boundary; abort if it moved. The vault prep message tells the user to close other vaults specifically to make this impossible.
- **Plugin reload didn't take.** `obsidian plugin:reload id=gemini-scribe` returns success even if the plugin's enable hook threw. Always follow with `obsidian dev:errors` to confirm a clean load.
- **CLI silently using the wrong vault.** Even if the user confirmed at start, only the focused vault is targeted. Always `obsidian eval code="app.vault.getName()"` to pin which vault you're in. The `vault=<name>` flag does NOT redirect — see the vault guard section.
- **Modals stacking.** If a previous test left a modal open, the next screenshot will be wrong. Verify `document.querySelector('.modal-container')` is null between surfaces, or close all modals at the top of each surface.
- **Screenshot timing.** DOM updates are async. `sleep 1` is the floor; for animations or first-time renders, `sleep 2`. If a screenshot looks blank, retry with a longer settle.
- **Mobile emulation persists.** Confirmed above; restating because it's a common foot-gun.
- **Pass 1 baseline drift.** If `npm test` count went down since last release, that's a regression in coverage even if all remaining tests pass — flag it.

## A complete example

User: "Test the plugin before I cut the next release."

1. Phase 0: read `docs/guide/*.md`, run `git log v4.7.0..HEAD --oneline`, build a weighted test list. Write it to `planning/test-reports/2026-05-03-21-00/scope.md`.
2. Phase 1: `npm run format-check && npm run build && npx tsc -p tsconfig.test.json --noEmit && npm test` — all green, 1534 passing. Note in report.
3. Phase 2: reload plugin, walk every documented surface + every new-since-v4.7.0 surface, screenshot, judge. End with a summary: "16 ✅, 1 ⚠️ (settings default mismatch in `stopOnToolError`), 0 ❌. Pass 3 will spend ~$0.10 to verify image-gen + deep-research + a scheduled-task run. Proceed?"
4. User: "yes."
5. Phase 3: run image-gen palette flow (verify cursor insertion), agent-tool background mode (verify path matches predicted), deep research with topic "test", scheduled-task `runNow` on a transient `daily@<+5min>` task. Clean up.
6. Phase 4: write the report. Recommend "ship — one ⚠️ for documentation, no functional regressions."
