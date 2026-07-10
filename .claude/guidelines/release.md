# Release gates & caveats — Gemini Scribe

Repo-specific release rules the `release` skill must honor, beyond the scalars in
`.claude/maintainerd.json` (`release.versionCommand`, `notesFile`, `readmeSection`, …). This is an
Obsidian community plugin, so the gates below are non-obvious and load-bearing.

## Order of operations

1. **Build release notes from ALL changes since the previous tag** — never just the current
   session's work. A release bundles everything merged since the last version. Get the baseline
   with `gh release list --limit 1` and scan every commit/merged PR since.
2. **Update `src/release-notes.json`** (the notes file) **and** the README "What's New" section
   **before** bumping the version.
   - README: bump the `## What's New in vX.Y.Z` heading, replace the highlight bullets (mirroring
     `release-notes.json`), and demote the prior version to a `**Previous Updates (vX.Y.Z):**` block.
3. Commit the notes, **then** run the version bump.

## Bundled-skill upstream drift check (report-only)

Three bundled skills — `obsidian-markdown`, `json-canvas`, `obsidian-bases` (under
`prompts/bundled-skills/`) — are **adaptations** of upstream skills from
[kepano/obsidian-skills](https://github.com/kepano/obsidian-skills), re-framed for this plugin's
function tools. As a release-prep step, check whether upstream has moved ahead of the SHAs pinned
in `SKILL_SOURCES.md` so you can reconcile before shipping. **This lives in the release flow, not
the unattended daily runner** — it needs `gh` access to the `kepano/obsidian-skills` repo, which the
cloud daily runner doesn't have. It is **report-only**: never edits a `SKILL.md` or bumps a pin.

For each row in `SKILL_SOURCES.md`, read the pinned SHA + upstream path, then find the newest
upstream commit that touched that path:

```bash
gh api "repos/kepano/obsidian-skills/commits?path=<upstream-path>&per_page=1&sha=main" --jq '.[0].sha'
```

If the newest SHA differs from the pinned SHA, upstream moved — a **rename or delete counts as drift
too**. Fetch the diff, matching the path as the current filename **or** a `previous_filename`:

```bash
gh api "repos/kepano/obsidian-skills/compare/<pinned-sha>...main" \
  --jq '.files[] | select(.filename=="<upstream-path>" or .previous_filename=="<upstream-path>") | {filename, previous_filename, status, additions, deletions, patch}'
```

Report per adapted skill: `up to date`, or `drift: upstream moved to <short-sha>` with the diff and a
note the adapted `SKILL.md` needs a manual reconcile (`renamed`/`removed` is still drift even with an
empty patch; a differing SHA that matches no file is drift-needing-investigation, never "up to
date"). To reconcile, follow
[docs/contributing/bundled-skills.md](../../docs/contributing/bundled-skills.md): adapt (don't copy)
the change into the function-tool framing, then bump the SHA + date in `SKILL_SOURCES.md` in the same
release. If `gh`/network is unavailable, record it as errored and move on — never guess.

## Version bump — `npm version {level}` only

- `npm version patch|minor|major` is the **only** way to change the version. It updates
  `package.json`, runs `version-bump.mjs` to update `manifest.json` + `versions.json`, creates the
  git tag, and (via the `postversion` script) pushes the commit and tag.
- **Never** hand-edit version numbers in `package.json`, `manifest.json`, or `versions.json`.
- Generated artifacts (`main.js`, `manifest.json`, `versions.json`) stay committed at the repo root.

## 🚨 Live transport smoke gate — run LAST, in a real vault

`npm test` and `npm run build` **cannot** see renderer-side CORS failures. After **every** code and
dependency change is final — as the **last** pre-bump step — run the live transport smoke test in
the test vault with the current settings:

1. Summarize a note (the `generateContent` path).
2. Send an agent chat message that streams.
3. Toggle **Use Interactions API** ON and repeat 1–2, plus a grounded `google_search`.

Confirm no console errors and real model output for each.

- **If `@google/genai` changed at all — even a semver-minor or -patch bump — the Interactions smoke
  test (flag ON) is MANDATORY.** The CORS workaround (`installObsidianFetch` / `obsidian-fetch.ts`)
  reaches into the SDK's next-gen client internals, which minor releases have silently restructured
  before (2.9.0→2.10.0 broke it and shipped in 4.10.1 — see #1044). Instrument `window.fetch` to
  confirm Interactions requests route through `requestUrl`, not the renderer global `fetch`.
- **Ordering rule:** never bump a dependency _after_ the smoke gate. If you do, you've invalidated
  it — re-run it. (This is exactly how 4.10.1 broke.)

## GitHub release naming

A tag push auto-creates a **draft** release via GitHub Actions. Update its body from
`src/release-notes.json` (formatted as Markdown). **The release NAME must contain the exact full
`manifest.json` version — `X.Y.Z` (e.g. `4.10.0`, not `4.10`)** — or Obsidian's developer dashboard
warns. Either pass `--title` the full `X.Y.Z`, or ensure the reused `release-notes.json` title
already contains it ("Gemini Scribe 4.10" triggers the warning; "Gemini Scribe 4.10.0" is correct).

## Verify

After publishing, confirm the tag matches the `manifest.json` version and the release name carries
the full `X.Y.Z`.
