# Repository Guidelines

## Project Overview

Obsidian Gemini Scribe is an Obsidian plugin that integrates Google's Gemini AI models for AI-driven assistance within Obsidian. It provides context-aware chat, document summarization, text rewriting, and IDE-style completions.

## Project Structure & Module Organization

- `src/` contains TypeScript plugin code; `src/main.ts` is the entry point with domain folders such as `agent/`, `api/`, `tools/`, `ui/`, and `services/`, plus shared utilities in `utils/`.
- `docs/` hosts user and operator guides; `prompts/` ships default agent prompts; `test-scripts/` holds manual integration runners.
- Unit tests live in the `test/` directory mirroring `src/` structure as `*.test.ts`; generated artifacts (`main.js`, `manifest.json`, `styles.css`) stay in the repo root for Obsidian.

## Commands

### Development

```bash
npm install          # Install dependencies
npm run dev          # Development build with watch mode
npm run build        # Production build (runs TypeScript check first)
npm test             # Run Jest tests
npm run format       # Format code with Prettier
npm run format-check # Check formatting without changes
```

**IMPORTANT**: Always run `npm install` first if you encounter TypeScript errors or missing module errors during build. The build requires all dependencies in `node_modules` to be present. If you get errors about missing modules like `obsidian`, `@google/genai`, `handlebars`, or `tslib`, run `npm install` before attempting `npm run build` again.

### Testing

- Run single test: `npm test -- path/to/test.ts`
- Manual integration: `node test-scripts/test-sdk-tools.mjs` (and siblings) validate agent toolchains before shipping

### Versioning & Releases

#### Release Process

Follow these steps to create a new release:

1. **Update Release Notes** (`src/release-notes.json`)
   - Add a new entry at the top of the JSON object for the new version
   - Include a title, highlights (array of bullet points), and details
   - Follow the emoji pattern used in existing releases
   - This file is the single source of truth for both the in-app modal and the docs site changelog

2. **Run Tests and Build**

   ```bash
   npm test        # Ensure all tests pass
   npm run build   # Verify production build succeeds
   ```

3. **Commit Release Notes**

   ```bash
   git add src/release-notes.json
   git commit -m "Add release notes for version X.Y.Z"
   ```

4. **Bump Version** (Choose appropriate semantic version)

   ```bash
   npm version patch  # Bug fixes (4.1.0 → 4.1.1)
   npm version minor  # New features (4.1.0 → 4.2.0)
   npm version major  # Breaking changes (4.1.0 → 5.0.0)
   ```

   The `npm version` command automatically:
   - Updates `package.json` version
   - Runs `version-bump.mjs` to update `manifest.json` and `versions.json`
   - Creates a git commit with the version change
   - Creates a git tag (e.g., `4.1.1`)
   - Pushes the commit and tag to GitHub (via `postversion` script)

5. **Create GitHub Release**
   - Go to https://github.com/allenhutchison/obsidian-gemini/releases
   - Click "Draft a new release"
   - Select the tag that was just created
   - Copy the release notes from `src/release-notes.json`
   - Format as markdown (remove emoji if desired, keep bullet points)
   - Publish the release

6. **Verify Release**
   - Check that the release appears on GitHub
   - Verify the tag matches the version
   - Test installation in a test vault (if needed)

**IMPORTANT**:

- Do NOT manually edit version numbers in `package.json`, `manifest.json`, or `versions.json`. Always use the npm version commands.
- Always update release notes BEFORE running `npm version`
- Ensure you're on the master branch and it's up to date before releasing

### Build System

- Uses esbuild for fast bundling with TypeScript
- Custom text file loader for `.txt` and `.hbs` templates
- Source maps inline in dev, tree shaking in production
- Generated artifacts (`main.js`, `manifest.json`, `versions.json`) stay in the repo root for Obsidian

## Architecture

### Core Pattern: Factory + Decorator

```
src/main.ts → GeminiClientFactory.createFromPlugin() → GeminiClient → RetryDecorator → ModelApi
```

The plugin uses a simplified factory pattern (`GeminiClientFactory`) to create Gemini API clients, wrapped with a retry decorator (`RetryDecorator`) for resilience. All API implementations follow the `ModelApi` interface. The factory supports different use cases (chat, summary, completions, rewrite) and provides retry logic with exponential backoff for handling transient API failures.

