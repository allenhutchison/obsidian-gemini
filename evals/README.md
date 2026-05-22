# Eval Harness

Measures agent-loop behavior across repeatable tasks. Produces scored results with token counts, cache hit rates, cost estimates, and tool-call traces.

## Prerequisites

- Obsidian desktop running with the `gemini-scribe` plugin enabled
- Agent view panel **visible** (the eval runner drives `sendMessageProgrammatically` on the agent view; if the pane is collapsed or behind another tab you won't see activity, but the run still drives the model — open the pane if you want a UI signal)
- API key configured in plugin settings
- For Ollama-only eval runs that include `judge` output matchers, set `EVAL_JUDGE_API_KEY` to a Gemini API
  key. The judge always uses Gemini, even when the system under test is Ollama, and the plugin may not have a
  Gemini key configured in Ollama-only setups.
- `obsidian` CLI accessible from your terminal (`obsidian version` should work)
- **Single-tenant Obsidian instance** — only one `npm run eval` may run at a time against a given Obsidian process. Concurrent runs fight for the same agent view session and produce stuck CLI children; see "Operational gotchas" below.

## Running

```bash
# Run all tasks (each task runs 3 times by default — see Reliability below)
npm run eval

# Run a single task (prefix match on task ID)
npm run eval -- --task=smoke

# Override how many times each task runs
npm run eval -- --repeat=5

# Sweep models against a fixed task suite (see Model overrides below)
npm run eval -- --model=gemini-2.5-flash-lite

# Keep scratch files and session history for debugging
npm run eval -- --keep-artifacts

# Run Ollama-backed tasks that need judge matchers
EVAL_JUDGE_API_KEY=... npm run eval -- --task=multi-file-summary
```

Results are written to `evals/results/<timestamp>.json` and a summary prints to stdout.

## Reliability: pass^k

Each task runs **N** times (default `N=3`, override with `--repeat=N`). Two sets of metrics come out of that:

- **`pass^k` / `solve^k`** — a task "passes at k" only when **all N runs** pass. This is the τ-bench reliability signal ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045)); it's the number to watch when judging whether a code change helped or hurt, because it's noise-free in the sense that LLM nondeterminism on a single run can't inflate it.
- **`mean_pass_rate` / `mean_solve_rate`** — proportion of all task × run cells that passed/solved. Useful signal but noisier.

Tasks that land between 0 and N solves are flagged as **flaky** (e.g. `2/3 ⚠` in the summary). One flaky task isn't necessarily a regression, but the trend matters — if a change takes a previously-stable task into flaky territory, that's visible in the compare output.

Rule of thumb: `N=3` for day-to-day development, `N=5` or more if you're publishing numbers or making a merge-blocking decision.

## Model overrides

By default the harness uses whatever `chatModelName` is currently set in the plugin's settings. Pass `--model=<id>` to override that for the duration of the run:

```bash
npm run eval -- --model=gemini-2.5-flash-lite
npm run eval -- --model=gemini-2.5-pro --repeat=5
```

The override is **transient**: it's applied to `plugin.settings.chatModelName` in memory at the start of the run and restored on exit (including on Ctrl-C / SIGTERM). The setting is **not** persisted to disk, so the user's configured model is unaffected.

The override stamps into the result file's `model` field, so a multi-model sweep produces one result file per invocation that compare and trend independently:

```bash
for m in gemini-2.5-flash gemini-2.5-flash-lite gemini-2.5-pro; do
  npm run eval -- --model=$m --repeat=5
done
```

Caveat: while the harness is running, the live agent view is using the override too. That's the same disruption already implied by the harness driving the agent — just don't try to use the agent view in another window mid-run.

## Comparing against a baseline

`npm run eval` automatically compares each run against the blessed baseline for the active `(provider, model)` and prints a regressions-only summary at the end:

```text
=== Regression check vs baseline (abc123 / 2026-04-26) ===
  pass^3     100% → 100% (=)
  solve^3    66.7% → 33.3% (-33.3pp) ⚠

  Tasks with degraded solve/pass rate:
    find-tagged-notes: solved 3/3 → 0/3
```

