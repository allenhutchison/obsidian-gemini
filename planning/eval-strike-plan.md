# Eval Strike — plan and outcome

_obsidian-gemini · agentic eval harness_
_Planned and executed 2026-05-22 → 2026-05-25_

## Summary

A multi-day push to turn the agentic eval harness into a credible, publishable
productivity benchmark. Every critical-path node landed; every phase closed.

- **10 merged PRs** (#879, #880, #887, #888, #889, #890, #891, #893 — plus the
  skill-doc fix that folded into the #879 squash and the daily-changelog PR
  that ran on the side).
- **8 closed issues** along the critical path and its side-quests (#712, #714,
  #845, #869, #870, #871, #873, #874, #875; #872 closed as no-longer-needed).
- **~$2 in API spend** for all measurement and re-baseline work.
- **One fully calibrated judging pipeline** — including a hand-labelled gold
  set and a measurement tool that scores candidate judges against it.
- **One auto-updating public results page** at `docs/reference/evals` that
  picks up any newly-blessed baseline on the next docs build.

## Headline numbers (final published results)

All under the new `gemini-3.5-flash` judge, on the 54-task suite, at `k=5`:

| Model                   | Provider | `pass^k` | `solve^k` | Cost / sweep |
| ----------------------- | -------- | -------- | --------- | ------------ |
| `gemini-3.1-flash-lite` | gemini   | 100%     | **74.1%** | $0.31        |
| `gemini-2.5-flash`      | gemini   | 98.1%    | **57.4%** | $0.42        |
| `gemma4:e4b`            | ollama   | 90.7%    | **14.8%** | $0.00        |

## Phase 0 — Housekeeping

- **#712** — _Repo skill for running the evals_ → **Closed** (no PR).
  Verified already covered by the existing `eval-harness` skill;
  drive-by added a "build the plugin under test" preflight step to
  the skill while there.

## Phase 1 — Harness foundation

- **#869** — _Persist judging evidence (response, matchers, transcript)_
  → **PR #879**. Per-run `response_text` + itemized `matcher_details` (mirror
  of the existing `vault_assertion_details`) on every result, and an
  enriched transcript sidecar per run under
  `evals/results/<run-id>/<task>-<n>.json`. Collector enrichment keeps a
  truncated `tool.result.data` so transcripts show what each tool _returned_,
  not just that it ran. Smoke-tested live.

- **#845** — _`--provider=` override for cross-provider runs_ → **PR #880**.
  Mirror of the existing `chatModelName` override/restore, so Ollama sweeps
  no longer need a manual UI toggle of the provider setting. Smoke-tested
  against live `gemma4:latest` — overrides applied at start and restored on
  exit (including SIGINT/SIGTERM).

## Phase 2 — Judge correctness

- **#870** — _Human-labelled judge calibration set_ → **PR #887**.
  Built the extraction tooling (`evals/lib/calibration.mjs` +
  `npm run eval:calibrate-extract`) and produced the gold set: 90 tuples
  across the 30 prose-judge tasks, hand-labelled YES/NO in this session.
  Headline: 92% agreement with `gemini-2.5-flash` (then-current judge);
  7 disagreements cluster on cosmetic-formatting brittleness and rubric-
  vs-response-content mismatches.

- **#714** — _Investigate flaky tasks_ → **PR #888**, then closed.
  Calibration-data-driven: dropped a judge criterion on
  `rewrite-section-inplace` that demanded response-side coverage the
  prompt never asked for, and fixed three `fileMatches` regexes that
  had been silently failing on JS-incompatible `(?i)` inline-flag
  syntax. Task moved from 0/3 → 3/3 solved. Original named flaky tasks
  (`loop-trap-cyclic-refs`, `smoke-list-files`) were already 3/3 on the
  current model; remaining sweep flakiness folded into #871 as judge
  brittleness.

- **#871** — _Decide and standardize the LLM-as-judge_ →
  **PR #889 (measurement tool) + PR #890 (decision)**.
  Built `npm run eval:calibrate-judge -- --model=<id>` to score any
  candidate judge against the #870 gold set. Measured four candidates and
  picked `gemini-3.5-flash`:

  | Judge                    | Agreement | Stable id    | Verdict                       |
  | ------------------------ | --------- | ------------ | ----------------------------- |
  | `gemini-2.5-flash`       | 92.2%     | ✓ pinned     | replaced                      |
  | `gemini-3.1-flash-lite`  | 93.3%     | ✓ pinned     | rejected (missed fabrication) |
  | **`gemini-3.5-flash`**   | **94.4%** | ✓ pinned     | **picked**                    |
  | `gemini-3.1-pro-preview` | 95.6%     | ✗ `-preview` | rejected (unstable id)        |

- **#872** — _Provider-agnostic judge harness (Anthropic support)_ → **Closed**
  as no longer needed once #871 picked a Gemini judge. Re-open if a future
  calibration round shows persistent same-family bias against the published
  model set.

## Phase 3 — Re-baseline

