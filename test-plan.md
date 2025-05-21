# Test Coverage Improvement Plan

This document outlines the plan to improve test coverage for the Obsidian Gemini Scribe plugin.

## Overall Goals

*   Increase confidence in code correctness and stability.
*   Reduce regressions when introducing new features or refactoring.
*   Ensure critical logic paths are well-tested.

## Testing Framework

*   Jest (already configured in the project)

## Priority Areas for Test Coverage

The following areas have been identified for focused test coverage efforts.

### 1. Core Utility Functions (`src/api/utils/debug.ts`)

*   **Status:** In Progress
*   **Files:** `src/api/utils/debug.test.ts`
*   **Functions to Test:**
    *   [x] `isBaseModelRequest`
    *   [x] `isExtendedModelRequest`
    *   [x] `formatBaseModelRequest`
    *   [x] `formatExtendedModelRequest`
    *   [x] `stripFileContextNode`
        *   Test with simple node, no links.
        *   Test with nested links.
        *   Test with `isRoot = true` vs `isRoot = false` behavior for content.
        *   Test with Map for links.
        *   Test with plain object for links.
        *   Test with non-object/array inputs.
    *   [x] `stripLinkedFileContents`
        *   Test with object containing a FileContextNode.
        *   Test with array of objects.
        *   Test with simple data types.
    *   [x] `redactLinkedFileSections`
        *   Test with prompt containing only current file.
        *   Test with prompt containing current file and linked files.
        *   Test extraction of WikiLink for redaction message.
    *   [ ] `logDebugInfo`
        *   Mock `console.log`.
        *   Test that it logs when `debugMode` is true.
        *   Test that it does not log when `debugMode` is false.
        *   Test correct formatter is called for `BaseModelRequest`.
        *   Test correct formatter is called for `ExtendedModelRequest`.
        *   Test correct sanitization is called for string data with "File Label:".
        *   Test correct sanitization for other data types.

### 2. Prompt Generation (`src/prompts.ts`)

*   **Status:** Not Started
*   **Files:** `src/prompts.test.ts` (to be created)
*   **Logic:** Test functions responsible for generating various prompts (system, context, completion, etc.).
    *   Verify correct template rendering with different inputs.
    *   Ensure all placeholders are correctly filled.
    *   Test edge cases (e.g., missing optional data).
    *   (If Handlebars is used, mock or use actual Handlebars for rendering).

### 3. File Context and Linking Logic (`src/files/file-context.ts`)

*   **Status:** Not Started
*   **Files:** `src/files/file-context.test.ts` (to be created)
*   **Class:** `FileContextTree`
*   **Key Areas:**
    *   Constructor: `maxDepth` behavior with `sendContext` and `depth` parameter.
    *   `buildStructure`: Recursive linking, `maxDepth` adherence, `visited` set for circular links, history folder exclusion.
    *   `initialize`: Correct setup of the root node.
    *   `toString`: Output formatting, `maxCharsPerFile`, `MAX_TOTAL_CHARS` truncation.
    *   `getFileContent`: File reading and Markdown rendering logic.
*   **Dependencies to Mock:** `ObsidianGemini` plugin instance (settings, app), `ScribeFile`, `ScribeDataView`, `GeminiPrompts`, Obsidian API (`vault.read`, `MarkdownRenderer.render`, `metadataCache`).

### 4. File Operations (`src/files/index.ts`)

*   **Status:** Not Started
*   **Files:** `src/files/index.test.ts` (to be created)
*   **Class:** `ScribeFile`
*   **Key Areas:**
    *   `getCurrentFileContent`: `sendContext` check, active file handling, `FileContextTree` interaction.
    *   `addToFrontMatter`, `replaceTextInActiveFile`: Interaction with Obsidian file system APIs.
    *   `getActiveFile`, `isFile`, `isMarkdownFile`: Basic file checks.
    *   Link normalization methods (`getLinkText`, `normalizePath`, `normalizeLinkPathsFromMetadata`, `getUniqueLinks`): Interaction with `metadataCache`.
*   **Dependencies to Mock:** `ObsidianGemini` plugin instance, Obsidian API (`workspace.getActiveFile`, `vault.modify`, `fileManager.processFrontMatter`, `metadataCache`).

### 5. Summarization and Rewrite Logic (`src/summary.ts`, `src/rewrite.ts`)

*   **Status:** Not Started
*   **Files:** `src/summary.test.ts`, `src/rewrite.test.ts` (to be created)
*   **Logic:** Test classes/functions responsible for summarization and file rewriting features.
    *   Interaction with `ScribeFile`.
    *   Request preparation for `ModelApi`.
    *   Handling of API responses.
*   **Dependencies to Mock:** `ModelApi`, `ScribeFile`, Obsidian plugin/app.

### General Mocking Strategy

*   Utilize `jest.mock()` and `jest.fn()` extensively.
*   Create a `__mocks__` directory at the root of `src` or within specific directories if mock setups become large and reusable (e.g., for `obsidian` API).
*   Focus on mocking the interfaces of dependencies rather than their internal implementations.

## Action Plan - Next Steps

1.  Complete tests for helper functions in `src/api/utils/debug.test.ts`.
    *   `stripFileContextNode`
    *   `stripLinkedFileContents`
    *   `redactLinkedFileSections`
2.  Add tests for `logDebugInfo` (mocking `console.log`) in `src/api/utils/debug.test.ts`.
3.  Proceed to `src/prompts.ts` and create `src/prompts.test.ts`.

This plan will be updated as progress is made.