Baselines live in `evals/baselines/<provider>-<sanitized-model>.json` (one per provider/model pair). The matching baseline is resolved automatically from the result's `provider` and `model` fields. If no baseline exists yet, the runner prints the path it expected and points at `eval:bless`.

### Promoting a result to baseline

```bash
# Bless the most recent result file as the baseline for its (provider, model)
npm run eval:bless

# Bless a specific result file
npm run eval:bless evals/results/2026-05-06T12-00-00-000Z.json
```

`eval:bless` is an explicit operator action — baselines never auto-drift. The new baseline overwrites the previous one for that (provider, model) pair; recover prior baselines via git history.

### Manual comparison

The auto-compare uses a brief regressions-only view. For the verbose per-task diff (every aggregate, every changed metric), use `eval:compare` directly:

```bash
# Compare latest run against an explicit baseline file
npm run eval:compare evals/baselines/gemini-gemini-2.5-flash-lite.json

# Compare two specific runs
npm run eval:compare evals/results/run-a.json evals/results/run-b.json
```

### What counts as a regression

The summary flags two things:

- **Aggregate `pass^k` or `solve^k` rate dropping** vs baseline. Mean rates and turn/cost movements are reported but not flagged — they shift with prompt tweaks and LLM nondeterminism without indicating a real quality drop.
- **Per-task `solved` or `passed` fraction dropping** (e.g. 3/3 → 2/3 or 3/3 → 0/3). Catches both flakiness onset and hard regressions even when N changes between runs.

Adding a task or removing a task is reported but not treated as a regression — the operator did that intentionally.

## Adding a new task

1. Create `evals/tasks/<task-id>.json`:

   ```json
   {
   	"id": "my-task",
   	"description": "What this task tests",
   	"userMessage": "The message sent to the agent",
   	"difficulty": "T2",
   	"category": "retrieval",
   	"fixture": "my-task",
   	"expectedTools": ["find_files_by_name"],
   	"forbiddenTools": ["delete_file"],
   	"outputMatchers": [{ "type": "contains", "value": "expected text" }],
   	"vaultAssertions": [{ "type": "fileExists", "path": "eval-scratch/out.md" }],
   	"toolCallBudget": 4,
   	"maxTurns": 15,
   	"timeoutMs": 90000
   }
   ```

2. Create fixture files in `evals/fixtures/<fixture-name>/`:
   - These `.md` files are copied into `eval-scratch/` in the vault before the task runs
   - They're cleaned up after scoring (unless `--keep-artifacts`)

3. Run `npm run eval -- --task=my-task` to test it

### Difficulty tiers

Every task carries a `difficulty` tag. The suite is intentionally a _gradient_ — a
mix of tiers so the harness can rank model classes (Gemini Flash-Lite / Flash / Pro,
and open Ollama models) instead of saturating at 100% solve. The reporter prints
`solve^k` broken down by tier.

| Tier | Intent                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| `T1` | Easy — single tool call, tiny corpus. Regression canary; every model should pass.                               |
| `T2` | Moderate — 2–3 tool calls, light distractors.                                                                   |
| `T3` | Hard — multi-step, distractor-heavy, constraint-bearing. Flash solves; Lite struggles.                          |
| `T4` | Frontier — deep hop chains, cross-note aggregation + arithmetic, conflict resolution. Separates Pro from Flash. |

A tier where _every_ model solves, or _no_ model solves, is miscalibrated — revise the task.

### Task categories

Tasks carry a free-form `category` tag (e.g. `retrieval`, `multi-hop`, `aggregation`,
`conflict`, `synthesis`, `write`, `edit`, `negative-space`, `safety`, `memory`).
Notable patterns:

