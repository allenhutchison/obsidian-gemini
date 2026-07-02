# Reconciling Bundled Skills with Upstream

Three of the plugin's bundled agent skills are **adaptations** of upstream skills from
[kepano/obsidian-skills](https://github.com/kepano/obsidian-skills):

- `prompts/bundled-skills/obsidian-markdown/SKILL.md`
- `prompts/bundled-skills/json-canvas/SKILL.md`
- `prompts/bundled-skills/obsidian-bases/SKILL.md`

They are re-framed for this plugin's in-Obsidian **function tools** (`write_file`,
`update_frontmatter`, `read_file`) instead of the CLI workflow the upstream skills assume.
Because they are adaptations rather than verbatim copies, we can't blindly re-pull upstream
when kepano changes the underlying format guidance (Bases syntax, the JSON Canvas spec,
Obsidian Flavored Markdown). Instead we **track drift and hand-merge**.

## The pinned baseline

[`SKILL_SOURCES.md`](../../SKILL_SOURCES.md) (repo root) records, per adapted skill, the
upstream path and the commit SHA it was last reconciled against. That SHA is the baseline the
drift check compares against — it is the single source of truth for "how current are our
adaptations."

## How drift is surfaced

The [`daily-update`](../../.agents/skills/daily-update/SKILL.md) skill runs a **report-only**
bundled skill drift check on each scheduled run. For each adapted skill it lists the upstream
commits that touched that file since the pinned SHA and, if any exist, surfaces the diff in
the run report so a human can decide whether it's worth reconciling. The check never edits a
`SKILL.md` and never bumps the pinned SHA — flagging drift is automated, adapting it is not.

## Reconcile workflow

When the drift check flags an upstream change:

1. **daily-update reports the drift** — the run report names which adapted skill has upstream
   commits ahead of its pinned SHA and links the upstream diff.
2. **Read the upstream diff** — understand what changed in the format guidance. Not every
   upstream commit is relevant; a wording tweak on a section we don't mirror may need no
   action beyond bumping the SHA.
3. **Adapt, don't copy** — re-frame the meaningful change for our function-tool framing
   (`write_file` / `update_frontmatter` / `read_file`), matching the voice and structure of
   the existing adapted skill. Never paste the upstream CLI-oriented text verbatim.
4. **Bump the SHA and date** — update the skill's row in `SKILL_SOURCES.md` to the upstream
   commit you reconciled against and today's date. Do this in the **same** PR as the
   adaptation so the pin never claims currency the content doesn't have.

## Out of scope

- **Automated merging** of upstream changes — reconciliation is always a human adaptation.
- **Non-`SKILL.md` upstream files** — only the three `SKILL.md` files above are tracked.
- **The `obsidian-cli` skill** — it tracks the official Obsidian CLI, not kepano, and is
  reconciled through its own mechanism.
