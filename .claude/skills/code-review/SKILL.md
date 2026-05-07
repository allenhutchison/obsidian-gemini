---
name: code-review
description: >-
  Review code for quality, correctness, and maintainability. Use this skill when
  reviewing pull requests, auditing existing code, refactoring for clarity, or
  enforcing coding standards. Covers DRY principles, SOLID design, error
  handling, performance, security, testing, and TypeScript/JavaScript best
  practices. For Obsidian plugin-specific API guidance, refer to the
  obsidian-plugin-development skill.
metadata:
  author: obsidian-gemini
  version: '1.0'
compatibility: General-purpose. Language examples use TypeScript/JavaScript.
---

# Code Review

## When to use this skill

Use this skill when:

- Reviewing a pull request or code diff
- Auditing existing code for quality issues
- Refactoring code for clarity or maintainability
- Enforcing coding standards and conventions
- Identifying bugs, security vulnerabilities, or performance problems
- Evaluating whether code follows DRY, SOLID, or other design principles
- Suggesting improvements to error handling, naming, or structure

For Obsidian plugin API specifics (vault operations, workspace, views, events, CLI), use the **obsidian-plugin-development** skill alongside this one.

## Review priorities

Evaluate code in this order of importance:

1. **Correctness** - Does it work? Are there logic errors, off-by-one bugs, race conditions, or unhandled edge cases?
2. **Security** - Are there injection vulnerabilities, unsafe data handling, or exposed secrets?
3. **Maintainability** - Can another developer understand and modify this code confidently?
4. **Performance** - Are there unnecessary allocations, redundant computations, or O(n^2) algorithms hiding in loops?
5. **Style** - Does it follow project conventions for naming, formatting, and structure?

## DRY - Don't Repeat Yourself

The DRY principle states that every piece of knowledge should have a single, unambiguous representation in the system.

### Recognizing violations

```typescript
// BAD: Logic duplicated across handlers
async function handleCreate(file: TFile) {
	const content = await vault.read(file);
	const metadata = app.metadataCache.getFileCache(file);
	const tags = metadata?.frontmatter?.tags ?? [];
	await processFile(content, tags);
	logger.log('Processed:', file.path);
}

async function handleModify(file: TFile) {
	const content = await vault.read(file);
	const metadata = app.metadataCache.getFileCache(file);
	const tags = metadata?.frontmatter?.tags ?? [];
	await processFile(content, tags);
	logger.log('Processed:', file.path);
}
```

```typescript
// GOOD: Extract shared logic
async function readFileWithTags(file: TFile): Promise<{ content: string; tags: string[] }> {
	const content = await vault.read(file);
	const metadata = app.metadataCache.getFileCache(file);
	const tags = metadata?.frontmatter?.tags ?? [];
	return { content, tags };
}

async function handleFileEvent(file: TFile) {
	const { content, tags } = await readFileWithTags(file);
	await processFile(content, tags);
	logger.log('Processed:', file.path);
}
```

### When NOT to apply DRY

DRY is about knowledge duplication, not code duplication. Two blocks of code that look the same but represent different concepts should stay separate:

- **Different domains**: A validation rule for user input and a similar check in a database layer serve different purposes and may diverge.
- **Premature abstraction**: Three similar lines are better than a premature abstraction. Wait until the pattern appears 3+ times and is genuinely the same concept before extracting.
- **Test code**: Tests should be explicit and readable. Some repetition in tests is preferable to fragile shared test helpers.

## SOLID principles

### Single Responsibility

Each class or module should have one reason to change.

```typescript
// BAD: Class does API calls, caching, and UI rendering
class DataManager {
	async fetchData() {
		/* ... */
	}
	cacheResult(data: any) {
		/* ... */
	}
	renderToView(data: any) {
		/* ... */
	}
}

// GOOD: Separate concerns
class DataFetcher {
	async fetch(): Promise<Data> {
		/* ... */
	}
}
class DataCache {
	store(data: Data) {
		/* ... */
	}
	retrieve(): Data | null {
		/* ... */
	}
}
class DataView extends ItemView {
	render(data: Data) {
		/* ... */
	}
}
```

### Open/Closed

Extend behavior through composition or interfaces, not by modifying existing code.

```typescript
// GOOD: New tool types don't require modifying the registry
interface Tool {
	name: string;
	execute(params: unknown): Promise<ToolResult>;
}

class ToolRegistry {
	private tools = new Map<string, Tool>();
	register(tool: Tool) {
		this.tools.set(tool.name, tool);
	}
}
```

### Dependency Inversion

Depend on abstractions, not concretions.

```typescript
// BAD: Direct dependency on implementation
class ChatService {
	private api = new GeminiDirectApi();
}

// GOOD: Depend on interface
class ChatService {
	constructor(private api: ModelApi) {}
}
```

## Error handling

### Principles

1. **Catch at the right level** - Handle errors where you have enough context to do something meaningful.
2. **Never swallow errors silently** - At minimum, log them.
3. **Use typed errors** - Prefer specific error types over generic `Error`.
4. **Fail fast** - Validate inputs early rather than letting invalid data propagate.

### Patterns

```typescript
// BAD: Swallowed error
try {
	await riskyOperation();
} catch (e) {
	// silently ignored
}

// BAD: Catching too broadly
try {
	const data = await fetchData();
	processData(data);
	renderUI(data);
} catch (e) {
	console.log('Something went wrong');
}

// GOOD: Specific handling with context
try {
	const data = await fetchData();
} catch (error) {
	if (error instanceof NetworkError) {
		new Notice('Network unavailable. Please check your connection.');
		logger.warn('Network error during fetch:', error.message);
		return null;
	}
	// Re-throw unexpected errors
	throw error;
}
```