- **Read-only retrieval / multi-hop** — chains reads across interlinked notes via `[[wikilinks]]`. The Wikipedia-paragraphs-as-interlinked-notes recipe in `multi-hop-retrieval/` is the template for any new multi-hop work.
- **Aggregation** — collate + count / sum / sort facts across many notes; scored on exact figures.
- **Conflict** — sources disagree; a policy note supplies the tiebreaker rule the agent must apply.
- **Write / edit / delete** — scored with `vaultAssertions` (see below) so the _resulting file state_ is verified, not just the response text.
- **Loop traps / negative-space** — the answer isn't present; a well-behaved agent bails cleanly instead of spinning or hallucinating.
- **Safety** — e.g. a fixture note embeds text posing as instructions; the agent must not obey it.

When adding a new task, prefer cloning the closest category's fixture pattern.

## Task format reference

| Field             | Type     | Required | Description                                                            |
| ----------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `id`              | string   | yes      | Unique task identifier (must equal the filename without `.json`)       |
| `description`     | string   | yes      | Human-readable description                                             |
| `userMessage`     | string   | yes      | Message sent to the agent                                              |
| `difficulty`      | string   | no       | Difficulty tier: `T1`–`T4` (see above). Drives the reporter breakdown. |
| `category`        | string   | no       | Free-form category tag for grouping                                    |
| `fixture`         | string   | no       | Name of fixture directory in `evals/fixtures/`                         |
| `contextFiles`    | string[] | no       | Vault paths added to the session's context shelf before the turn       |
| `setup`           | object[] | no       | Files seeded outside `eval-scratch/` — `{ path, from }` (see below)    |
| `expectedTools`   | string[] | no       | Tools that must be called (set membership)                             |
| `forbiddenTools`  | string[] | no       | Tools that must NOT be called                                          |
| `outputMatchers`  | object[] | no       | Checks on the final model response                                     |
| `vaultAssertions` | object[] | no       | Post-run checks on vault state (see below)                             |
| `toolCallBudget`  | number   | no       | Max tool calls allowed while still counting as `solved`                |
| `maxTurns`        | number   | no       | Max API calls before timeout (default: 15)                             |
| `timeoutMs`       | number   | no       | Wall-clock timeout in ms (default: 300000)                             |

### Output matcher types

- `{ "type": "contains", "value": "text" }` — final response includes the substring.
- `{ "type": "contains", "value": ["form-A", "form-B", "form-C"] }` — any-of substring match. The matcher passes if the response contains **any** of the listed forms. Use this when an answer has multiple correct surface forms — e.g., `"Neural Networks"` vs `"[[neural-networks]]"`.
- `{ "type": "regex", "value": "pattern", "flags": "i" }` — final response matches the regex. JS regex syntax does NOT support inline flags like `(?i)` — pass `flags` explicitly as a separate field (`"i"` for case-insensitive, `"s"` for dotall, etc.). `value` may also be an array of patterns (any-of). The field is optional; defaults to no flags.
- `{ "type": "judge", "criteria": "..." }` — LLM-as-judge for prose-heavy rubrics where literal substrings would be too brittle. The judge is a separate, **pinned** Gemini model (default `gemini-2.5-flash`; override with `EVAL_JUDGE_MODEL` env var) called with `temperature: 0` and a strict YES/NO contract. The judge always uses Gemini even when the system under test is Ollama, so the verdict doesn't drift across model-swap experiments. Use sparingly — each judge matcher is one extra API call per task run.
  `judge` matchers use `EVAL_JUDGE_API_KEY` when set; otherwise they fall back to the plugin's Gemini API key. If neither key is reachable, the matcher fails and the result records `judge_skipped: true`. The console verdict includes `[judge unavailable]` to distinguish setup failures from model regressions.

When mixing matcher types, every matcher must pass (logical AND); within a single matcher, an array `value` is logical OR.

### Vault assertions

`outputMatchers` score the model's final _text_. `vaultAssertions` score the _side
effects_ — what the agent actually did to the vault. This is the state-based
verification that separates a real write/edit/delete eval from one that only checks
"did it say the right words and call `write_file`" (the τ-bench lesson: compare end
state against the goal, not tool-call syntax). Any write/edit/delete task should use
`vaultAssertions`. After the turn ends the harness snapshots every referenced path
and evaluates:

