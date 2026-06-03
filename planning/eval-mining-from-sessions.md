# Mining real Agent-Sessions for eval test cases

_Survey date: 2026-06-01 · Source: `adh` vault `Resources/Gemini Scribe/Agent-Sessions/` (73 sessions)_

## Build status (2026-06-01)

Five tasks authored from this survey and added to `evals/tasks/` (suite 54 → 59). All
JSON validated; fixtures synthetic/sanitized; not yet run or blessed.

| Task id                      | Tier | Covers blind spot                                                           | Fixture                                                                      | Grading                                                 |
| ---------------------------- | ---- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| `reading-list-curate`        | T4   | recency window + Document-Note filter + dedup-against-index + write-back    | `reading-list-curate/` (7 articles + index + sync log)                       | judge (exactly 3 picks) + 9 vault assertions            |
| `recency-sync-vs-age`        | T4   | sync-date vs publish-date recency trap (bulk backfill)                      | `recency-sync-vs-age/` (3 fresh + 3 backfill + sync log)                     | judge + 3 positive regex (read-only)                    |
| `tag-search-no-refusal`      | T2   | anti-refusal / tool-discipline on tag search                                | `tag-search-no-refusal/` (3 `#important` + 2 `#important-soon` + 3 untagged) | 3 contains + judge (no refusal, precision)              |
| `word-count-exclude-outline` | T3   | exact count with content-type exclusion (truth = 823 words)                 | `word-count-exclude-outline/` (7 chapters; ch7 has an `## Outline` block)    | judge (808–838, must exclude outline; 891 = fail)       |
| `vary-repeated-word`         | T3   | single-turn reframing of multi-turn stylistic refinement + scope discipline | `vary-repeated-word/` (draft w/ `fascinate`×5 + sibling index)               | judge + 9 vault assertions (`generate_image` forbidden) |

**Deferred — multimodal extraction (Prusa screen / printed letter / PDF résumé):** needs
harness work. Fixtures load as UTF-8 text (`run.mjs` `loadFixtureFiles`) and the context
shelf is text-only (`agent-view.ts` `addContextFileToShelf → shelf.addTextFile`), so a
binary image/PDF can't reach the model today. `ReadFileTool` already returns `inlineData`
for binary files, so the cleanest path is: add binary-fixture support to the loader, seed a
PNG/PDF into `eval-scratch/`, and have the task ask the agent to `read_file` it. Scoped as a
separate follow-up.

**Note on the published "54-task" results.** The blessed baselines in
`docs/reference/evals` were measured on the 54-task set. These 5 new tasks won't appear in the
published table until a re-sweep + re-bless. Don't edit the methodology's task count until then.

## Next step

Run the new tasks via the **eval-harness** skill (spends API, needs a live Obsidian) to
sanity-check that each is calibrated — passes for a strong model, isn't trivially solved or
impossible. `npm run eval -- --task=reading-list-curate` (etc.), or sweep all five.

## Why this exercise

The current 54-task eval suite (`evals/tasks/`) is **entirely synthetic, single-turn
retrieval on tiny invented corpora** (Project Lyra, Cordwain Spice Guild). Allen's real
Agent-Sessions are messy, multi-turn, skill-driven, and grounded in a real vault — they
surface whole categories of task that the synthetic suite never exercises.

## Blind spots in the current suite (what the real sessions cover that we don't)

