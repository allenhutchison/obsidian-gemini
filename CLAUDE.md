# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian Gemini Scribe is an Obsidian plugin that integrates Google's Gemini AI models for AI-driven assistance within Obsidian. It provides context-aware chat, document summarization, text rewriting, and IDE-style completions.

## Commands

### Development

```bash
npm run dev          # Development build with watch mode
npm run build        # Production build (runs TypeScript check first)
npm test             # Run Jest tests
npm run format       # Format code with Prettier
npm run format-check # Check formatting without changes
```

### Build System

- Uses esbuild for fast bundling with TypeScript
- Custom text file loader for `.txt` and `.hbs` templates
- Source maps inline in dev, tree shaking in production

### Testing

- Jest with ts-jest for TypeScript support
- JSDOM environment for DOM testing
- Test pattern: `**/?(*.)+(spec|test).[tj]s`
- Run single test: `npm test -- path/to/test.ts`

## Architecture

### Core Pattern: Factory + Decorator

```
main.ts → ApiFactory.createApi() → RetryModelApiDecorator → ModelApi (Gemini/Ollama)
```

The plugin uses a factory pattern for API creation with a retry decorator for resilience. All API implementations follow the `ModelApi` interface.

### Key Components

1. **API Layer** (`src/api/`): Abstracted model interface with implementations for Gemini and Ollama
2. **Feature Modules**: Separate modules for chat, completions (`completions.ts`), summary (`summary.ts`), and rewrite (`rewrite.ts`)
3. **Context System** (`src/files/file-context.ts`): Builds linked note trees for context-aware AI interactions
4. **History** (`src/history/`): Markdown-based conversation history with Handlebars templates

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
2. **File Operations**: Always use Obsidian's normalized paths and metadata cache
3. **Error Handling**: API calls wrapped with retry logic and exponential backoff
4. **Prompts**: Handlebars templates in `prompts/` directory, loaded as text files
5. **Debouncing**: Completions use 750ms debounce to prevent excessive API calls
6. **State Management**: Plugin instance holds all component references with proper cleanup

### Testing Focus

When adding features, ensure tests cover:

- Core utility functions
- API error scenarios with retry behavior
- File context tree building and circular reference prevention
- Prompt generation with proper template rendering

## Development Practices

### Documentation Maintenance

**CRITICAL**: Always keep documentation up to date when making changes:

1. **Feature Addition**: Update README.md, user documentation, and any relevant guides
2. **Feature Updates**: Modify existing documentation to reflect changes
3. **Feature Removal**: Remove or update documentation that no longer applies
4. **API Changes**: Update any code examples or integration guides

Documentation should be updated in the same PR/commit as the feature changes.

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

## Core Guidelines

- Always use native Obsidian API calls when possible. Documentation here: https://docs.obsidian.md/Home