- `{ "type": "fileExists", "path": "eval-scratch/x.md" }` — file is present.
- `{ "type": "fileAbsent", "path": "eval-scratch/x.md" }` — file is gone (delete tests).
- `{ "type": "fileContains", "path": "...", "value": "text" }` — body contains the substring. `value` may be an array (any-of).
- `{ "type": "fileLacks", "path": "...", "value": "text" }` — body does NOT contain any of the substring(s). Catches collateral damage.
- `{ "type": "fileMatches", "path": "...", "value": "regex", "flags": "i" }` — body matches the regex (`value` may be an array, any-of).
- `{ "type": "frontmatterEquals", "path": "...", "key": "status", "value": "archived" }` — a frontmatter property deep-equals `value` (scalars, numbers, arrays, objects).
- `{ "type": "fileUnchanged", "path": "eval-scratch/x.md", "fixture": "x.md" }` — the file's content still byte-equals the original fixture file named `x.md`. Use it to assert an edit didn't touch sibling files.

Every assertion must hold (logical AND); within `fileContains` / `fileMatches` an
array `value` is any-of. A task with no `vaultAssertions` trivially passes this gate.

### Setup files (state outside `eval-scratch/`)

`fixture` files always land in `eval-scratch/`. Some tasks need to pre-seed plugin
state that lives elsewhere — `AGENTS.md` for memory tests, an `Agent-Sessions/`
history file for recall tests, a `Skills/<name>/SKILL.md` package. The `setup` field
handles that:

```json
"setup": [{ "path": "gemini-scribe/Skills/my-skill/SKILL.md", "from": "my-task-setup/SKILL.md" }]
```

Each entry is `{ path, from }` — `from` is a file path relative to `evals/fixtures/`,
and the harness writes its content to the vault path `path` before the run (creating
parent folders as needed) and deletes it during cleanup.

### Tool-call budget

`toolCallBudget` makes efficiency a `solved` criterion: when set, the run only solves
if `tool_calls <= toolCallBudget`. Use it to catch "read every file in the vault"
behavior on a task a single content search would have answered.

## Per-task timeout and progress

Each task runs against a wall-clock budget — `timeoutMs` from the task JSON, defaulting to **5 minutes**. When the budget is exceeded the harness:

1. Cancels the in-flight agent loop in the plugin (`AgentView.cancelCurrentRun`).
2. Waits a few seconds for the in-flight CLI call to settle.
3. Records the run as a `TIMEOUT` (counts as a non-pass for `pass^k`).
4. Continues to the next task.

While a task is running, a polling loop prints a progress line every ~2 seconds when the turn or tool-call count changes:

```text
  [turn 1 | 2 tool calls | 14s elapsed | ETA 28s]
  [turn 2 | 4 tool calls | 19s elapsed | ETA 19s]
```

ETA is shown only when the task declares `maxTurns` and at least one turn has completed; otherwise the line omits it.

## Interrupting a run

`Ctrl-C` (SIGINT) and SIGTERM trigger a clean shutdown:

- Prints `=== Interrupted (SIGINT): N of M tasks completed ===`.
- Cancels the in-flight agent loop in the plugin.
- Cleans the in-progress task's scratch fixtures and session history (so `eval-scratch/` doesn't leak into the user's vault).
- Restores any `--model=` override that was applied for the run.
- Exits with `130` (SIGINT) or `143` (SIGTERM) so CI / wrappers can distinguish "interrupted" from "all green."

A second Ctrl-C while cleanup is in flight is ignored; let the first one finish.

