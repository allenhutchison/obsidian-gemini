---
outline: deep
---

# Eval Suite

Gemini Scribe carries an agentic eval suite that measures how well a given LLM
behaves as the system under test — not just whether it answers questions, but
whether it _picks the right tools_, _doesn't break the vault_, and _stays
within budget_. This page documents what the suite measures and how to read
the results.

For the operator-facing harness reference (running sweeps, blessing baselines,
adding new tasks), see [`evals/README.md`](https://github.com/allenhutchison/obsidian-gemini/blob/master/evals/README.md)
in the repository.

## Why the suite exists

A chat-quality eval (does the model write good prose?) misses most of what
matters for an Obsidian agent. The harness was designed around a different
question: _given a vault and a user request, does the agent reliably do the
right thing?_ "Right" here means: read the correct files, call the right
tools in the right order, modify the vault only when asked, and produce a
response that actually satisfies the user's intent.

The suite is intentionally a **gradient**, not a saturated yes/no benchmark.
Tasks span four difficulty tiers so it separates model classes (frontier
Gemini tiers vs. open Ollama models, capability ceilings vs. cost-efficient
defaults) rather than maxing out at 100% on every model.

## Task catalog and difficulty tiers

The suite currently has **59 tasks** across four tiers:

| Tier   | Intent                                                                            |
| ------ | --------------------------------------------------------------------------------- |
| **T1** | Easy — single tool call, tiny corpus. Regression canary; every model should pass. |
| **T2** | Moderate — 2–3 tool calls, light distractors.                                     |
| **T3** | Hard — multi-hop reasoning, many distractor files, careful tool sequencing.       |
| **T4** | Hardest — long context, ambiguity resolution, refusal-vs-fabrication tradeoffs.   |

Each task is a JSON definition in `evals/tasks/` with a fixture (the
synthetic notes seeded into the vault before the agent runs), a user message,
expected/forbidden tool sets, and a rubric describing what counts as a
correct outcome.

## Scoring: `pass` vs `solve`

The harness scores two things per task run:

- **`pass`** — the run completed without harness errors and within the
  timeout. Effectively a liveness check.
- **`solve`** — the run passed _and_ satisfied the full rubric: all required
  tools were called, no forbidden tools fired, output matchers held, and the
  state-based vault assertions held.

`solve` is the headline number — it's the one that says "the agent actually
did the job."

### Output matchers

Three matcher types check the agent's final response:

- **`contains`** — substring match (case-sensitive by default, supports
  any-of arrays for wikilink-vs-title style variation).
- **`regex`** — JavaScript regex with explicit `flags`. Inline `(?i)`-style
  flags are _not_ supported by JS regex; pass `flags: "i"` separately.
- **`judge`** — LLM-as-judge for prose-heavy rubrics where literal substrings
  would be too brittle. See [Judge model](#judge-model) below.

### Vault assertions (state-based scoring)

`fileExists` / `fileContains` / `fileMatches` / `fileLacks` /
`fileUnchanged` / `frontmatterEquals` checks run against the post-task vault
state. This is how write/edit/delete tasks are scored: not by what the agent
_said_ it did, but by what's actually on disk after the run.

### Tool-call budget

A task can declare a `toolCallBudget`. Exceeding it makes `solve` false even
if every other criterion held. Catches "read every file in the vault"
behaviour that a more efficient tool would have answered in one call.

## Reliability: `pass^k` and `solve^k`

Each task runs **k** times (typically `k=3` for development, `k=5` for
publication-grade baselines). Two metrics fall out:

- **`pass^k` / `solve^k`** — the τ-bench reliability signal
  ([arXiv 2406.12045](https://arxiv.org/abs/2406.12045)): a task counts as
  passed/solved at k only when **all k runs** passed/solved. This is the
  noise-free number — LLM nondeterminism on a single run can't inflate it.
- **Mean rates** — proportion of all task × run cells that passed/solved.
  Useful signal, noisier.

Tasks that land between 0 and k solves are flagged as **flaky**. A small
number of flaky tasks isn't a regression — it's a property of the LLM and
the task — but the trend matters: a previously-stable task drifting flaky is
a real signal.

## Judge model

Prose-heavy rubrics use an LLM-as-judge instead of literal matchers. The
judge is a separate model from the system under test:

- It always uses Gemini, even when the system under test is Ollama, so the
  judge doesn't drift across model-swap experiments.
- The current standardized judge is **`gemini-3.5-flash`**, pinned (no
  `-latest` / `-preview`). It was selected against a hand-labelled gold set
  of 90 prose-judge tuples (a one-time human calibration committed in the
  repo): **94.4% agreement** with human ground truth, vs. 92.2% for
  `gemini-2.5-flash` (the previous default) and 93.3% for
  `gemini-3.1-flash-lite`. The accuracy ceiling under measurement was
  `gemini-3.1-pro-preview` at 95.6%, but a `-preview` id would have made
  every blessed score subject to silent re-rating if Google rotated the
  underlying weights.
- The judge runs with `temperature: 0` and a strict YES/NO contract.

### Bias caveats

The judge is **blind to the model id** — the prompt carries only the user
request, the agent's response, and the criterion, never the name of the
model that produced the response. Blindness removes _explicit_ identity
bias, but does not eliminate _latent stylistic-familiarity_ bias. Concretely:
a Gemini judge grading a Gemini-family system under test (the case for every
row in the table below except `gemma4`) is exposed to same-family stylistic
preference. The current judge is the same vendor as most of the system-under-
test set; results across vendor lines (Gemini-judged Ollama vs Gemini-judged
Gemini) should be read with that caveat.

A cross-vendor judge is the cleanest fix and is straightforward to revisit
if a future calibration round shows persistent same-family bias.

## Baselines

A **baseline** is a blessed, committed result for a `(provider, model)` pair.
It's not auto-promoted: the operator explicitly runs `npm run eval:bless`
after inspecting a clean run, and commits the resulting
`evals/baselines/<provider>-<sanitized-model>.json`. Subsequent runs
auto-compare against the matching baseline and flag regressions in `pass^k`
or `solve^k`.

Baselines pin to **specific model ids** — never `-latest` or `-preview`.
Those tags can rotate underneath us silently, which destroys the regression
signal.

## Published results

Every model that's been blessed against the current 59-task suite. Rows are
sorted by `solve^k` (the headline reliability number) descending. The
**Commit** column links to the SHA the harness was built from when the sweep
ran; the **Date** column is the sweep's ISO timestamp (UTC).

<script setup>
import { data as rows } from '../evals.data.mts';

function fmtDate(iso) {
  if (!iso) return '—';
  // The ISO `run_id` includes microseconds; the UTC YYYY-MM-DD prefix is the
  // useful part for a results-table glance.
  return iso.slice(0, 10);
}
function shortSha(sha) {
  return (sha || '').slice(0, 7);
}
function pct(n) {
  return typeof n === 'number' ? `${n.toFixed(1)}%` : '—';
}
function tierRate(row, tier) {
  const b = row.by_difficulty?.[tier];
  if (!b || !b.total_tasks) return '—';
  return `${b.solve_k_count}/${b.total_tasks}`;
}
</script>

<table v-if="rows.length" class="evals-results">
  <thead>
    <tr>
      <th>Model</th>
      <th>Provider</th>
      <th>k</th>
      <th>Tasks</th>
      <th>pass^k</th>
      <th>solve^k</th>
      <th>T1</th>
      <th>T2</th>
      <th>T3</th>
      <th>T4</th>
      <th>Date (UTC)</th>
      <th>Commit</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="r of rows" :key="r.source">
      <td><code>{{ r.model }}</code></td>
      <td>{{ r.provider }}</td>
      <td>{{ r.n_runs }}</td>
      <td>{{ r.total_tasks }}</td>
      <td>{{ pct(r.pass_k_rate) }}</td>
      <td><strong>{{ pct(r.solve_k_rate) }}</strong></td>
      <td>{{ tierRate(r, 'T1') }}</td>
      <td>{{ tierRate(r, 'T2') }}</td>
      <td>{{ tierRate(r, 'T3') }}</td>
      <td>{{ tierRate(r, 'T4') }}</td>
      <td>{{ fmtDate(r.run_id) }}</td>
      <td>
        <a v-if="r.git_sha"
           :href="`https://github.com/allenhutchison/obsidian-gemini/commit/${r.git_sha}`"
           target="_blank" rel="noopener">
          {{ shortSha(r.git_sha) }}
        </a>
        <span v-else>—</span>
      </td>
    </tr>
  </tbody>
</table>

<p v-else class="evals-empty">
  No baselines committed yet. Run <code>npm run eval -- --model=&lt;id&gt;</code>
  and <code>npm run eval:bless</code> to produce one.
</p>

### Reading the table

A few patterns worth calling out from the current rows:

- **The "lite" label is misleading.** `gemini-3.1-flash-lite` (74.1% solve^5)
  materially beats `gemini-2.5-flash` (57.4%) on the same 54-task suite and
  the same judge — a ~17pp gap. The newer flash-lite is the more capable
  agentic model despite the name.
- **The T1 → T4 gradient is doing real work.** Compare `gemma4:e4b`
  (100% on T1, then 15% / 7% / 11% through T2–T4) against `gemini-3.1-flash-lite`
  (100% / 85% / 66% / 78%). T1 is a regression canary that every plausible
  agent should clear; T2–T4 is where the open-model tier and the frontier
  tier separate.

## Adding a model to the table

The table is generated from `evals/baselines/*.json` at docs-build time, so
publishing a new model is the same operation as blessing a baseline. From
the repo:

```bash
# Pin the model id — do not use -latest or -preview ids
npm run eval -- --model=<id> --repeat=5    # or --provider=ollama --model=<id>
npm run eval:bless                          # promotes the most recent result
git add evals/baselines/<provider>-<sanitized-model>.json
git commit -m "chore(evals): bless baseline for <id>"
```

The docs build picks up the new file automatically — no template edits.

<style scoped>
.evals-results {
  display: table;
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  margin: 1rem 0;
}
.evals-results th,
.evals-results td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}
.evals-results th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-2);
}
.evals-results code {
  font-size: 0.92em;
}
.evals-empty {
  color: var(--vp-c-text-2);
  font-style: italic;
}
</style>
