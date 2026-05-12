# Contributing to Gemini Scribe

Thank you for your interest in contributing to Gemini Scribe! This document outlines the process and expectations for contributions.

## Before You Start

**All contributions must begin with an issue.** Do not open a pull request without prior discussion and approval.

1. **Open an issue** (or comment on an existing one) describing the bug, feature, or improvement.
2. **Wait for maintainer approval** of the proposed approach before writing code.
3. Only after the approach is agreed upon should you begin implementation.

Unsolicited PRs that have not been discussed in an issue may be closed without review. This keeps the project aligned with its roadmap and prevents wasted effort on both sides.

## Development Setup

```bash
git clone https://github.com/allenhutchison/obsidian-gemini.git
cd obsidian-gemini
npm install
npm run dev    # Development build with watch mode
```

### Available Commands

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm install`          | Install dependencies                     |
| `npm run dev`          | Development build with watch mode        |
| `npm run build`        | Production build (runs TypeScript check) |
| `npm test`             | Run Jest tests                           |
| `npm run format`       | Format code with Prettier                |
| `npm run format-check` | Check formatting without changes         |

## Pull Request Requirements

### 1. Issue First

Every PR must reference an approved issue. Include `Fixes #123` or `Closes #123` in your PR description.

### 2. CI Must Pass

Before requesting a review, ensure **all CI checks are green**. Run these locally before pushing:

```bash
npm run format-check   # Prettier formatting
npm run build          # TypeScript type checking + production build
npm test               # Jest test suite
```

PRs with failing CI will not be reviewed. Fix the failures first.

### 3. Proof of Functionality

For any PR that affects the UI or user-facing behavior:

- Include a **screenshot or short screencast** demonstrating the feature working in Obsidian.
- Show both the happy path and any relevant edge cases.

This is not required for purely backend or internal changes (test additions, refactors with no UI impact, etc.), but when in doubt, include a screenshot.

### 4. Platform Compatibility

Gemini Scribe runs on **both Desktop and Mobile** (iOS/Android via Obsidian Mobile). All changes must:

- Work on both platforms, or
- Include appropriate platform guards to prevent crashes on unsupported platforms.

Do not use Node.js-specific APIs, browser-only APIs, or desktop-only Electron APIs without checking platform availability first. Test on mobile if your change touches UI or file system operations.

### 5. Use the Obsidian API

This project follows an **Obsidian API First** principle. The `obsidian` package provides a rich set of utilities — use them instead of rolling your own:

- **File operations**: `vault.getMarkdownFiles()`, `vault.getAbstractFileByPath()`, `app.metadataCache`
- **Fuzzy search**: `FuzzySuggestModal`, `SuggestModal`, `prepareFuzzySearch()`, `prepareSimpleSearch()`
- **UI components**: `Modal`, `Setting`, `setIcon()`, `AbstractInputSuggest`
- **File management**: `app.fileManager.processFrontMatter()`, `app.fileManager.renameFile()`

PRs that duplicate functionality already provided by the Obsidian API will be asked to refactor. See the [Obsidian Developer Docs](https://docs.obsidian.md/Home) for the full API surface.

### 6. Documentation

Documentation updates are **required** with code changes. In the same PR:

- Update `README.md` if the change is user-facing.
- Update or create relevant guides in `docs/`.
- Ensure no broken internal links or references to removed features.

### 7. Code Review

This project uses [CodeRabbit](https://coderabbit.ai/) for automated code review in addition to maintainer review. Contributors are expected to:

- **Address all review comments** from both CodeRabbit and maintainers.
- Respond to feedback with code changes or an explanation of why the current approach is correct.
- PRs with unaddressed review comments that go stale may be closed without further notice.

### 8. Tests

- Add or update tests for new functionality.
- Tests live in the `test/` directory, mirroring the `src/` structure.
- Run `npm test` and ensure all tests pass before pushing.

For detailed instructions on testing your changes on desktop and mobile, including symlink setup, smoke test checklists, and CI checks, see the [Testing Guide](docs/contributing/testing.md).

## Coding Standards

- **TypeScript** — all source code is TypeScript.
- **Prettier** — 2-space indent, 120-column width, semicolons, single quotes, trailing commas. Run `npm run format` before committing.
- **Naming** — `camelCase` for variables/functions, `PascalCase` for classes/types, `kebab-case` for filenames.
- **Logging** — use the Logger service (`this.plugin.logger`), never `console.log()` directly. CI enforces this.
- **Async** — use proper `async/await` patterns for all asynchronous operations.

See `AGENTS.md` for detailed architecture and coding guidelines.

## Commit Messages

Write concise, imperative commit subjects:

- `Fix agent session cleanup on mobile`
- `Add fuzzy search to file picker modal`
- `Update context system documentation`

Reference issues with `#123` where applicable.

## What Makes a Good Contribution

- **Focused** — one logical change per PR. Don't bundle unrelated fixes.
- **Minimal** — solve the problem with the least amount of new code. Leverage existing patterns and APIs.
- **Tested** — includes tests and has been manually verified in a vault.
- **Documented** — docs are updated alongside code.
- **Compatible** — works on both Desktop and Mobile.

## Code of Conduct

Be respectful and constructive in all interactions. We're all here to make a good plugin better.

## Questions?

If you're unsure about whether a contribution would be welcome or how to approach something, open an issue to discuss it first. We're happy to help point you in the right direction.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
