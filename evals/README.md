# Eval Harness

Measures agent-loop behavior across repeatable tasks. Produces scored results with token counts, cache hit rates, cost estimates, and tool-call traces.

## Prerequisites

- Obsidian desktop running with the `gemini-scribe` plugin enabled
- Agent view panel open (the eval runner sends messages programmatically)
- API key configured in plugin settings
- `obsidian` CLI accessible from your terminal (`obsidian version` should work)

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
   	"fixture": "my-task",
   	"expectedTools": ["find_files_by_name"],
   	"forbiddenTools": ["delete_file"],
   	"outputMatchers": [{ "type": "contains", "value": "expected text" }],
   	"maxTurns": 15,
   	"timeoutMs": 90000
   }
   ```

2. Create fixture files in `evals/fixtures/<fixture-name>/`:
   - These `.md` files are copied into `eval-scratch/` in the vault before the task runs
   - They're cleaned up after scoring (unless `--keep-artifacts`)

3. Run `npm run eval -- --task=my-task` to test it

### Task categories currently in the suite

- **Read-only retrieval** (`smoke-list-files`, `read-and-answer`, `find-tagged-notes`, `multi-file-summary`) — single-hop or set-membership reads, scored on output content.
- **Multi-hop retrieval** (`multi-hop-retrieval`) — chains reads across interlinked notes via `[[wikilinks]]`. Exercises ~3 tool calls.
- **Loop traps** (`loop-trap-cyclic-refs`) — corpus has cyclic links and the question's answer isn't present. A well-behaved agent bails cleanly; a regressed loop detector lets it spin until the turn aborts.
- **Write actions** (`create-note-from-search`) — creates a new note from search results, scored on file existence + content.

When adding a new task, prefer cloning the closest category's fixture pattern — the Wikipedia-paragraphs-as-interlinked-notes recipe in `multi-hop-retrieval/` is the template for any new multi-hop work.

## Task format reference

| Field            | Type     | Required | Description                                    |
| ---------------- | -------- | -------- | ---------------------------------------------- |
| `id`             | string   | yes      | Unique task identifier                         |
| `description`    | string   | yes      | Human-readable description                     |
| `userMessage`    | string   | yes      | Message sent to the agent                      |
| `fixture`        | string   | no       | Name of fixture directory in `evals/fixtures/` |
| `expectedTools`  | string[] | no       | Tools that must be called (set membership)     |
| `forbiddenTools` | string[] | no       | Tools that must NOT be called                  |
| `outputMatchers` | object[] | no       | Checks on the final model response             |
| `maxTurns`       | number   | no       | Max API calls before timeout (default: 15)     |
| `timeoutMs`      | number   | no       | Wall-clock timeout in ms (default: 120000)     |

### Output matcher types

- `{ "type": "contains", "value": "text" }` — final response includes the substring
- `{ "type": "regex", "value": "pattern", "flags": "i" }` — final response matches the regex. JS regex syntax does NOT support inline flags like `(?i)` — pass `flags` explicitly as a separate field (`"i"` for case-insensitive, `"s"` for dotall, etc.). The field is optional; defaults to no flags.

## Scoring

A task is **passed** if it completes without errors and within the timeout.

A task is **solved** if it passes AND:

- All `expectedTools` were called
- No `forbiddenTools` were called
- All `outputMatchers` match the final model response

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

The result file also records `provider` (e.g. `gemini`, `ollama`) at the top level so `compare` can flag cross-provider runs and skip metrics that aren't comparable.

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
