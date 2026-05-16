---
name: eval-harness
description: Run the eval harness against a real Obsidian instance, monitor for the harness's known reliability gotchas (concurrent runs, CLI-bridge hangs, stale child processes), and bless a result as a baseline only when the run is clean. Use when the user asks to "run the evals", "bless a baseline", "measure the impact of <change> on solve rate", "run a model sweep", or similar. Has Obsidian-CLI side effects (drives the agent view, creates eval-scratch fixtures, may set chatModelName for the duration of the run); does NOT modify plugin source code or commit unless explicitly asked.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: Requires Obsidian desktop with the CLI enabled, the plugin installed in a vault, and a Gemini API key configured in the plugin or `EVAL_JUDGE_API_KEY` for judge-matcher tasks. The Obsidian CLI must be reachable on PATH.
---

# Eval harness — run, monitor, bless

This skill drives `npm run eval` against a live Obsidian instance, watches for the failure modes we've actually hit in practice, and treats baseline blessing as a quality gate rather than a rubber stamp.

The harness itself is documented operationally in `evals/README.md`. This skill is the **agent-side procedure** for using it without producing corrupted baselines or leaving orphaned state behind.

## When to use this skill

- The user wants to run the eval harness — full sweep, single task, or model sweep
- The user wants to bless a result as the baseline for a (provider, model) pair
- The user wants to measure the impact of a change on the eval suite (run, compare against baseline, decide)
- A new pinned model has shipped and we want a baseline for it

Don't use this skill for:

- Editing tasks or fixtures — that's regular development work, just edit `evals/tasks/` and `evals/fixtures/` directly
- Investigating a single failed task in isolation — `npm run eval -- --task=<id>` once is enough; no skill orchestration needed

## Vault guard (mandatory preflight)

The harness drives the agent view, creates `eval-scratch/` fixtures in the vault, and may temporarily change `settings.chatModelName`. Running it against the wrong vault would dirty the user's actual notes.

**The Obsidian CLI's `vault=<name>` flag does not actually route by name** — it always targets the focused window. So before running any `obsidian` or `npm run eval` command, ask the user to prepare Obsidian and **wait for confirmation**:

> Before I start the eval run, please prepare Obsidian:
>
> 1. **Close every vault except the test vault.** Focus can drift mid-run; the only safe posture is to have just the test vault open.
> 2. **Open the test vault** (default: `Test Vault`) and make it the focused window.
> 3. **Open the agent view pane** (Gemini Scribe ribbon icon, or palette → "Open Agent View"). The harness drives this view; if it's not visible you won't see activity, but the run still drives the model.
> 4. **Save and close any unsaved work** — fixtures get planted into `eval-scratch/` and torn down per task.
>
> Reply "ready" once Obsidian has only the test vault open and focused.

Then verify with the standard preflight:

```bash
EXPECTED="Test Vault"
ACTIVE=$(obsidian eval code="app.vault.getName()" | sed 's/^=> //')
if [ "$ACTIVE" != "$EXPECTED" ]; then
  echo "Aborting: focused vault is \"$ACTIVE\", expected \"$EXPECTED\"."
  exit 1
fi
```

If the user wants a different test vault, take the name from them and use it as `EXPECTED`.

## Pre-run cleanup