| Blind spot                                                                                        | Appears in real sessions                                    | Synthetic coverage today        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| **Recency / date-window filtering**                                                               | every Readwise + Reading List session                       | none                            |
| **Dedup against a persistent index** (read index → exclude → write back)                          | all 6 Reading List sessions                                 | none                            |
| **Conditional filtering on a per-item field** ("only articles with a `Document Note:`")           | Reading List #5–#7                                          | none                            |
| **Multi-turn quality refinement** (user critiques the agent's prose mid-conversation)             | Köln Concert, Reading List #7, Kori/Piranesi, LfSV drafting | none                            |
| **State-dependent reasoning** (a constraint at turn 5 retroactively disqualifies a turn-1 answer) | Next Car, Internet of Agents                                | none                            |
| **Multimodal / image + PDF extraction**                                                           | Prusa screen, Homeowner letter, 21 Years at Google (PDF)    | none                            |
| **Adversarial grounding** (verify a draft claim against a fetched source)                         | Köln Concert, Release blog (link-verifier skill)            | tiny                            |
| **Tool / MCP failure honesty** (tool fails repeatedly — don't fabricate success)                  | Release blog (WordPress MCP), Skills Overview (image gen)   | none (tools assumed to succeed) |
| **Exact counting with content discrimination** (word counts, exclude scaffolding)                 | Story Word Count, Retry Request                             | none                            |
| **Anti-refusal / capability-underuse** (agent wrongly claims it can't do X)                       | Notes tagged #important                                     | none                            |
| **Append-vs-overwrite & no-overwrite discipline**                                                 | Daily Readwise, Transformer Series, Alaska rental           | partial (destructive-restraint) |
| **Memory-write discipline**                                                                       | LfSV Style Guide, Use WikiLinks, Prompt System              | minimal                         |
| **Honest-negative + retrieve-adjacent** ("no exact guide, but here's the related note")           | Proxmox VM, Sempervirens Files                              | none (clean hit/miss only)      |

## Top candidates to build first (ranked)

Ranked by (value of blind spot covered) × (cheapness to fixture) × (presence of a real
failure/variance signal worth regression-guarding).

1. **Reading List core loop** — recency + dedup-against-index + conditional `Document Note:`
   filter + write-back. _T3–T4, MED fixture._ The single highest-value shape; appears in 6
   sessions. We have both a **clean run** (`2026-06-01 Building Reading List #7`) and a
   **thrashing run** (`2026-06-01 Reading List 7 Drafting`, re-read same files 3–4×) to use
   as positive and negative baselines. Build as 2 tasks: a read-only shortlist task and a
   write-back task.
2. **Recency ambiguity trap** — `2026-04-19 Daily Reading List Candidates`. _T4, MED-HIGH._
   "Recent" has two meanings: sync-date vs. article age. A bulk backfill sync is a planted
   trap; the agent **got it wrong first** and only fixed it after user correction. Grade the
   _first_ response for catching the trap unprompted.
3. **Multimodal precise-value extraction** — Prusa screen + Homeowner letter. _T2, MED._
   Two cheap-to-grade image→exact-string tasks (Z-offset `-1.320mm`, planted codes/emails).
   Closes the entire multimodal blind spot; regex matchers on planted ground truth; forbid
   all file tools (answer from the image only).
4. **Multi-turn stylistic refinement** — `2026-06-01 Building Reading List #7` turn 2
   ("I'm using 'fascinate' too many times — vary it"). _T3, MED._ Negative regex (word count
   ≤1) + judge that opinions survive. Bonus **scope-discipline** variant: the agent also fired
   an unrequested `generate_image` — make it a `forbiddenTool`.
5. **Adversarial grounding / link-verifier** — Köln Concert + Release blog. _T4, MED-HIGH._
   Draft contains a claim NOT supported by its linked source; agent must flag exactly that
   claim. In Köln the agent **itself wrote the fabricated claim**, then fumbled the first fix.
   Gold standard for verify-claim-against-source.
6. **Tool/MCP failure honesty** — Release blog (WordPress MCP fails ~6×). _T3–T4, HIGH._
   Stub a failing tool; judge that the agent reports failure + falls back, never claims
   success. (One real recovery move was searching the _vault_ for the runtime error string —
   a clearly-wrong behavior to penalize.)
7. **Exact count with content discrimination** — Story Word Count (exclude outline block) +
   Retry Request (14 of 86 files). _T3–T4, LOW-MED._ The agent gave precise integers in one
   session and vague "~approximate" counts in another — the variance is the signal.
8. **Anti-refusal / tool-discipline** — Notes tagged #important. _T2, LOW._ Agent wrongly
   claimed "I can't search tags" and punted. Clean regression guard: expect
   `find_files_by_content`, forbid bare refusal.
9. **State-dependent constraint accumulation** — Next Car. _T4, LOW-MED, text-only._ Each
   turn adds a constraint; a constraint at turn 5 must retroactively eliminate a candidate
   praised at turn 1, plus a final split/rename via `move_file`.
10. **User corrects the agent's wrong assertion** — Internet of Agents. _T4, MED._ Agent
    confidently asserts wrong terminology (ACP→MCP), user corrects, agent must override its
    own prior reasoning and not reintroduce the error. (Notably the agent gave the _correct_
    analysis of the same terms in `Draft Review- When Agents Talk` — cross-session
    inconsistency worth pinning.)

## Recurring cross-cutting findings (worth their own eval themes)

- **No-hallucinate-links.** Across nearly every _writing_ session the agent claimed to add
  internal WikiLinks to prior posts without any tool call verifying those notes exist
  (`[[Managing the Agent's Attention]]`, `[[2024-11-23 - Introducing Gemini Scribe...]]`).
  Plant a draft referencing real + non-existent notes; grade whether the agent verifies link
  targets before asserting them.
- **Over-reading / weak tool budget.** Every Reading List session `read_file`'d dozens-to-~80
  articles to apply a filter doable from metadata/sync-log first. Strong material for
  `toolCallBudget`-capped variants.
- **Fabrication-under-confidence.** Invented API model names + pricing (Gemini CLI session),
  specific RV spec/price (RV session) — confident specifics with no retrieval.
- **Artifact leakage.** One response leaked a raw tool-result fragment
  (`<ctrl46>,success:true}<ctrl45>...`) into prose — candidate negative matcher (response must
  not contain control-token/tool-result residue).

## Full per-session catalog

Legend: ✅ strong candidate · 🟡 weak/secondary · ⛔ not mineable (chit-chat / empty / pure-knowledge)

| Session                                       | Verdict | Pattern                                                       | Tier  | Fixture  | Notable signal                                     |
| --------------------------------------------- | ------- | ------------------------------------------------------------- | ----- | -------- | -------------------------------------------------- |
| 2026-04-04 Ambiguity and Aliens Draft         | ✅      | multi-turn refine + dead-link restraint + permalink grounding | T4    | MED      | artifact-leak failure; rejected first hook         |
| 2026-04-04 Homeowner Handover Letter          | ✅      | multimodal OCR/extraction                                     | T2    | MED      | clean; exact strings to match                      |
| 2026-04-04 Letters From Silicon Valley Review | 🟡      | synthesis + create-file w/ valid links                        | T3    | LOW-MED  | asserted facts w/ zero tool calls                  |
| 2026-04-04 Prusa 3D Printer Screen            | ✅      | multimodal precise-value extraction                           | T2    | MED      | clean; good calibrated hedging                     |
| 2026-04-05 Create Daily Setup Skill           | ✅      | skill-authoring (create then edit)                            | T3    | LOW-MED  | correctly used edit_skill not re-create            |
| 2026-04-05 Sempervirens Summary               | ✅      | idempotent edit / dedup-in-file                               | T3    | MED      | turn-3 critique w/ zero reads                      |
| 2026-04-05 Skills vs Custom Prompts           | 🟡      | grounding-via-help-skill                                      | T2    | LOW      | redundant 3× activate_skill                        |
| 2026-04-06 Sempervirens Files                 | ✅      | honest-negative retrieval                                     | T2    | LOW-MED  | clean "not found" w/ distractors                   |
| 2026-04-07 Bundled Skills Blog Draft          | ✅      | skill-composition + structural-convention edit                | T3    | MED      | invented post title; skill paused to ask           |
| 2026-04-07 Gemini Scribe Project Blog Draft   | 🟡      | skill-grounded draft                                          | —     | —        | duplicate pattern                                  |
| 2026-04-07 Polyrepo Takeaways                 | ✅      | grounding (answer-from-doc-only)                              | T3    | LOW      | well-grounded positive example                     |
| 2026-04-07 Prompt System & TS6                | ✅      | memory-write + vault/web synthesis                            | T3    | HIGH     | clean multi-capability                             |
| 2026-04-07 Refining Scribe Projects Post      | 🟡      | single-turn style-guide apply                                 | —     | —        | invented-link risk                                 |
| 2026-04-07 Use WikiLinks for Files            | 🟡      | preference-persistence (2-turn)                               | T2    | LOW      | instruction persistence seed                       |
| 2026-04-08 Daily Readwise Summary             | ✅      | recency-filter + append discipline                            | T3    | MED      | correct append_content                             |
| 2026-04-09 Assistant Skills Overview          | ✅      | tool-failure recovery (image gen)                             | T2    | MED      | graceful failure, bounded retry                    |
| 2026-04-10 Next Blog Post Ideas               | ✅      | dedup-after-correction + path recovery                        | T3    | MED      | recovered from wrong paths; title slip             |
| 2026-04-12 Readwise Daily Brief               | ✅      | date-scoped synthesis + 2-file write                          | T3    | MED      | redundant date search                              |
| 2026-04-12 Today's Readwise Notes             | 🟡      | recency filter + report-empty honestly                        | T2    | LOW-MED  | clean                                              |
| 2026-04-16 Reading List Infographic           | 🟡      | multimodal-generation from context                            | T2    | MED      | clean                                              |
| 2026-04-18 Daily Reading List                 | ✅      | conjunctive filter (recent+note+not-indexed)                  | T3    | MED      | over-read ~12 articles                             |
| 2026-04-18 Next Daily Reading List            | ✅      | dedup-against-index w/ state write-back                       | T3-T4 | MED      | ideal multi-turn shape                             |
| 2026-04-19 Daily Reading List Candidates      | ✅      | recency ambiguity trap (sync vs age)                          | T4    | MED-HIGH | **wrong first, corrected**; read ~80 files         |
| 2026-04-19 Generate Helpful Robot Image       | ⛔      | trivial single tool call                                      | —     | —        | —                                                  |
| 2026-04-19 npm Dependency Resolution          | ⛔      | pure-knowledge                                                | —     | —        | —                                                  |
| 2026-04-19 Whisper Transcription Research     | 🟡      | skill→artifact→image chain                                    | T3    | HIGH     | position-aware embed                               |
| 2026-04-28 Today's Schedule                   | 🟡      | MCP + temporal reasoning                                      | T2    | HIGH     | needs mock calendar                                |
| 2026-04-30 Vault Overview                     | ⛔      | zero retrieval (hallucination risk)                           | —     | —        | no ground truth                                    |
| 2026-05-02 Next Car Evaluation                | ✅      | cumulative constraint filtering + split/rename                | T4    | LOW-MED  | constraint retroactively disqualifies              |
| 2026-05-03 Daily Schedule Setup               | 🟡      | skill+MCP+template fill                                       | T3    | HIGH     | needs calendar MCP                                 |
| 2026-05-03 Long-Term Alaska Jeep Rental       | 🟡      | research→persist→append                                       | T3    | MED      | append-not-overwrite                               |
| 2026-05-03 Reading List Image Prompt          | 🟡      | option-gen then execute-selected                              | T2    | MED      | niche                                              |
| 2026-05-03 The Köln Concert                   | ✅      | adversarial grounding + multi-turn refine + sycophancy-resist | T4    | MED-HIGH | **agent wrote fabricated claim**; declined move    |
| 2026-05-04 Daily Setup & Trip Planning        | 🟡      | external-doc ingest → append                                  | T3    | HIGH     | empty/aborted first turn                           |
| 2026-05-05 Reading List #5 Curation           | ✅      | conditional filter (Document Note) + dedup                    | T3    | MED      | competing index sources; read ~60 files            |
| 2026-05-08 Gemini Scribe Release Blog         | ✅      | MCP-failure honesty + attribution edit + link-verify          | T3-T4 | MED-HIGH | **MCP fails ~6×**; searched vault for error string |
| 2026-05-16 Reading List #6 Candidates         | ✅      | recency+dedup+conditional + MCP error recovery                | T4    | MED      | WP MCP Unauthorized→param thrash                   |
| 2026-05-22 Mapping 21 Years at Google         | ✅      | PDF extraction + grounding + preserve-links                   | T3    | MED-HIGH | good self-uncertainty flags                        |
| 2026-05-24 Vycari.ai Core Values              | 🟡      | one-question discipline + create-then-move                    | T2    | LOW      | mostly elicitation                                 |
| 2026-06-01 Building Reading List #7           | ✅      | recency+dedup+conditional + **stylistic refine**              | T4    | MED      | unrequested generate_image (scope)                 |
| 2026-06-01 Reading List 7 Drafting            | 🟡      | (negative) redundant-read / thrashing                         | T3    | MED      | re-read files 3-4×; terse output                   |
| Agent Session 11-14-2025                      | ⛔      | empty                                                         | —     | —        | —                                                  |
| Agent Session 12-23-2025                      | ⛔      | empty                                                         | —     | —        | —                                                  |
| Agent Session 2026-04-04                      | ⛔      | empty                                                         | —     | —        | —                                                  |
| AI Insights from My Vault                     | 🟡      | large-corpus grounding                                        | T3    | HIGH     | no tool trace                                      |
| Annotating Today's Links                      | 🟡      | in-place per-item enrichment                                  | T2    | LOW      | possible ungrounded summaries                      |
| Assistant Capabilities Inquiry                | ⛔      | capability chit-chat                                          | —     | —        | —                                                  |
| Chezmoi Note Setup                            | 🟡      | placement-reasoning + create                                  | T2    | LOW      | inferred correct folder                            |
| Debugging Obsidian on iOS                     | ⛔      | pure-knowledge                                                | —     | —        | honest "not in vault"                              |
| Drafting- Everything Becomes an Agent         | 🟡      | synthesis grounded in projects                                | T2-T3 | LOW-MED  | clean                                              |
| Drafting Letters From Silicon Valley          | ✅      | multi-turn edits + **state-dependent revert**                 | T3-T4 | MED      | HTML-entity escaping bug                           |
| Draft Review- When Agents Talk                | ✅      | multi-hop contradiction detection + honesty                   | T4    | MED      | caught real conflict; bounded knowledge            |
| Expanding The Internet of Agents              | ✅      | user corrects wrong agent assertion                           | T4    | MED      | **confidently wrong, over-corrected user**         |
| Finding AI Agent Drafts                       | 🟡      | scoped retrieval + relevance filter                           | T2    | LOW-MED  | over-inclusive (precision)                         |
| Gemini CLI Research Extension                 | 🟡      | incremental note-building                                     | T3    | LOW      | invented API facts                                 |
| Greeting Gemini                               | ⛔      | chit-chat                                                     | —     | —        | —                                                  |
| Inquiry about Available Tools                 | ⛔      | capability question                                           | —     | —        | —                                                  |
| Insights from My Notes                        | 🟡      | grounding / cite-real-notes                                   | T2-T3 | MED      | citation risk                                      |
| Kori's Thoughts on Piranesi                   | ✅      | multi-turn critique-refine + exact-list extraction            | T4    | MED      | **wrong in-character first, corrected**            |
| Letters From Silicon Valley Style Guide       | ✅      | large-corpus synthesis → memory + file                        | T4    | MED-HIGH | proactive AGENTS.md write                          |
| New Chat                                      | ⛔      | chit-chat                                                     | —     | —        | —                                                  |
| Notes tagged #important                       | ✅      | anti-refusal / tool-discipline                                | T2    | LOW      | **wrong refusal** — strong regression guard        |
| Obsidian Plugin Release Workflow              | 🟡      | single-note procedural retrieval                              | T2    | LOW      | duplicative                                        |
| Proxmox Ubuntu VM Setup                       | ✅      | honest-negative + retrieve-adjacent + verbatim commands       | T3    | LOW-MED  | calibrated partial-match honesty                   |
| Retry Request                                 | ✅      | conditional file-select (14/86) + exact word-count            | T4    | MED      | **hedged "~approx" counts**                        |
| RV General Knowledge                          | 🟡      | temporal-preference synthesis                                 | T3    | MED      | spec-accuracy risk                                 |
| Sempervirens Project MOC                      | ✅      | organize-and-emit complete MOC                                | T3    | MED      | completeness/categorization grading                |
| Story Word Count- Ch 1-7                      | ✅      | exact count + content-type exclusion                          | T3    | LOW-MED  | precise here vs vague elsewhere                    |
| Sweet vs. Red Onions                          | ⛔      | general knowledge                                             | —     | —        | —                                                  |
| Transformer Series- Top-Down                  | 🟡      | no-overwrite write discipline                                 | T2    | LOW      | obeyed correctly (positive baseline)               |
| UHK 80 Keyboard Post Idea                     | 🟡      | multi-turn cumulative append                                  | T3    | LOW      | duplicate of Gemini CLI                            |
| Vault Insights About Me                       | 🟡      | open-ended grounding                                          | —     | —        | duplicate                                          |

## Notes on building these as harness tasks

- **Sanitize.** Replace personal specifics (real article titles, names, server hostnames) with
  synthetic placeholders when building fixtures — nothing personal lands in the repo.
- **Capture the failure, not just the task.** The most valuable cases (#2, #5, #6, #7, #10)
  are ones where the agent got it _wrong first_. Encode the trap so a passing agent must avoid
  the mistake the real run made.
- **Pair clean + thrashing runs.** Reading List #7 (clean) vs #7 Drafting (re-read 3-4×) gives
  a built-in positive/negative pair for a `toolCallBudget` discipline variant.
- **Multimodal needs harness support.** Confirm the runner can attach an image/PDF to the
  `userMessage` before committing to the Prusa / 21-Years tasks (the existing suite is
  text-only, so this may need driver work).
