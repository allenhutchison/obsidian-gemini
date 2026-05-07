# Code Review Checklist

Quick-reference checklist for reviewing code changes. Use this as a systematic guide during reviews.

## Correctness

- [ ] Logic is correct for all input cases (empty, null, boundary values)
- [ ] Edge cases are handled (empty arrays, missing properties, zero-length strings)
- [ ] Async operations are properly awaited
- [ ] No floating promises (unhandled rejections)
- [ ] Error paths return or throw appropriately
- [ ] Loop conditions terminate correctly (no infinite loops)
- [ ] Off-by-one errors checked in array indexing and string slicing
- [ ] Race conditions considered for concurrent operations
- [ ] State mutations don't cause unexpected side effects

## Architecture and design

- [ ] Single Responsibility: each function/class has one clear purpose
- [ ] DRY: no knowledge duplication (but code duplication for different concepts is fine)
- [ ] Dependencies flow in one direction (no circular imports)
- [ ] Public API surface is minimal (only expose what's needed)
- [ ] New abstractions are justified (not premature)
- [ ] Changes are backwards-compatible (or breaking changes are documented)
- [ ] Feature flags or configuration used when appropriate

## TypeScript quality

- [ ] No `any` types (use `unknown` with type guards instead)
- [ ] No non-null assertions (`!`) without clear justification
- [ ] Interfaces used for extensible object shapes
- [ ] Union types properly narrowed before use
- [ ] Generic types have meaningful constraints
- [ ] Return types are explicit for public functions
- [ ] Readonly used for data that shouldn't be mutated

## Naming and readability

- [ ] Functions use verb phrases (`fetchData`, `validateInput`)
- [ ] Booleans use `is`/`has`/`should`/`can` prefixes
- [ ] No abbreviations (except universally understood ones like `id`, `url`)
- [ ] No magic numbers or strings (use named constants)
- [ ] Comments explain "why", not "what" (code should be self-documenting)
- [ ] Functions are short enough to understand at a glance (<30 lines preferred)
- [ ] Nesting depth is shallow (use guard clauses and early returns)

## Error handling

- [ ] Errors are caught at the appropriate level
- [ ] No silently swallowed errors (empty catch blocks)
- [ ] Error messages are descriptive and include context
- [ ] User-facing errors use `Notice` with helpful messages
- [ ] Network errors are handled gracefully with retry logic where appropriate
- [ ] File operation errors check for file existence first
- [ ] Validation errors are reported before attempting the operation

## Performance

- [ ] No redundant computation inside loops
- [ ] Expensive operations are debounced (editor changes, API calls)
- [ ] Large collections use `Map`/`Set` for lookups instead of `Array.includes`
- [ ] DOM updates are batched (use `DocumentFragment`)
- [ ] Metadata accessed via `metadataCache`, not by re-reading files
- [ ] Independent async operations run in parallel (`Promise.all`)
- [ ] No synchronous file reads or heavy computation on the main thread

## Security

- [ ] No `eval()`, `new Function()`, or dynamic code execution
- [ ] No `innerHTML` with untrusted content
- [ ] User input is sanitized before use in file paths, queries, or templates
- [ ] No hardcoded API keys, tokens, or credentials in source
- [ ] External data (API responses, file contents) is validated
- [ ] File paths are normalized with `normalizePath()`
- [ ] System folders (`.obsidian`, plugin state folder) are excluded from operations

## Testing

- [ ] New functionality has corresponding tests
- [ ] Tests verify behavior, not implementation details
- [ ] Edge cases are tested (empty input, null, errors)
- [ ] Test names describe the scenario and expected outcome
- [ ] Mocks are minimal and focused
- [ ] Tests are independent (no shared mutable state between tests)
- [ ] Error paths are tested, not just happy paths

## Obsidian-specific (use obsidian-plugin-development skill for details)

- [ ] Uses Obsidian API over low-level alternatives (`vault.read` not `vault.adapter.read`)
- [ ] Events registered with `this.registerEvent()` for automatic cleanup
- [ ] Intervals registered with `this.registerInterval()`
- [ ] DOM events registered with `this.registerDomEvent()`
- [ ] Network requests use `requestUrl()`, not `fetch()`
- [ ] File lookups use `getAbstractFileByPath()` with `instanceof` checks
- [ ] Frontmatter modified via `fileManager.processFrontMatter()`
- [ ] CSS uses Obsidian theme variables, not hardcoded colors
- [ ] Works in both light and dark themes
- [ ] Icons use `setIcon()` with Lucide icon names
- [ ] `onLayoutReady()` used before accessing workspace UI

## Project conventions

- [ ] Follows project naming conventions (camelCase functions, PascalCase types, kebab-case files)
- [ ] Formatted with Prettier (2-space indent, 120-column width, single quotes, trailing commas)
- [ ] Uses project Logger service, not `console.log` directly
- [ ] Documentation updated alongside code changes
- [ ] Imports organized (framework, external packages, internal modules)
