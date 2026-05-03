# Plugin acceptance test — scope

- **Date:** 2026-05-03
- **Plugin version:** 4.7.0 (manifest)
- **Last release tag:** 4.7.0 (2026-04-07)
- **Vault:** Test Vault
- **Branch:** master, 91 commits since v4.7.0

## Sources of truth

- `docs/guide/*.md` (17 user guides)
- `docs/reference/{settings,advanced-settings,loop-detection}.md`
- `README.md`, `AGENTS.md`
- `src/release-notes.json`
- `planning/changelog/2026-04-25.md` … `2026-05-02.md` (8 daily rollups)

**No prior plugin-test report exists** under `planning/test-reports/` — this is the first run, so no test-count baseline to compare against.

## Major shipping since v4.7.0 (NEW since release)

| Area                     | PRs                                            | Surfaces touched                                                                                 |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Scheduled tasks engine   | #650, #682, #695, #696, #697                   | core engine, runner, manager init                                                                |
| Scheduled tasks UI       | #701, #674                                     | Open Scheduler, View Scheduled Tasks, scheduler-management modal                                 |
| Scheduled tasks catch-up | #700, #723, #735                               | catch-up modal, mobile auto-open                                                                 |
| Scheduled tasks formats  | #741                                           | `daily@HH:MM`, `weekly@day,day@HH:MM`, custom interval                                           |
| Scheduled tasks fix      | #738                                           | skills in default tool allowlist                                                                 |
| Background tasks infra   | #637, #651, #724, #737                         | BackgroundTaskManager, status bar entry, modal, `[state-folder]/Background-Tasks/` consolidation |
| Background tasks UI      | #674                                           | unified activity modal (Background Tasks + RAG tabs)                                             |
| Image generation         | #666, #739                                     | palette flow → background, agent-tool background mode, pre-resolved output_path                  |
| Ollama provider          | #694                                           | new provider, settings, models list                                                              |
| Models list              | #595, #596, #608, #609, #1626                  | curated `models.json`, weekly updater action                                                     |
| Selection prompts        | #628                                           | dynamic selection prompt UI                                                                      |
| Settings refactor        | #593                                           | modular settings tabs (general/tools/rag/mcp/api)                                                |
| Vault tools refactor     | #592                                           | per-tool files in `src/tools/vault/`                                                             |
| RAG indexing refactor    | #590                                           | composition pattern, sync queue, vault scanner                                                   |
| AgentLoop extraction     | #665, #672                                     | headless reuse, required confirmationProvider                                                    |
| Loop detection           | #675                                           | per-turn abort threshold                                                                         |
| Cached-token metrics     | #624, #625                                     | UI surfacing in token counter                                                                    |
| Skill picker             | #577, #580                                     | slash command, bundled skills                                                                    |
| Session list             | #578, #583                                     | project filter, lightweight metadata query                                                       |
| Mobile fixes             | #671, #723                                     | iOS layout, mobile catch-up modal                                                                |
| Logging                  | #465, #584                                     | file-based logger                                                                                |
| Eval harness             | #676, #682, #683, #684, #686, #691, #692, #693 | not user-facing; verify build only                                                               |

## Test surfaces (Pass 2)

### Settings UI

- General tab — provider, name, state folder, history toggle, summary key
- Model Configuration — chat / summary / completions / image
- Custom Prompts — allow override, creation flow
- UI Settings — streaming, **auto-run missed scheduled tasks on startup** (NEW)
- Context Management — compaction threshold, token usage, tool log, diff view
- Developer — debug mode, file logging, retry config, temperature/topP, model discovery
- Tool Execution — stop on tool error, **loop detection** (turn abort NEW)
- MCP Servers — enable + server list
- RAG, Tools, MCP modular tabs (NEW after #593)

### Command palette (22 commands)

All `gemini-scribe-*` commands in `src/main.ts`, `src/summary.ts`, `src/completions.ts`, `src/prompts/prompt-manager.ts`. Verify each exists with the documented label.

### Views & modals

- Agent view — chat input, attachment shelf, project badge
- Session list modal (project filter NEW)
- Background tasks modal / unified activity modal (NEW)
- Catch-up modal (NEW; mobile auto-open NEW)
- Scheduler management modal (NEW)
- Skill picker modal (NEW)
- Generate Image modal

### Folder layout

After plugin load: `[state-folder]/{Agent-Sessions,Background-Tasks,Prompts,Skills,Scheduled-Tasks,Scheduled-Tasks/Runs,History}` (legacy History optional).

### State injection (no API)

- Plant a fake overdue scheduled task → reload → catch-up badge/modal appears
- Verify scheduler modal preset switching shows/hides time pickers and weekday checkboxes
- Mobile emulation pass on Settings, Agent view, Scheduler

## Pass 3 candidates (await user authorization)

- **Foreground chat round-trip** — one-shot prompt via agent view (~$0.001)
- **Image generation, palette flow** — verify Notice + cursor wikilink (~$0.04)
- **Image generation, agent-tool background** — verify `{taskId, output_path}` synchronous return + file lands (~$0.04)
- **Deep research, background mode** — small topic, verify report file (~$0.05)
- **Scheduled task `runNow`** — transient `daily@<+5min>` task, verify run output + state update (~$0.02)

Estimated Pass 3 cost: **$0.10–$0.20** (single image at ~$0.04 dominates).

## Doc gaps surfaced (carried into final report)

To be filled after Phase 0 cross-check finishes; flagged at end of Pass 2.
