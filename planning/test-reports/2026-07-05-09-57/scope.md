# Plugin acceptance test — scope

- **Vault:** Test Vault
- **Plugin version:** 4.10.2 (manifest not yet bumped past last tag)
- **Last release:** 4.10.2 (2026-06-26)
- **Baseline test count (prior report 2026-05-17):** 2835 passed

## New-since-4.10.2 features (weighted highest)

| Feature                                                                                                | PR                                  | Doc coverage                              | Test focus                                                              |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| **Plan Mode UI affordance** (checklist toggle → Plan pill, command)                                    | #1046                               | agent-mode.md §Plan Mode                  | `[NEW]` toggle renders, command exists                                  |
| **Design token layer + signature accent** (gradient send, brand mark, elevation, motion, progress bar) | #1090,#1107,#1104,#1109,#1110,#1112 | design-system.md (contributing)           | `[NEW]` visual — agent view, buttons, progress                          |
| **SVG/SVGZ rasterize to PNG before inlining**                                                          | #1082                               | agent-mode.md §SVG Handling               | `[NEW]` classification; unit-tested (svg-rasterizer.test.ts, 189 lines) |
| **Prefer background execution for long-running tools**                                                 | #1085                               | background-tasks.md, agent-mode.md        | `[NEW]` deep_research/generate_image default to background              |
| **Ollama: single model picker** (collapse per-use-case)                                                | #1125                               | ollama-setup.md                           | `[NEW]` settings show single Ollama model picker                        |
| **Ollama: auto-detect vision via /api/show**                                                           | #1058                               | ollama-setup.md, provider-capabilities.md | `[NEW]` (needs Ollama running — likely skip)                            |
| **Ollama: calibrate token counts**                                                                     | #1076                               | ollama-setup.md                           | `[NEW]` (needs Ollama)                                                  |
| **Streaming follow-up + mid-stream Stop cancel**                                                       | #1053,#1097                         | agent-mode.md                             | `[NEW]` Stop halts mid-stream follow-up                                 |
| **History: tool logs no longer fold into reasoning callout**                                           | #1084                               | agent-mode.md (reasoning)                 | `[NEW]` parser invariant, unit-tested                                   |
| **RAG rename "Reindex All" → "Rescan Vault"**                                                          | #1056                               | semantic-search.md                        | `[NEW]` button label                                                    |
| **Command IDs drop plugin-id prefix**                                                                  | #1132                               | —                                         | `[NEW]` command palette IDs                                             |
| **error handling on fire-and-forget UI handlers**                                                      | #1137                               | —                                         | refactor, unit-covered                                                  |

Large swath of the diff is ESLint-rule enforcement refactors (no-floating-promises, no-explicit-any, no-misused-promises, no-deprecated, etc.) and the design-token migration — behavior-preserving, covered by Pass 1 + visual spot-check in Pass 2.

## Documented surfaces (baseline coverage from docs/guide + docs/reference)

- Settings panes: General, Agent config, RAG, Tools, MCP (settings.md, advanced-settings.md)
- Command palette: all `gemini-scribe` commands vs documented labels
- Agent view: chat input, tool list, attachments, Plan Mode toggle
- Scheduler modal + presets (scheduled-tasks.md)
- Background tasks panel (background-tasks.md)
- Catch-up modal (mobile) (scheduled-tasks.md)
- Folder layout: Agent-Sessions/, Background-Tasks/, Prompts/, Skills/, Scheduled-Tasks/
- RAG / semantic search status modals (semantic-search.md)
- Custom prompts, selection prompts, summarization, completions, projects, lifecycle hooks, MCP servers, deep research, agent skills

## Doc-gap candidates

- Command-ID prefix change (#1132) — internal, not user-facing; no doc needed.
- Design system changes are documented in contributing/design-system.md, not user guide (appropriate).