### Key Components

1. **API Layer** (`src/api/`): Factory pattern (`GeminiClientFactory`) for creating Google Gemini clients, decorator pattern (`RetryDecorator`) for resilience, and interface abstraction (`ModelApi`) for consistent API interactions
2. **Feature Modules**: Separate modules for chat, completions (`completions.ts`), summary (`summary.ts`), and rewrite (`rewrite.ts`)
3. **Context System** (`src/files/file-context.ts`): Builds linked note trees for context-aware AI interactions
4. **History** (`src/history/`): Markdown-based conversation history with Handlebars templates, stored in `[state-folder]/History/`
5. **Custom Prompts** (`src/prompts/`): User-defined prompt templates stored in `[state-folder]/Prompts/`
6. **Agent Mode** (`src/agent/`, `src/tools/`): AI agent with tool calling capabilities
   - Session management with persistent history
   - Tool registry and execution engine
   - Vault operations tools with permission system
   - Google Search integration (separate from function calling)
   - Web fetch tool using Google's URL Context API
   - Session-level permission system for bypassing confirmations
   - Tool loop detection to prevent infinite execution cycles
   - Agent skills system for extensible AI capabilities (see below)
7. **Attachment Pipeline** (`src/ui/agent-view/agent-view.ts`, `src/ui/agent-view/agent-view-ui.ts`, `src/ui/agent-view/inline-attachment.ts`, `src/utils/file-classification.ts`): Unified drag-and-drop and paste pipeline for file attachments
   - Files dropped or pasted into the agent view are classified by extension using `classifyFile()` from `file-classification.ts`
   - **Text files** (`.md`, `.ts`, `.json`, etc.) → context chips (AI reads content)
   - **Gemini-supported binary files** (images, audio, video, PDF) → base64 inline attachments sent to the model via `inlineAttachments` on `ExtendedModelRequest`
   - **Unsupported files** (`.zip`, `.exe`, etc.) → user notification
   - Cumulative 20 MB size limit enforced across vault drops, external drops, and paste
   - Folder drops recursively expand and classify all contained files
   - `InlineAttachment` (renamed from `ImageAttachment`) holds base64 data, MIME type, and optional vault path
   - Image attachments show thumbnails; non-image attachments show Lucide icon + filename label

### Model Configuration

- Models defined in `src/models.ts` with automatic version migration
- Different models for different tasks (chat, summary, completions, rewrite)
- Settings changes trigger full plugin reload

### Important Patterns

1. **Obsidian API First**: Always use built-in Obsidian API functions when available instead of low-level operations:
   - Use `vault.getMarkdownFiles()` instead of `vault.adapter.list()`
   - Use `app.fileManager.processFrontMatter()` for frontmatter manipulation
   - Use `vault.getAbstractFileByPath()` for file operations
   - Use `app.metadataCache` for file metadata access
   - Use `app.fileManager.renameFile()` for renaming files (preserves metadata)
   - Use `app.workspace.openLinkText()` for clickable file links in views
2. **File Operations**: Always use Obsidian's normalized paths and metadata cache
3. **Error Handling**: API calls wrapped with retry logic and exponential backoff
4. **Prompts**: Handlebars templates in `prompts/` directory, loaded as text files
5. **Debouncing**: Completions use 750ms debounce to prevent excessive API calls
6. **State Management**: Plugin instance holds all component references with proper cleanup
7. **Folder Structure**: Plugin uses structured state folder:
   - `[state-folder]/` - Main plugin state folder (default: `gemini-scribe`)
   - `[state-folder]/History/` - Chat history files
   - `[state-folder]/Prompts/` - Custom prompt templates
   - `[state-folder]/Agent-Sessions/` - Agent mode session files
   - `[state-folder]/skills/` - Agent skill packages (agentskills.io format)
   - Automatic migration for existing users from flat structure
8. **System Folder Protection**: Always exclude system folders from file operations:
   - The plugin state folder (`settings.historyFolder`)
   - The `.obsidian` configuration folder
   - Use exclusion checks in all vault operation tools
9. **Tool Execution Order**: When AI needs to perform multiple operations:
   - Always prioritize read operations before destructive operations
   - Sort tool calls to execute reads before writes/deletes
   - Prevents race conditions where files are deleted before being read
