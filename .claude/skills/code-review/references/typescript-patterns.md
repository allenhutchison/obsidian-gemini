# TypeScript Patterns and Anti-Patterns

## Type design

### Discriminated unions over type assertions

```typescript
// BAD: Type assertion needed to distinguish
interface ApiResponse {
	status: number;
	data?: unknown;
	error?: string;
}

function handle(response: ApiResponse) {
	if (response.error) {
		// TypeScript doesn't narrow here
		console.error(response.error);
	}
}

// GOOD: Discriminated union
type ApiResponse = { status: 'success'; data: unknown } | { status: 'error'; error: string };

function handle(response: ApiResponse) {
	switch (response.status) {
		case 'success':
			return response.data; // TypeScript knows data exists
		case 'error':
			throw new Error(response.error); // TypeScript knows error exists
	}
}
```

### Branded types for domain safety

```typescript
// Prevent mixing up IDs from different domains
type UserId = string & { readonly __brand: 'UserId' };
type FileId = string & { readonly __brand: 'FileId' };

function createUserId(id: string): UserId {
	return id as UserId;
}

function lookupUser(id: UserId) {
	/* ... */
}
function lookupFile(id: FileId) {
	/* ... */
}

// Compile-time error: can't pass FileId where UserId expected
// lookupUser(someFileId);
```

### Utility types

```typescript
// Extract only the methods of an interface
type Methods<T> = {
	[K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K];
};

// Make specific fields required
type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Deep partial for nested config objects
type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// Readonly deep
type DeepReadonly<T> = {
	readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

## Async patterns

### Sequential vs parallel execution

```typescript
// BAD: Sequential when operations are independent
const fileA = await vault.read(a);
const fileB = await vault.read(b);
const fileC = await vault.read(c);

// GOOD: Parallel independent operations
const [fileA, fileB, fileC] = await Promise.all([vault.read(a), vault.read(b), vault.read(c)]);

// GOOD: Use allSettled when partial failure is acceptable
const results = await Promise.allSettled(files.map((f) => vault.read(f)));
const successful = results
	.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
	.map((r) => r.value);
```

### Async iteration

```typescript
// BAD: Building array then processing
const files = vault.getMarkdownFiles();
const contents: string[] = [];
for (const file of files) {
	contents.push(await vault.read(file));
}
processAll(contents);

// GOOD: Process as you go when order doesn't matter
const files = vault.getMarkdownFiles();
await Promise.all(
	files.map(async (file) => {
		const content = await vault.read(file);
		processSingle(content);
	})
);

// GOOD: Chunked processing for large sets
async function processInChunks<T, R>(items: T[], fn: (item: T) => Promise<R>, chunkSize = 10): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		const chunk = items.slice(i, i + chunkSize);
		const chunkResults = await Promise.all(chunk.map(fn));
		results.push(...chunkResults);
	}
	return results;
}
```

### Cancellation

```typescript
// Use AbortController for cancellable operations
class CancellableSearch {
	private controller: AbortController | null = null;

	async search(query: string): Promise<Result[]> {
		// Cancel previous search
		this.controller?.abort();
		this.controller = new AbortController();

		const signal = this.controller.signal;

		try {
			const response = await requestUrl({
				url: `https://api.example.com/search?q=${query}`,
				method: 'GET',
			});

			if (signal.aborted) return [];

			return response.json;
		} catch (error) {
			if (signal.aborted) return [];
			throw error;
		}
	}

	cancel() {
		this.controller?.abort();
	}
}
```

## Object-oriented patterns

### Composition over inheritance

```typescript
// BAD: Deep inheritance hierarchy
class BaseProcessor {
	/* ... */
}
class FileProcessor extends BaseProcessor {
	/* ... */
}
class MarkdownProcessor extends FileProcessor {
	/* ... */
}
class TemplateProcessor extends MarkdownProcessor {
	/* ... */
}

// GOOD: Compose behavior
interface Processor {
	process(input: string): string;
}

class MarkdownProcessor implements Processor {
	constructor(
		private parser: MarkdownParser,
		private renderer: Renderer
	) {}

	process(input: string): string {
		const ast = this.parser.parse(input);
		return this.renderer.render(ast);
	}
}
```

### Builder pattern for complex construction

```typescript
class PromptBuilder {
	private sections: string[] = [];
	private context: string[] = [];
	private constraints: string[] = [];

