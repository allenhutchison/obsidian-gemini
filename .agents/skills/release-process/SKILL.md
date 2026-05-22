---
name: release-process
description: >-
  The single release workflow for obsidian-gemini, used for both interactive
  (human) and scheduled (agent) runs. Checks whether a release is warranted,
  drafts release notes, bumps the version on a release branch, and opens a
  "Release X.Y.Z" PR; merging that PR tags the commit and builds a draft GitHub
  release. Use this skill whenever preparing a plugin release.
metadata:
  author: obsidian-gemini
  version: '2.0'
compatibility: Specific to the obsidian-gemini repository.
---

# Release Process

## When to use this skill

Use this skill when:

- You need to create a new release of the plugin
- The user asks to bump the version, publish, or ship a release
- A scheduled task runs the weekly release check
- You need to understand the release workflow or version management

This is the **single release process** — the steps are identical whether a
human runs them interactively or a scheduled agent runs them. The only
difference is who reviews and merges the release PR (step 7).

## Release steps

### 1. Check whether a release is warranted (release gate)

List the commits since the last release:

```bash
git fetch --tags origin
git log "$(git describe --tags --abbrev=0)"..HEAD --oneline
```

Categorize them by conventional-commit prefix:

- **Warrants a release:** `feat:`, `fix:`, `perf:` (or a `revert:` of one)
- **Does NOT, on its own:** `chore:`, `docs:`, `test:`, `ci:`, `style:`,
  `refactor:`, `build:`

If there is no `feat:`, `fix:`, or `perf:` commit, **stop** — there is nothing
to ship. A scheduled run must respect this and exit quietly. A human may
override with explicit judgement (e.g. shipping a refactor-only release).

### 2. Pick the version bump

Derive the new `X.Y.Z` from those commits, semver-style:

- **major** — any commit with a `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer
- **minor** — at least one `feat:` and no breaking change
- **patch** — only `fix:` / `perf:` changes

### 3. Draft the release notes (`src/release-notes.json`)

Add a new entry at the **top** of the JSON object, keyed by the new `X.Y.Z`:

- `title` — **must contain the full three-part version** (`X.Y.Z`). Never
  abbreviate a `.0` minor release: write `Gemini Scribe 4.10.0`, not `4.10`.
  The GitHub release name is taken verbatim from this field, and the Obsidian
  community score card requires the full version string in the release name.
- `highlights` — array of short bullet points; follow the emoji pattern of
  existing entries.
- `details` — a paragraph summarizing the release.

This file is the single source of truth for the in-app "what's new" modal, the
docs-site changelog, and the GitHub release title and body. On a scheduled run,
synthesize the entry from that period's `planning/changelog/YYYY-MM-DD.md`
files (produced by the `daily-changelog` skill).

### 4. Create the release branch and bump the version

```bash
git checkout master && git pull origin master
git checkout -b "auto/release-X.Y.Z"
node version-bump.mjs X.Y.Z
```

`node version-bump.mjs X.Y.Z` updates `package.json`, `manifest.json`, and
`versions.json` together, with no git side-effects. Do **not** use
`npm version` — it tags and pushes immediately, which the PR-based flow must
not do.

### 5. Verify

```bash
npm test
npm run build
```

Both must pass. Abort the release if either fails.

### 6. Commit and push the release branch

```bash
git add src/release-notes.json package.json manifest.json versions.json
git commit -m "Release X.Y.Z"
git push -u origin "auto/release-X.Y.Z"
```

### 7. Open the "Release X.Y.Z" PR

Open a pull request from `auto/release-X.Y.Z` into `master`, titled
`Release X.Y.Z`, with the release notes in the body.

- **Human run:** review the diff and merge the PR.
- **Scheduled agent run:** stop here — report the PR link and let a human
  review and merge it. Do not merge it yourself.

The release notes are compiled into the plugin at build time, so the PR is the
checkpoint where they are reviewed **before** they ship.

### 8. Automated tag and draft release (no action needed)

When the `auto/release-*` PR is merged, `.github/workflows/release.yml`
automatically: verifies the release title contains the full version, creates
and pushes the `X.Y.Z` tag, builds the plugin, and creates a **draft** GitHub
release — titled and described from `src/release-notes.json`, with `main.js`,
`manifest.json`, and `styles.css` attached.

### 9. Publish the release

- Open the draft release at https://github.com/allenhutchison/obsidian-gemini/releases
- Confirm the title contains the full `X.Y.Z` and the body reads well
- Mark it **"Set as the latest release"** and publish

## Important rules

- The GitHub release **title** must contain the full `X.Y.Z` version string
  (Obsidian community score-card requirement). Never abbreviate `X.Y.0` as `X.Y`.
- Do NOT hand-edit version numbers in `package.json`, `manifest.json`, or
  `versions.json` — always use `node version-bump.mjs X.Y.Z`.
- Do NOT use `npm version` for releases; it tags and pushes immediately.
- Every release goes through an `auto/release-*` PR — there is no
  direct-to-`master` release path.
- Always branch from an up-to-date `master`.

## Build system context

- Uses esbuild for fast bundling with TypeScript
- Custom text file loader for `.txt` and `.hbs` templates
- Source maps inline in dev, tree shaking in production
- Generated artifacts (`main.js`, `manifest.json`, `versions.json`) stay in the
  repo root for Obsidian

## Manual release escape hatch

If the PR flow is unavailable, a release can be triggered manually: bump the
version on `master` with `node version-bump.mjs X.Y.Z` (with a matching
`src/release-notes.json` entry), then run the **Release Obsidian Gemini plugin**
workflow via _workflow_dispatch_, supplying the version. It performs the same
tag + build + draft-release steps.