10. **Loop Detection**: Tool execution includes loop detection to prevent infinite cycles:

- Tracks identical tool calls within time windows
- Configurable thresholds and time windows
- Session-specific tracking with automatic cleanup

11. **YAML Frontmatter**: Agent instructions include guidance for respecting YAML frontmatter when modifying files

- The AI is trained to place "top of note" content after frontmatter blocks (defined in `prompts/agentToolsPrompt.txt`)
- YAML frontmatter must start with `---` on line 1 and end with `---`
- Content is only placed before frontmatter when explicitly instructed to modify frontmatter

12. **Agent Skills** (`src/services/skill-manager.ts`, `src/tools/skill-tools.ts`): Extensible skill system following the [agentskills.io](https://agentskills.io) specification

- Skills are self-contained packages stored in `[state-folder]/skills/<skill-name>/SKILL.md`
- `SkillManager` handles discovery, metadata parsing, content loading, resource reading, creation, and name validation
- Uses progressive disclosure: skill summaries (name + description) are injected into the agent system prompt; full instructions are loaded on-demand via `activate_skill`
- Two tools: `activate_skill` (read-only, loads instructions or resources) and `create_skill` (creates new skill directories with valid SKILL.md)
- Skill names must be lowercase alphanumeric with hyphens, 1-64 chars, no consecutive/leading/trailing hyphens
- Frontmatter parsing uses Obsidian's native `metadataCache` API
- `scripts/` directories are treated as read-only reference material (no execution in Obsidian)

## Coding Style & Naming Conventions

- TypeScript-first codebase; group modules by domain and add barrel exports only when they simplify imports.
- Format with Prettier (`npm run format`): 2-space indent, 120-column width, semicolons, single quotes, trailing commas.
- `.editorconfig` enforces LF endings and tabbed Markdown/config; avoid hand-editing generated bundles.
- Use camelCase for variables/functions, PascalCase for classes/types, and kebab-case filenames aligned with their feature area.
- Handle TypeScript errors properly - ensure all properties are correctly typed
- Use proper async/await patterns for all asynchronous operations

### Console Logging

The plugin uses a dedicated Logger service (`src/utils/logger.ts`) that respects the debug mode setting. This approach avoids global console patching, preventing conflicts with other plugins and Obsidian's debugging tools.

**Accessing the Logger:**

- Plugin components: `this.plugin.logger`
- Tool implementations: `context.plugin.logger` (via ToolExecutionContext)
- Utility functions: Accept logger as parameter

**Logger Methods:**

- **`logger.log()` and `logger.debug()`**: Only output when debug mode is enabled
  - Automatically filtered based on settings.debugMode
  - Prefixed with `[Gemini Scribe]` for easy identification

- **`logger.error()` and `logger.warn()`**: Always visible regardless of debug mode
  - Use for important errors and warnings that users should always see
  - Critical failures, API errors, and data integrity issues

**Best Practices:**

- Use `logger.log()` for debug information that helps development and troubleshooting
- Use `logger.error()` for errors that indicate something went wrong
- Use `logger.warn()` for warnings about deprecated features or potential issues
- Never use native `console.log()` or `console.debug()` directly
- Pass logger instance to utility functions that need logging

**Examples:**

```typescript
// ✅ Good - in plugin components
this.plugin.logger.log('Processing file:', file.path);
this.plugin.logger.debug('Tool execution context:', context);

// ✅ Good - in tool implementations
async execute(params: any, context: ToolExecutionContext) {
    const plugin = context.plugin;
    plugin.logger.log('Executing tool with params:', params);
}

// ✅ Good - in utility functions
export function processData(logger: Logger, data: any) {
    logger.log('Processing data:', data);
}

// ✅ Good - always visible for critical issues
this.plugin.logger.error('Failed to load API key:', error);
this.plugin.logger.warn('Model deprecated, using fallback');

// ❌ Bad - using console directly
console.log('Debug message');

// ❌ Bad - manual debug mode checks (logger handles this)
if (this.plugin.settings.debugMode) {
    this.plugin.logger.log('Debug message');
}
```

## Testing Guidelines

- Jest with ts-jest for TypeScript support
- JSDOM environment for DOM testing
- Test pattern: `**/?(*.)+(spec|test).[tj]s`
- Keep unit tests next to implementations and name them after the unit (`models.test.ts`, `main.test.ts`)
- Assert observable behavior of prompts, services, and tool orchestration; add regression coverage for bugs
- Extend shared fixtures under `__mocks__/` when mocking new APIs
- Run `npm test` before each PR and execute relevant `test-scripts/*.mjs` after touching agent or tool code

### Testing Focus

When adding features, ensure tests cover:

- Core utility functions
- API error scenarios with retry behavior
- File context tree building and circular reference prevention
- Prompt generation with proper template rendering

## Development Practices

### Documentation Maintenance

**🚨 CRITICAL - DOCUMENTATION IS MANDATORY 🚨**

Documentation updates are **REQUIRED**, not optional. Every code change MUST include corresponding documentation updates in the same PR/commit.

**When making ANY change:**

1. **Feature Addition**:
   - Update README.md with new feature description
   - Create or update relevant user guides in `docs/`
   - Add examples and use cases
   - Update table of contents and navigation

2. **Feature Updates**:
   - Modify ALL affected documentation files
   - Update code examples to reflect changes
   - Revise screenshots or diagrams if needed

3. **Feature Removal**:
   - Remove or rewrite documentation for removed features
   - Delete archived docs (users auto-update, no need for old docs)
   - Update migration guides if needed

4. **API/Settings Changes**:
   - Update settings-reference.md
   - Update code examples in guides
   - Document breaking changes clearly

**Documentation Review Checklist:**

- [ ] README.md updated if user-facing change
- [ ] Relevant guides in `docs/` updated
- [ ] Code examples tested and current
- [ ] Settings documentation matches actual defaults
- [ ] No references to removed features
- [ ] Internal doc links not broken

**Remember**: Outdated documentation is worse than no documentation. If you change code, you MUST update docs.

### Implementation Planning

When planning new features:

1. **Create detailed implementation plans** for significant features
2. **Include plans directly in GitHub issues** rather than separate files
3. **Structure plans with**:
   - Architecture overview
   - Core components with code examples
   - Integration points
   - Testing strategy (unit and integration tests)
   - Migration considerations
   - Timeline estimates

Example: See issue #90 for the custom prompt system implementation plan.

This keeps technical planning centralized and accessible for all contributors.

## Commit & Pull Request Guidelines

- Write concise, imperative commit subjects (`Fix agent session cleanup`, `Improve prompt builder`); reference issues/PRs with `#123`
- Commit generated artifacts (`main.js`, `manifest.json`, `versions.json`) alongside source changes; use `npm run version` for releases
- **MANDATORY**: Include documentation updates in the same PR/commit as code changes (see Documentation Maintenance section)
- PRs should explain motivation, highlight user-visible impact, list automated/manual tests, and attach screenshots or vault clips for UI tweaks
- Flag reviewers who own the affected area and mention required follow-up or rollout notes
- PR descriptions should explicitly list which documentation files were updated

## UI/UX Best Practices

1. **Modal Sizing**: Use `:has()` selector to target parent containers for proper width constraints
2. **Text Overflow**: Always handle long text with `text-overflow: ellipsis` and proper flex constraints
3. **Message Formatting**: Convert single newlines to double newlines for proper Markdown rendering
4. **Collapsible UI**: Use compact views by default with expandable details for complex information
5. **Animations**: Add subtle transitions and animations for professional feel
6. **Icon Usage**: Use Obsidian's built-in Lucide icons via `setIcon()` for consistency
7. **File Chips**: When implementing @ mentions or file references:
   - Use contenteditable divs with proper event handling
   - Convert chips to markdown links when saving to history
   - Position cursor after chip insertion for natural typing flow
8. **Session State**: Maintain clean session boundaries:
   - Clear context files when creating new sessions
   - Reset permissions and state when loading from history
   - Track session-level settings separately from global settings
9. **CSS Containment**: Ensure proper CSS containment to prevent overflow issues
10. **Theme Compatibility**: Use Obsidian's theme CSS variables for consistent styling and test with different Obsidian themes (light/dark)

## Security & Configuration

- Never commit API keys or vault data; keep secrets in local Obsidian configuration
- Document new network calls or permissions in `docs/` when adding features or capabilities
- Always use native Obsidian API calls when possible. Documentation here: https://docs.obsidian.md/Home