State from a previous interrupted run can corrupt a new one (see "Operational gotchas" in `evals/README.md`, and #777). Always preflight:

```bash
# 1. No leftover harness processes
ps aux | grep "node evals/run.mjs" | grep -v grep

# 2. No leftover obsidian eval children
ps aux | grep "obsidian eval" | grep -v grep

# 3. No leaked collector / subscribers / scratch
obsidian eval code="JSON.stringify({hasCollector:typeof window.__evalCollector !== 'undefined', subs:(window.__evalUnsubscribers||[]).length, scratch:!!app.vault.getAbstractFileByPath('eval-scratch')})"

# 4. chatModelName matches the user's expected setting (not a previous run's override)
obsidian eval code="app.plugins.plugins['gemini-scribe'].settings.chatModelName"
```

If any of these show stale state, clean it up before starting:

```bash
# Kill leftover processes
kill -KILL <pid>

# Reap leaked collector + subscribers
obsidian eval code="(() => { for (const u of (window.__evalUnsubscribers || [])) try { u(); } catch {}; window.__evalUnsubscribers = []; delete window.__evalCollector; })()"

# Restore chatModelName if it's wrong (note the actual user's setting first if you don't already know it)
obsidian eval code="(() => { app.plugins.plugins['gemini-scribe'].settings.chatModelName = '<correct-id>'; })()"
```

## Single-tenant rule

**Never run two `npm run eval` instances against the same Obsidian process.** They will fight for the agent view, leave fixtures in inconsistent state, and produce stuck CLI children that block both. Symptoms: log shows `Setting up N fixture files...` but no `Session:` line; agent view shows a session from a different task than the one printed.

If the user asks for a model sweep, run them **sequentially**. Wait for one process to fully exit before kicking off the next.

## Running

For a single-model run against the user's currently-configured chat model:

```bash
npm run eval 2>&1 | tee /tmp/eval-run.log
```

For Ollama-only sweeps that include `judge` output matchers, provide a Gemini key for the judge without changing the
plugin provider:

```bash
EVAL_JUDGE_API_KEY=... npm run eval -- --task=multi-file-summary 2>&1 | tee /tmp/eval-ollama.log
```

If neither `EVAL_JUDGE_API_KEY` nor a plugin Gemini API key is available, judge-matcher tasks record
`judge_skipped: true` and print `[judge unavailable]`; treat those as harness setup failures, not model-quality
regressions.

For a model sweep, the canonical pattern is one `npm run eval -- --model=<id>` per model, awaiting full completion of the previous before starting the next:

```bash
for MODEL in gemini-3-flash-preview gemini-2.5-flash gemini-2.5-pro; do
  npm run eval -- --model=$MODEL 2>&1 | tee /tmp/eval-$MODEL.log
  # Wait for full process exit before next iteration
done
```

A 21-run sweep typically takes 30–90 min depending on the model. Pro is roughly 2× slower than flash and ~9× more expensive per task.

### Skip these models

- **`*-latest` pointers** (`gemini-flash-latest`, `gemini-pro-latest`, etc.) — Google may swap the underlying model on any given day. Baselines against `-latest` aren't stable regression detectors. Use pinned IDs.
- **`gemini-2.5-flash-lite`** — reproducibly hangs the harness mid-sweep (#778). Skip until that's fixed.

## Monitoring during the run

Use a `Monitor` (or equivalent shell loop) that watches for the things that need intervention, not for routine progress. The harness's own per-turn polling already prints heartbeat lines.

### What to watch for

The reliability flag worth catching is the **CLI-bridge hang**: `Turn completed.` line printed in the log, but no `SOLVED` / `PASSED` / `FAILED` / `TIMEOUT` verdict line for ≥ 30s. The harness's `execFile` `timeoutMs: 10000` should fire but doesn't always.

Triage when you see this:

```bash
# Check if a manual obsidian eval still works (CLI itself responsive?)
obsidian eval code="1+1"
# Find stale CLI children (alive but 0 CPU for minutes)
ps aux | grep "obsidian eval" | grep -v grep
```

If a fresh CLI call returns instantly but the harness is still stuck, the parent's specific child is wedged. Workaround:

```bash
kill -KILL <stuck-child-pid>
```

The parent's `exec` promise will reject with `"Command failed"`, `runTask` will record an **ERROR** verdict and continue. Note: this corrupts the run for blessing — see "Bless gate" below.

### Quiet monitor pattern

Watching every per-task verdict on a 21-run sweep produces 21 notifications. Prefer a monitor that fires only on the final summary or process exit. Match `evals/run.mjs` directly (without `--model=`) so the same pattern works for both `npm run eval` and `npm run eval -- --model=<id>`:

```bash
until ! pgrep -f "node evals/run.mjs" >/dev/null; do sleep 60; done; echo "exited"
```

If you need to disambiguate when multiple sweeps are running back-to-back (or when restarting after a hang), capture the PID at launch and wait on it directly:

```bash
npm run eval -- --model=gemini-2.5-pro 2>&1 | tee /tmp/eval-pro.log &
EVAL_PID=$!
until ! kill -0 $EVAL_PID 2>/dev/null; do sleep 60; done; echo "exited"
```

Either pattern gives one notification per run. Spot-check progress between notifications by tailing the log.

## Bless gate (quality bar for baselines)

A baseline must reflect actual model behavior, not harness friction. **Do not bless a result if any of these happened during the run**:

- A manual `kill -KILL` of a stuck CLI child (produces a fake **ERROR** verdict that suppresses `pass^k`)
- Concurrent runs against the same Obsidian instance
- A second Ctrl-C while the first interrupt was still cleaning up (state may be partial)
- Any unexplained `ERROR` line in the verdict list

If the gate fails, **rerun the entire sweep** before blessing. Don't bless a partial run "with a caveat" — caveats accumulate and degrade the baseline as a regression detector.

If the gate passes, bless and commit:

```bash
npm run eval:bless                # or: npm run eval:bless <result.json>

# The bless writes evals/baselines/<provider>-<sanitized-model>.json (gitignored
# results/ stays out of source control). Commit only the baseline file.
git add evals/baselines/<file>.json
git commit -m "chore(evals): bless baseline for <model>"
```

The commit message should include the headline numbers: `pass^3`, `solve^3`, mean cache rate, total cost, flaky-task list, plus a one-line note on anything unusual.

## Cross-model observations worth surfacing

When running a model sweep, after all baselines are blessed, write up the cross-model picture in the PR body. Useful axes:

- **`solve^3` ceiling** — does spending more on a more capable model actually move the solve rate, or is the ceiling matcher brittleness rather than model capability? (We've seen pro and flash-preview tie at 71.4% — same ceiling, 9× cost difference.)
- **Cache hit rate variation** — same plugin, same prompts, different rates. Cross-model variance is interesting (we've seen 35% → 66% across models).
- **Flaky-task overlap** — if the same task is flaky on multiple models, it's a rubric problem (move to `judge` matcher per #713). If different tasks are flaky on different models, it's likely real model variance.

## Cleanup after run

```bash
# Confirm no stragglers
ps aux | grep -E "node evals|obsidian eval" | grep -v grep
# Confirm no leaked plugin state
obsidian eval code="JSON.stringify({hasCollector:typeof window.__evalCollector !== 'undefined', subs:(window.__evalUnsubscribers||[]).length, scratch:!!app.vault.getAbstractFileByPath('eval-scratch')})"
# Confirm chatModelName restored
obsidian eval code="app.plugins.plugins['gemini-scribe'].settings.chatModelName"
```

If any of these show stale state, run the manual cleanup commands from the pre-run section.

## Anti-patterns

- ❌ Blessing a baseline that contains a manual-kill ERROR
- ❌ Running two evals concurrently against the same Obsidian process
- ❌ Blessing a baseline against a `*-latest` model pointer
- ❌ Running model sweeps in parallel "to save time"
- ❌ Per-task notifications on a 21-run sweep (use a quiet monitor that only fires on exit)
- ❌ Skipping the bless-gate caveat because "it's just one ERROR" — the baseline is the bar; one bad run sets a wrong bar

## Related skills

- `obsidian-cli` — for ad-hoc Obsidian inspection / debugging
- `plugin-test` — three-pass acceptance test (different scope, different cost profile)

## Tracking issues

- #687 — eval harness hill-climb (umbrella)
- #776 — `obsidian eval` children hang after work completes
- #777 — SIGINT handler leaks the event-bus collector + subscribers
- #778 — `gemini-2.5-flash-lite` reproducibly hangs the harness