> **Known issue (#777)**: when SIGINT triggers `process.exit`, `runTask`'s `finally` block doesn't run, so `removeCollector()` never fires. Result: `window.__evalCollector` and ~6 subscribers leak on the agent event bus until you reload the plugin or close Obsidian. Manual cleanup:
>
> ```bash
> obsidian eval code="(() => { for (const u of (window.__evalUnsubscribers || [])) try { u(); } catch {}; window.__evalUnsubscribers = []; delete window.__evalCollector; })()"
> ```

## Operational gotchas

Lessons learned from real eval sessions; treat as a reliability checklist before kicking off a long sweep.

### Don't run two evals concurrently against the same Obsidian instance

Each `npm run eval` drives `app.plugins.plugins['gemini-scribe'].agentView` directly. Two runs at once will fight for the same agent view session — fixtures from one task get torn down while another is mid-flight, sessions get reassigned, and the CLI bridge ends up with multiple children stuck in queue. Symptoms: log shows "Setting up N fixture files..." but no `Session:` line follows; live agent view shows a session from a different task than the one printed in the log.

If you need to compare models, run them sequentially. A typical 21-run sweep takes 30–120 min depending on the model; budget accordingly.

### CLI-bridge hangs (#776)

`obsidian eval` child processes have occasionally failed to exit after their work completed — they sat in `S` state with 0 CPU. The harness now avoids long-lived turn-driving CLI calls and uses a hard SIGTERM-to-SIGKILL timeout for every Obsidian CLI call, so these failures should settle as harness errors instead of wedging a sweep indefinitely.

Symptoms in the log:

- `Turn completed.` printed, but no `SOLVED` / `PASSED` / `FAILED` / `TIMEOUT` verdict line for ≥ 10s
- The harness's node process at near-zero CPU
- A standalone `obsidian eval code="1+1"` from another shell **does** respond instantly (so the CLI itself is fine; the harness's specific child is wedged)

If a future run still appears stuck, check for stale children:

```bash
# Find stuck children (zero CPU, alive for minutes)
ps aux | grep "obsidian eval" | grep -v grep

# Kill the oldest one
kill -KILL <pid>
```

The harness records CLI failures as **ERROR** and moves to the next run. **Do not bless** a baseline that includes a manual-kill ERROR — the verdict was caused by the harness, not the model. Rerun the whole sweep instead.

### Don't bless a corrupted run

A baseline must reflect actual model behavior, not harness friction. Skip the bless step if any of these happened during the run:

- A manual `kill -KILL` of a stuck CLI child (causes a fake ERROR verdict)
- A second Ctrl-C while the first interrupt was still cleaning up (state may be partial)
- Concurrent runs against the same Obsidian instance

Rerun, _then_ bless.

### Pre-flight cleanup

Before kicking off a fresh run after a previous one was interrupted or hit a hang:

```bash
# 1. No leftover harness processes
ps aux | grep "node evals/run.mjs" | grep -v grep
# 2. No leftover CLI children
ps aux | grep "obsidian eval" | grep -v grep
# 3. No leaked collector / subscribers
obsidian eval code="JSON.stringify({hasCollector:typeof window.__evalCollector !== 'undefined', subs:(window.__evalUnsubscribers||[]).length, scratch:!!app.vault.getAbstractFileByPath('eval-scratch')})"
# 4. chatModelName matches what you expect (model override was restored)
obsidian eval code="app.plugins.plugins['gemini-scribe'].settings.chatModelName"
```

If any of these show stale state, kill / clean before starting the new run. The harness's interrupt handler tries to restore everything but doesn't always succeed (see #777 for one known leak).

### Model-specific caveats

- **`*-latest` model pointers** (`gemini-flash-latest`, etc.) shift under us — Google may swap the underlying model on any given day. Don't bless a baseline against `-latest`; the comparison won't be stable. Use pinned IDs (`gemini-2.5-flash`, `gemini-2.5-pro`, etc.).

## Scoring

A task is **passed** if it completes without errors and within the timeout.

A task is **solved** if it passes AND:

- All `expectedTools` were called
- No `forbiddenTools` were called
- All `outputMatchers` match the final model response
- All `vaultAssertions` hold against post-run vault state
- `tool_calls` is within `toolCallBudget` (when the task sets one)

## Metrics captured per task

| Metric          | Source                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `turns`         | Count of `apiResponseReceived` events                                                                  |
| `tool_calls`    | Count of `toolExecutionComplete` events                                                                |
| `prompt_tokens` | High-water `promptTokenCount`                                                                          |
| `cached_tokens` | `cachedContentTokenCount` at high-water (`null` for providers without cache)                           |
| `cache_ratio`   | `cached / prompt` (`null` for providers without cache, e.g. Ollama)                                    |
| `output_tokens` | Sum of `candidatesTokenCount`                                                                          |
| `cost_usd`      | `(uncached × input_price) + (cached × cache_price) + (output × output_price)`; `0` for local providers |
| `loop_fires`    | Tool executions returning "loop detected" error                                                        |
| `duration_ms`   | Wall clock from turn start to end                                                                      |
| `tool_list`     | Ordered list of tools called                                                                           |

## Aggregate metrics

| Metric                             | Description                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `pass_k_rate`                      | % of tasks where **every** run passed (τ-bench `pass^k`)                                |
| `solve_k_rate`                     | % of tasks where **every** run solved — primary signal for code changes                 |
| `mean_pass_rate`                   | Proportion of task × run cells that passed                                              |
| `mean_solve_rate`                  | Proportion of task × run cells that solved                                              |
| `flaky_task_count`                 | Tasks where some (but not all) runs solved                                              |
| `n_runs`                           | Number of repeats per task                                                              |
| `total_runs`                       | Total task × run cells (`tasks × n_runs`)                                               |
| `mean_turns` / `p95_turns`         | Turn distribution across all runs                                                       |
| `mean_cache_ratio`                 | Average implicit-cache effectiveness (`null` if the provider has no cache, e.g. Ollama) |
| `mean_cost_usd` / `total_cost_usd` | Per-run mean and total spend (total grows with `--repeat`); `0` for local providers     |
| `total_loop_fires`                 | Total loop-detection events across all runs                                             |
| `by_difficulty`                    | Per-tier breakdown (`T1`–`T4`): task count, `solve^k` count/rate, mean solve rate       |

The `by_difficulty` breakdown is also printed to stdout under "Solve^k by difficulty"
— the view that shows whether the suite is still separating model classes.

The result file also records `provider` (e.g. `gemini`, `ollama`) at the top level so `compare` can flag cross-provider runs and skip metrics that aren't comparable.

## Persisted evidence

Beyond pass/solve verdicts, each run records the evidence behind the score so a
result can be human-reviewed or re-judged later without re-running the task:

| Field                           | Where                   | Contents                                                                                                                                                                |
| ------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `response_text`                 | per-run result          | The agent's final response, frozen at run time (non-reproducible).                                                                                                      |
| `solve_details.matcher_details` | per-run `solve_details` | One entry per `outputMatcher`: its `type`, what it checked (`value`/`flags`/`criteria`), the `verdict`, and any `error`. Empty when the run failed before matchers ran. |
| `transcript_path`               | per-run result          | Path (relative to `evals/`) to that run's transcript sidecar file, or `null`.                                                                                           |

Transcripts are written to `evals/results/<run-id>/<task-id>-<n>.json` — the
same `<run-id>` as the result file, so they correlate on disk. Each is the
captured agent event stream (turn boundaries, tool calls with arguments,
API responses). Tool-result bodies are stringified and truncated to 2 KB, and
binary `inlineData` is dropped — both to keep the `obsidian eval` CLI bridge
within its output ceiling. The `results/` directory is gitignored, so
transcripts and raw results stay out of source control; only blessed baselines
are committed.

## Architecture

The harness drives Obsidian via the `obsidian eval` CLI command, installing a temporary event-bus subscriber to capture agent lifecycle events. It does NOT modify plugin internals — all observation is via the existing `agentEventBus` subscriptions.

```text
evals/
  run.mjs              # Main runner
  lib/
    obsidian-driver.mjs  # CLI wrapper
    collector.mjs        # Event-bus capture
    scorer.mjs           # Rubric matching
    pricing.mjs          # Model cost table
    reporter.mjs         # Output formatting
    compare.mjs          # Baseline diffing
  tasks/                 # Task definitions (JSON)
  fixtures/              # Fixture files (markdown)
  results/               # Run output (gitignored)
  baseline.json          # Committed baseline
```
