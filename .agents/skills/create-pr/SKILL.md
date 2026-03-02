---
name: create-pr
description: >-
  Create a pull request for this repository. Enforces the PR template, runs all
  CI checks locally before pushing, and ensures documentation is updated.
  Use this skill whenever preparing code changes for review.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: Specific to the obsidian-gemini repository.
---

# Create a Pull Request

## When to use this skill

Use this skill when:

- You are ready to submit code changes for review
- The user asks you to create a PR, open a PR, or submit changes
- You have finished implementing a feature, fix, or chore

## Pre-flight checks

Before creating a branch or pushing any code, run all of the following checks and fix any failures:

1. **Format**: `npm run format-check` — if it fails, run `npm run format` and stage the changes
2. **Build & type check**: `npm run build` — this runs `tsc -noEmit` then esbuild; fix any type errors
3. **Tests**: `npm test` — all tests must pass with no warnings or unexpected console output

Do NOT skip these steps. Do NOT push code that fails any of these checks.

## Documentation requirements

Every PR that changes user-facing behavior **must** include documentation updates in the same commit or PR:

- **Feature additions**: Update `README.md` and create or update relevant guides in `docs/`
- **Feature changes**: Update all affected documentation files in `docs/`
- **Settings changes**: Update `docs/reference/settings.md` and `docs/reference/advanced-settings.md`
- **Feature removal**: Remove or rewrite documentation for removed features

If the change is purely internal (test cleanup, refactoring with no behavior change, CI/tooling), documentation updates are not required — but check the "Documentation has been updated" box as N/A.

## PR template

This repository has a PR template at `.github/PULL_REQUEST_TEMPLATE.md`. You **must** use it. The PR body must include all of the following sections:

### Summary

A concise description of what the PR does and why. Link to the related issue with `Fixes #<number>` if applicable.

### Changes

A bullet list of key changes.

### Screenshots / Screencast

Required for UI changes. Delete this section only if the change is purely backend/internal.

### Checklist

Complete every item in the checklist. Use `[x]` for items that are done and `[ ]` for items that are not applicable (add a note explaining why):

```markdown
### Required

- [x] I have read and agree to the [Contributing Guidelines](../CONTRIBUTING.md)
- [x] I have read and agree to the [AI Policy](../AI_POLICY.md)
- [x] This PR is linked to an approved issue where the approach was discussed with a maintainer
- [x] All CI checks pass (`npm test`, `npm run build`, `npm run format-check`)
- [x] I have tested this change on Desktop
- [ ] I have verified this change does not break Mobile (or includes appropriate platform guards)
- [x] Documentation has been updated (if applicable)
- [x] I understand that I must address all review comments from CodeRabbit and maintainers, or this PR may be closed

### AI-Generated Code

- [x] This PR includes AI-generated or AI-assisted code
- [x] AI tool(s) used: Claude Code
- [x] I have reviewed and understand all AI-generated code in this PR
```

## Creating the PR

Use `gh pr create` with a HEREDOC for the body to preserve formatting:

```bash
gh pr create --title "type: Short description" --body "$(cat <<'EOF'
## Summary

...

## Changes

- ...

## Checklist

### Required

- [x] ...

### AI-Generated Code

- [x] ...
EOF
)"
```

### Title conventions

- Keep under 70 characters
- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Use imperative mood: "Add feature" not "Added feature"

## After creating the PR

- Return the PR URL to the user
- Monitor for CodeRabbit review comments and address them