	addSection(section: string): this {
		this.sections.push(section);
		return this;
	}

	addContext(ctx: string): this {
		this.context.push(ctx);
		return this;
	}

	addConstraint(constraint: string): this {
		this.constraints.push(constraint);
		return this;
	}

	build(): string {
		return [
			...this.sections,
			this.context.length ? `Context:\n${this.context.join('\n')}` : '',
			this.constraints.length ? `Constraints:\n${this.constraints.join('\n')}` : '',
		]
			.filter(Boolean)
			.join('\n\n');
	}
}
```

## Functional patterns

### Pipeline transformations

```typescript
// BAD: Nested function calls
const result = format(validate(parse(clean(input))));

// GOOD: Pipeline with descriptive steps
function processInput(input: string): Result {
	const cleaned = removeWhitespace(input);
	const parsed = parseMarkdown(cleaned);
	const validated = validateStructure(parsed);
	return formatOutput(validated);
}

// GOOD: Functional pipeline utility
function pipe<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {
	return (arg: T) => fns.reduce((result, fn) => fn(result), arg);
}

const processInput = pipe(removeWhitespace, parseMarkdown, validateStructure, formatOutput);
```

### Immutable updates

```typescript
// BAD: Mutating shared state
function addTag(settings: Settings, tag: string) {
	settings.tags.push(tag); // mutates original
	return settings;
}

// GOOD: Return new object
function addTag(settings: Settings, tag: string): Settings {
	return {
		...settings,
		tags: [...settings.tags, tag],
	};
}
```

## Common anti-patterns

### Primitive obsession

```typescript
// BAD: Passing multiple related primitives
function createNote(title: string, content: string, folder: string, tags: string[], template: string | null) {
	/* ... */
}

// GOOD: Group into a cohesive type
interface NoteOptions {
	title: string;
	content: string;
	folder: string;
	tags: string[];
	template?: string;
}

function createNote(options: NoteOptions) {
	/* ... */
}
```

### Boolean parameters

```typescript
// BAD: What does `true` mean here?
await deleteFile(file, true);

// GOOD: Use options object for clarity
await deleteFile(file, { permanent: true });

// GOOD: Or separate functions if behavior differs significantly
await moveToTrash(file);
await permanentlyDelete(file);
```

### Magic numbers and strings

```typescript
// BAD: What does 750 mean?
const debouncedSave = debounce(save, 750);

// GOOD: Named constant with context
const COMPLETION_DEBOUNCE_MS = 750;
const debouncedSave = debounce(save, COMPLETION_DEBOUNCE_MS);
```

### Barrel exports that re-export everything

```typescript
// BAD: Re-export everything, creating circular dependency risks
export * from './module-a';
export * from './module-b';
export * from './module-c';

// GOOD: Explicit, selective exports
export { ToolRegistry } from './tool-registry';
export { ToolExecutor } from './tool-executor';
export type { Tool, ToolResult } from './types';
```

## Map/Set over object/array for lookups

```typescript
// BAD: O(n) lookup on every check
const enabledPlugins: string[] = ['plugin-a', 'plugin-b'];
if (enabledPlugins.includes(pluginId)) {
	/* ... */
}

// GOOD: O(1) lookup
const enabledPlugins = new Set(['plugin-a', 'plugin-b']);
if (enabledPlugins.has(pluginId)) {
	/* ... */
}

// GOOD: Map for key-value lookups
const toolsByName = new Map<string, Tool>();
tools.forEach((t) => toolsByName.set(t.name, t));
const tool = toolsByName.get(name); // O(1)
```

## Guard clause pattern

```typescript
// BAD: Deeply nested conditions
function processCommand(cmd: Command | null) {
	if (cmd) {
		if (cmd.isEnabled) {
			if (cmd.hasPermission) {
				// actual logic
				executeCommand(cmd);
			} else {
				logger.warn('No permission');
			}
		} else {
			logger.warn('Command disabled');
		}
	}
}

// GOOD: Guard clauses with early returns
function processCommand(cmd: Command | null) {
	if (!cmd) return;
	if (!cmd.isEnabled) {
		logger.warn('Command disabled');
		return;
	}
	if (!cmd.hasPermission) {
		logger.warn('No permission');
		return;
	}

	executeCommand(cmd);
}
```
