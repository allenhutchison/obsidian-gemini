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
- Generated artifacts `manifest.json` and `versions.json` stay committed at the repo root; `main.js` is a
  gitignored build output, attached to the GitHub release by the release workflow.

## 🚨 Live transport smoke gate — run LAST, in a real vault

`npm test` and `npm run build` **cannot** see renderer-side CORS failures. After **every** code and
dependency change is final — as the **last** pre-bump step — run the live transport smoke test in
the test vault with the current settings, with Chat, Summaries, and Web search routed to Gemini:

1. Summarize a note (non-streaming Interactions request).
2. Send an agent chat message that streams (the response `content-type` is `text/event-stream`).
3. Ask the agent to use `google_search` and answer with a citation. That exercises a grounded
   `generateContent` call plus a streamed tool follow-up, which carries the thought signature.

Confirm no console errors (`obsidian dev:errors`) and real model output for each.

- **The Interactions API is always on** for Gemini conversational calls since #1508 — there is no
  toggle to flip. Image generation still uses `generateContent`.
- **If `@google/genai` changed at all — even a semver-minor or -patch bump — this gate is
  MANDATORY.** Interactions requests go through the renderer's global `fetch` (#1256 removed the
  `requestUrl` shim once the SDK stopped sending the `Api-Revision` header that triggered a CORS
  preflight). A new SDK version that reintroduces a non-simple request header would fail only in the
  renderer — the class of break that shipped in 4.10.1 (#1044). Instrument `window.fetch` to log
  each `generativelanguage.googleapis.com` request's status and `content-type`, and confirm every
  one returns 200 with no `Failed to fetch` / CORS error.
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
