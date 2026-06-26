---
name: release-process
description: >-
  Full release workflow for obsidian-gemini: update release notes, run checks,
  bump version with npm, create a GitHub release, and verify. Use this skill
  when preparing a new plugin release.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: Specific to the obsidian-gemini repository.
---

# Release Process

## When to use this skill

Use this skill when:

- You need to create a new release of the plugin
- The user asks to bump the version, publish, or ship a release
- You need to understand the release workflow or version management

## Release steps

Follow these steps in order to create a new release:

### 1. Gather ALL changes since the last release

**Always build release notes from the complete set of changes since the previous tag — never just the work from the current session.** A release bundles everything merged since the last version, which is usually more than what you were just working on.

```bash
# The previous release tag
LAST=$(gh release list --limit 1 --json tagName --jq '.[0].tagName')
echo "since: $LAST"

# Every commit since then — scan for user-facing work
git log --oneline "$LAST..HEAD"

# Merged PRs since then, grouped — the most reliable source for the notes
git log --oneline "$LAST..HEAD" | grep -iE 'feat|fix' | sed 's/^[0-9a-f]* //'
```

Triage the list: include **user-facing** features and fixes (new settings, tools, UI, behaviors, localization, models); exclude internal-only churn (CI, dev tooling, test-only, auto-dev/skill plumbing, dependency bumps unless notable). When unsure whether something is user-facing, open the PR. A good sanity check: the count of feature bullets should roughly match the number of user-facing `feat:` PRs in the range — if you've only listed the last few things you personally touched, you've missed some.

### 2. Update Release Notes (`src/release-notes.json`)

- Add a new entry at the top of the JSON object for the new version, built from the full change list gathered above
- Include a title, highlights (array of bullet points), and details
- Follow the emoji pattern used in existing releases
- This file is the single source of truth for both the in-app modal and the docs site changelog
- **In-app modal caveat:** the modal shows **only the entry whose key exactly matches the released version** (`getReleaseNotes` returns `notes[version] || null` — it does NOT roll up earlier unseen versions). So the released version's own entry must contain everything you want users to see. If you ship a patch that only corrects a prior version's notes, restate the relevant highlights in the patch entry or users won't see them.

### 3. Update the README "What's New" section (`README.md`)

This is a required, easy-to-forget step:

- Bump the `## What's New in vX.Y.Z` heading to the new version
- Replace the highlight bullets with the new version's highlights (mirror `release-notes.json`)
- Demote the previous version's block to a `**Previous Updates (vX.Y.Z):**` entry
- Keep the README's feature/configuration/localization sections in sync if the release changed them

### 4. Run Tests and Build

```bash
npm test        # Ensure all tests pass
npm run build   # Verify production build succeeds
```

### 5. Commit Release Notes

```bash
git add src/release-notes.json README.md
git commit -m "Add release notes for version X.Y.Z"
```

### 6. Bump Version (Choose appropriate semantic version)

```bash
npm version patch  # Bug fixes (4.1.0 -> 4.1.1)
npm version minor  # New features (4.1.0 -> 4.2.0)
npm version major  # Breaking changes (4.1.0 -> 5.0.0)
```

The `npm version` command automatically:

- Updates `package.json` version
- Runs `version-bump.mjs` to update `manifest.json` and `versions.json`
- Creates a git commit with the version change
- Creates a git tag (e.g., `4.1.1`)
- Pushes the commit and tag to GitHub (via `postversion` script)

### 7. Update GitHub Release

A GitHub Actions runner automatically creates a draft release when a tag is pushed. After the tag is pushed:

- Go to https://github.com/allenhutchison/obsidian-gemini/releases
- Find the auto-generated release for the new tag
- Update the release notes body with content from `src/release-notes.json`, formatted as Markdown
- **The release NAME must contain the exact `manifest.json` version (`X.Y.Z`, e.g. `4.10.0` — not `4.10`).** Obsidian's developer dashboard warns if the release name doesn't include the full version string from `manifest.json`. Either give the release `--title` the full `X.Y.Z`, or ensure the `release-notes.json` title you reuse already contains it (titles like "Gemini Scribe 4.10" will trigger the warning — use "Gemini Scribe 4.10.0").
- Mark the release as **"Set as the latest release"**
- Publish the release (if still in draft)

### 8. Verify Release

- Check that the release appears on GitHub and is marked as "Latest"
- Verify the tag matches the version
- Test installation in a test vault (if needed)

## Important rules

- Do NOT manually edit version numbers in `package.json`, `manifest.json`, or `versions.json`. Always use the `npm version` commands.
- Always update release notes BEFORE running `npm version`.
- Build the notes from ALL changes since the previous tag (Step 1), not just the current session's work.
- Update the README "What's New" section as part of every release (Step 3).
- The GitHub release **name must include the full `X.Y.Z` version** from `manifest.json`, or Obsidian's developer dashboard warns (Step 7).
- Ensure you're on the master branch and it's up to date before releasing.

## Build system context

- Uses esbuild for fast bundling with TypeScript
- Custom text file loader for `.txt` and `.hbs` templates
- Source maps inline in dev, tree shaking in production
- Generated artifacts (`main.js`, `manifest.json`, `versions.json`) stay in the repo root for Obsidian