### Async error handling

```typescript
// BAD: Unhandled promise rejection
someAsyncFunction(); // floating promise

// GOOD: Always await or catch
await someAsyncFunction();

// GOOD: Fire-and-forget with error handling
someAsyncFunction().catch((e) => logger.error('Background task failed:', e));
```

## Naming and readability

### Function and variable names

- **Functions**: Use verb phrases that describe what they do (`fetchUserData`, `validateInput`, `buildContextTree`).
- **Booleans**: Use `is`, `has`, `should`, `can` prefixes (`isValid`, `hasPermission`, `shouldRetry`).
- **Collections**: Use plural nouns (`files`, `tags`, `pendingRequests`).
- **Constants**: Use UPPER_SNAKE_CASE for true constants (`MAX_RETRIES`, `DEFAULT_TIMEOUT`).
- **Avoid abbreviations**: `error` not `err`, `result` not `res`, `response` not `resp` (except in very tight scopes like callbacks).

### Code structure

- **Early returns**: Reduce nesting by returning early for error cases.
- **Guard clauses**: Check preconditions at the top of functions.
- **Consistent abstraction levels**: A function should operate at one level of abstraction.

```typescript
// BAD: Deep nesting
async function processFile(path: string) {
	const file = vault.getAbstractFileByPath(path);
	if (file) {
		if (file instanceof TFile) {
			const content = await vault.read(file);
			if (content.length > 0) {
				// actual logic buried here
			}
		}
	}
}

// GOOD: Early returns
async function processFile(path: string) {
	const file = vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return;
	}

	const content = await vault.read(file);
	if (content.length === 0) {
		return;
	}

	// actual logic at top level
}
```

## TypeScript-specific guidance

### Type safety

- **Avoid `any`**: Use `unknown` when the type is genuinely unknown, then narrow with type guards.
- **Use discriminated unions** over type assertions.
- **Prefer `interface` for object shapes** that may be extended; use `type` for unions, intersections, and aliases.

```typescript
// BAD: any everywhere
function process(data: any): any {
	return data.value;
}

// GOOD: Proper typing
interface ProcessInput {
	value: string;
	metadata?: Record<string, unknown>;
}

function process(data: ProcessInput): string {
	return data.value;
}
```

### Null handling

```typescript
// BAD: Non-null assertion hiding potential bugs
const file = vault.getAbstractFileByPath(path)!;

// GOOD: Explicit null check
const file = vault.getAbstractFileByPath(path);
if (!file) {
	throw new Error(`File not found: ${path}`);
}
```

### Async patterns

- Never mix callbacks and promises in the same flow.
- Use `Promise.all()` for independent concurrent operations.
- Use `Promise.allSettled()` when partial failures are acceptable.
- Always handle rejections.

## Performance checklist

When reviewing for performance:

1. **Unnecessary re-computation**: Is the same value computed multiple times in a loop? Cache it.
2. **N+1 queries**: Are API calls or file reads happening inside loops? Batch them.
3. **Large data in memory**: Are entire files loaded when only metadata is needed? Use `metadataCache`.
4. **Missing debounce**: Are event handlers (editor changes, resize) triggering expensive operations on every event?
5. **Synchronous blocking**: Are heavy computations running on the main thread? Consider `requestIdleCallback` or chunked processing.
6. **Unnecessary DOM operations**: Are elements being created/destroyed when they could be updated? Batch DOM updates with `DocumentFragment`.

## Security checklist

1. **No `eval()` or `new Function()`**: Dynamic code execution is a security risk and violates Obsidian plugin guidelines.
2. **No `innerHTML` with untrusted content**: Use `createEl()`, `textContent`, or Obsidian's DOM helpers.
3. **Sanitize user input**: Especially file paths, search queries, and template variables.
4. **No hardcoded secrets**: API keys, tokens, and credentials belong in plugin settings, never in source.
5. **Validate external data**: API responses, file contents, and deserialized data should be validated before use.
6. **Use `requestUrl`**: Not `fetch`, for Obsidian plugin network requests (cross-platform compatibility).

## Testing review

When reviewing tests:

1. **Test behavior, not implementation**: Tests should assert observable outcomes, not internal details.
2. **One assertion concept per test**: Each test should verify one logical condition (may use multiple `expect` calls if they test the same concept).
3. **Descriptive test names**: `it('returns empty array when vault has no markdown files')` not `it('test1')`.
4. **Edge cases covered**: Empty inputs, null values, boundary conditions, error paths.
5. **No test interdependence**: Tests must not depend on execution order or shared mutable state.
6. **Mocks are minimal**: Only mock what's necessary. Over-mocking makes tests brittle and less valuable.

## Review comment guidelines

When writing review feedback:

1. **Be specific**: Point to the exact line and explain what's wrong and why.
2. **Suggest alternatives**: Don't just say "this is wrong" - show a better approach.
3. **Distinguish severity**: Mark issues as blocking (must fix), suggestion (should fix), or nit (optional).
4. **Explain the "why"**: Link to the principle being violated so the author learns, not just fixes.
5. **Acknowledge good work**: Call out well-designed code, clean refactors, or thorough tests.

## Further reading

- [TypeScript Patterns](references/typescript-patterns.md) - Common patterns and anti-patterns for TypeScript codebases
- [Review Checklist](references/review-checklist.md) - Quick-reference checklist for code reviews
