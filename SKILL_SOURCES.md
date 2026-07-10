# Bundled skill sources

Three of this repo's bundled agent skills are **adaptations** of upstream skills from
[kepano/obsidian-skills](https://github.com/kepano/obsidian-skills). They are re-framed for
this plugin's in-Obsidian function tools (`write_file`, `update_frontmatter`, `read_file`)
rather than the CLI workflow the upstream skills assume, so they are **adaptations, not
verbatim copies** — upstream changes are hand-merged into our framing, never blindly
re-pulled.

This file pins the upstream commit each adapted skill was last reconciled against, so the
release process's [bundled-skill drift check](.claude/guidelines/release.md) can flag upstream
changes to those files since that point. See
[docs/contributing/bundled-skills.md](docs/contributing/bundled-skills.md) for the full
reconcile workflow.

| Adapted skill       | Local path                                          | Upstream repo            | Upstream path                       | Last-reconciled SHA                        | Date       |
| ------------------- | --------------------------------------------------- | ------------------------ | ----------------------------------- | ------------------------------------------ | ---------- |
| `obsidian-markdown` | `prompts/bundled-skills/obsidian-markdown/SKILL.md` | `kepano/obsidian-skills` | `skills/obsidian-markdown/SKILL.md` | `a1dc48e68138490d522c04cbf5822214c6eb1202` | 2026-06-08 |
| `json-canvas`       | `prompts/bundled-skills/json-canvas/SKILL.md`       | `kepano/obsidian-skills` | `skills/json-canvas/SKILL.md`       | `a1dc48e68138490d522c04cbf5822214c6eb1202` | 2026-06-08 |
| `obsidian-bases`    | `prompts/bundled-skills/obsidian-bases/SKILL.md`    | `kepano/obsidian-skills` | `skills/obsidian-bases/SKILL.md`    | `a1dc48e68138490d522c04cbf5822214c6eb1202` | 2026-06-08 |

## Not tracked here

- The `obsidian-cli` skill (`.agents/skills/obsidian-cli/`) tracks the official Obsidian CLI
  directly (`obsidian --help` / help.obsidian.md), **not** kepano — out of scope.
- Every other bundled skill under `prompts/bundled-skills/` is original to this repo and has
  no upstream to reconcile against.

## Reconciling

When the drift check flags upstream commits, follow
[docs/contributing/bundled-skills.md](docs/contributing/bundled-skills.md): read the upstream
diff, **adapt** (don't copy) the change into our function-tool framing, then bump the SHA and
date in the row above. Bumping the SHA without adapting hides real drift, so the two always
move together.