- **#873** — _Re-baseline all models on the 54-task suite_ → **PR #891**.
  Three sequential sweeps at `--repeat=5` under the new judge:
  `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemma4:e4b` (pinned over
  `:latest`). Dropped the stale `gemini-3-flash-preview` baseline (`-preview`
  is barred by the harness skill). ~3 hours of harness time, $0.73 across
  810 task-runs, zero ERRORs.

- **#716** — _Model orchestration (preload / swap / unload)_ → **Left open
  intentionally**. Optional polish; earns its keep only if the published
  table grows on the Ollama side and the swap-friction dance becomes a real
  blocker. The current `--model=` + `--provider=` plumbing covers
  single-model sweeps cleanly.

## Phase 4 — Publish

- **#874 + #875** — _Methodology doc + published results table_ →
  **PR #893** (single page closes both). `docs/reference/evals`:
  - Methodology prose covering suite intent, T1–T4 tiers, scoring
    (pass/solve, matchers, vault assertions, tool budget), `pass^k`
    reliability, blessing, and the judge model with an explicit
    same-family bias caveat.
  - Vue-rendered table fed by `docs/evals.data.mts`, a VitePress data
    loader over `evals/baselines/*.json`. New baselines auto-publish on
    the next docs build.
  - "Reading the table" subsection calls out the two patterns the suite
    surfaced (flash-lite > flash-2.5; T1→T4 gradient working as designed).

## Surfaced findings worth keeping visible

1. **The "lite" naming is misleading.** `gemini-3.1-flash-lite` materially
   beats `gemini-2.5-flash` on the same suite + same judge — ~17pp on
   `solve^5`. The newer flash-lite is the more capable agentic model.
2. **The T1→T4 difficulty gradient is doing real work.** Gemma4 hits
   100% on T1 then collapses through T2–T4 (15% / 7% / 11%); flash-lite
   stays above 65% across all tiers. T1 is a regression canary; T2–T4
   is where open-model and frontier tiers separate.
3. **The current judge has measurable nondeterminism even at `temperature: 0`.**
   Same gold set, two fresh runs of the same judge produced the same
   accuracy number but a different set of disagreeing tuples (some
   resolved, some flipped). Worth remembering when reading single-run
   judge measurements.
4. **Calibration-data-driven task fixes work.** PR #888 (`rewrite-section-inplace`)
   was discovered _only_ because labelling forced careful reading of each
   criterion. Two latent bugs (a mismatched criterion and silently-failing
   regex syntax) had been hiding behind each other for months.

## Critical path — all green

```
#869 → #870 → #871 → #873 → #875
 ✓     ✓     ✓     ✓     ✓
```

Off-path side-quests: **#712** (closed), **#714** (closed), **#845** (merged),
**#872** (closed as not needed), **#874** (merged alongside #875), **#716**
(left open as optional polish).

## Issue inventory

| Issue                                                                | Title                                                           | Outcome                                             |
| -------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| [#687](https://github.com/allenhutchison/obsidian-gemini/issues/687) | Epic: hill-climb the eval harness into a productivity benchmark | Umbrella epic — all work below rolls up             |
| [#712](https://github.com/allenhutchison/obsidian-gemini/issues/712) | Repo skill for running the evals                                | ✓ Closed — `eval-harness` skill covers it           |
| [#845](https://github.com/allenhutchison/obsidian-gemini/issues/845) | `--provider=` override for cross-provider runs                  | ✓ Merged (PR #880)                                  |
| [#869](https://github.com/allenhutchison/obsidian-gemini/issues/869) | Persist judging evidence (response, matchers, transcript)       | ✓ Merged (PR #879)                                  |
| [#714](https://github.com/allenhutchison/obsidian-gemini/issues/714) | Investigate flaky tasks                                         | ✓ Closed (PR #888 + reclassification to #871)       |
| [#870](https://github.com/allenhutchison/obsidian-gemini/issues/870) | Human-labelled judge calibration set                            | ✓ Merged (PR #887)                                  |
| [#871](https://github.com/allenhutchison/obsidian-gemini/issues/871) | Decide and standardize the LLM-as-judge                         | ✓ Merged (PR #889 + #890) — picked gemini-3.5-flash |
| [#872](https://github.com/allenhutchison/obsidian-gemini/issues/872) | Provider-agnostic judge harness (Anthropic support)             | ✓ Closed — no longer needed                         |
| [#716](https://github.com/allenhutchison/obsidian-gemini/issues/716) | Model orchestration — preload / swap / unload                   | Open — optional polish                              |
| [#873](https://github.com/allenhutchison/obsidian-gemini/issues/873) | Re-baseline all models on the 54-task suite                     | ✓ Merged (PR #891)                                  |
| [#874](https://github.com/allenhutchison/obsidian-gemini/issues/874) | Eval-suite methodology doc                                      | ✓ Merged (PR #893)                                  |
| [#875](https://github.com/allenhutchison/obsidian-gemini/issues/875) | Published results table                                         | ✓ Merged (PR #893)                                  |

---

Tracked under epic [#687](https://github.com/allenhutchison/obsidian-gemini/issues/687).
This file is a frozen record of the work; the live published results table
lives at [`docs/reference/evals`](../docs/reference/evals.md).
