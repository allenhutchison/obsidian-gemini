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

### 1. Update Release Notes (`src/release-notes.json`)

- Add a new entry at the top of the JSON object for the new version
- Include a title, highlights (array of bullet points), and details
- Follow the emoji pattern used in existing releases
- This file is the single source of truth for both the in-app modal and the docs site changelog

### 2. Run Tests and Build

```bash
npm test        # Ensure all tests pass
npm run build   # Verify production build succeeds
```

### 3. Commit Release Notes

```bash
git add src/release-notes.json
git commit -m "Add release notes for version X.Y.Z"
```

### 4. Bump Version (Choose appropriate semantic version)

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

### 5. Create GitHub Release

- Go to https://github.com/allenhutchison/obsidian-gemini/releases
- Click "Draft a new release"
- Select the tag that was just created
- Copy the release notes from `src/release-notes.json`
- Format as markdown (remove emoji if desired, keep bullet points)
- Publish the release

### 6. Verify Release

- Check that the release appears on GitHub
- Verify the tag matches the version
- Test installation in a test vault (if needed)

## Important rules

- Do NOT manually edit version numbers in `package.json`, `manifest.json`, or `versions.json`. Always use the `npm version` commands.
- Always update release notes BEFORE running `npm version`.
- Ensure you're on the master branch and it's up to date before releasing.

## Build system context

- Uses esbuild for fast bundling with TypeScript
- Custom text file loader for `.txt` and `.hbs` templates
- Source maps inline in dev, tree shaking in production
- Generated artifacts (`main.js`, `manifest.json`, `versions.json`) stay in the repo root for Obsidian
