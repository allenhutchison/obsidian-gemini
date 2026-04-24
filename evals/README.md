# Eval Harness

Measures agent-loop behavior across repeatable tasks. Produces scored results with token counts, cache hit rates, cost estimates, and tool-call traces.

## Prerequisites

- Obsidian desktop running with the `gemini-scribe` plugin enabled
- Agent view panel open (the eval runner sends messages programmatically)
- API key configured in plugin settings
- `obsidian` CLI accessible from your terminal (`obsidian version` should work)

## Running

```bash
# Run all tasks
npm run eval

# Run a single task (prefix match on task ID)
npm run eval -- --task=smoke

# Keep scratch files and session history for debugging
npm run eval -- --keep-artifacts
```

Results are written to `evals/results/<timestamp>.json` and a summary prints to stdout.

## Comparing against a baseline

```bash
# Compare latest run against committed baseline
npm run eval:compare evals/baseline.json

# Compare two specific runs
npm run eval:compare evals/results/run-a.json evals/results/run-b.json
```

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
- `{ "type": "regex", "value": "pattern" }` — final response matches the regex

## Scoring

A task is **passed** if it completes without errors and within the timeout.

A task is **solved** if it passes AND:

- All `expectedTools` were called
- No `forbiddenTools` were called
- All `outputMatchers` match the final model response

## Metrics captured per task

| Metric          | Source                                                                        |
| --------------- | ----------------------------------------------------------------------------- |
| `turns`         | Count of `apiResponseReceived` events                                         |
| `tool_calls`    | Count of `toolExecutionComplete` events                                       |
| `prompt_tokens` | High-water `promptTokenCount`                                                 |
| `cached_tokens` | `cachedContentTokenCount` at high-water                                       |
| `cache_ratio`   | `cached / prompt`                                                             |
| `output_tokens` | Sum of `candidatesTokenCount`                                                 |
| `cost_usd`      | `(uncached × input_price) + (cached × cache_price) + (output × output_price)` |
| `loop_fires`    | Tool executions returning "loop detected" error                               |
| `duration_ms`   | Wall clock from turn start to end                                             |
| `tool_list`     | Ordered list of tools called                                                  |

## Aggregate metrics

| Metric                             | Description                          |
| ---------------------------------- | ------------------------------------ |
| `pass_rate`                        | % of tasks passed                    |
| `solve_rate`                       | % of tasks solved                    |
| `mean_turns` / `p95_turns`         | Turn distribution                    |
| `mean_cache_ratio`                 | Average implicit-cache effectiveness |
| `mean_cost_usd` / `total_cost_usd` | Cost estimates                       |
| `total_loop_fires`                 | Total loop-detection events          |

## Architecture

The harness drives Obsidian via the `obsidian eval` CLI command, installing a temporary event-bus subscriber to capture agent lifecycle events. It does NOT modify plugin internals — all observation is via the existing `agentEventBus` subscriptions.

```
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
