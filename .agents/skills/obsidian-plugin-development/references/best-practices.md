# Obsidian Plugin Development Best Practices

## API usage rules

### Always prefer Obsidian API over low-level alternatives

| Do this                                    | Not this                  | Why                                  |
| ------------------------------------------ | ------------------------- | ------------------------------------ |
| `vault.getMarkdownFiles()`                 | `vault.adapter.list()`    | Adapter is low-level, may miss files |
| `fileManager.processFrontMatter()`         | Manual YAML parsing       | Atomic, handles edge cases           |
| `app.metadataCache.getFileCache()`         | Re-parsing files yourself | Uses cached data, much faster        |
| `app.metadataCache.getFirstLinkpathDest()` | Manual link resolution    | Handles aliases, relative paths      |
| `fileManager.renameFile()`                 | `vault.rename()`          | Updates all links across the vault   |
| `app.workspace.openLinkText()`             | Manual leaf creation      | Handles link resolution, settings    |
| `requestUrl()`                             | `fetch()`                 | Works on both desktop and mobile     |

### File operations

1. **Always check `instanceof`** when using `getAbstractFileByPath()`:

```typescript
const file = this.app.vault.getAbstractFileByPath(path);
if (file instanceof TFile) {
	// Safe to use as TFile
} else if (file instanceof TFolder) {
	// It's a folder
} else {
	// Not found (null)
}
```

2. **Never construct TFile/TFolder directly**. Always get them from the Vault API.

3. **Use normalized paths**. Obsidian uses forward slashes on all platforms:

```typescript
import { normalizePath } from 'obsidian';
const safePath = normalizePath('folder/subfolder/note.md');
```

4. **Use `vault.process()` for read-modify-write**:

```typescript
// GOOD: atomic operation
await this.app.vault.process(file, (data) => {
	return data.replace('old', 'new');
});

// BAD: race condition possible
const data = await this.app.vault.read(file);
await this.app.vault.modify(file, data.replace('old', 'new'));
```

5. **Use `fileManager.processFrontMatter()` for YAML**:

```typescript
// GOOD: handles edge cases, atomic
await this.app.fileManager.processFrontMatter(file, (fm) => {
	fm.tags = ['tag1', 'tag2'];
});

// BAD: fragile YAML parsing
const content = await this.app.vault.read(file);
const newContent = content.replace(/^tags:.*$/m, 'tags: [tag1, tag2]');
await this.app.vault.modify(file, newContent);
```

## Lifecycle and cleanup

### Register everything for automatic cleanup

Everything registered through `this.register*()` or `this.add*()` is automatically cleaned up when the plugin unloads:

```typescript
async onload() {
  // All of these auto-cleanup on unload:
  this.registerEvent(this.app.vault.on('modify', () => {}));
  this.registerInterval(window.setInterval(() => {}, 60000));
  this.registerDomEvent(document, 'click', () => {});
  this.addCommand({ id: 'cmd', name: 'Cmd', callback: () => {} });
  this.addSettingTab(new MySettingTab(this.app, this));
  this.registerView('type', (leaf) => new MyView(leaf));
  this.addRibbonIcon('icon', 'tip', () => {});
  this.addStatusBarItem();
}

// onunload() is usually empty because everything auto-cleans
```

### Wait for layout before accessing UI

```typescript
async onload() {
  this.app.workspace.onLayoutReady(() => {
    // Safe to access workspace, leaves, views here
    this.activateView();
  });
}
```

### Component hierarchy

Use `addChild()` for components that need lifecycle management:

```typescript
class MyView extends ItemView {
	async onOpen() {
		const childComponent = this.addChild(new MyChildComponent());
		// childComponent.onunload() will be called when MyView closes
	}
}
```

## Event handling

### Always use registerEvent

```typescript
// GOOD: auto-cleaned on unload
this.registerEvent(
	this.app.vault.on('modify', (file) => {
		/* ... */
	})
);

// BAD: memory leak, never cleaned up
this.app.vault.on('modify', (file) => {
	/* ... */
});
```

### Debounce frequent events

```typescript
import { debounce } from 'obsidian';

async onload() {
  const debouncedSave = debounce(
    () => this.saveData(this.settings),
    500,
    true  // resetTimer on each call
  );

  this.registerEvent(
    this.app.workspace.on('editor-change', () => {
      debouncedSave();
    })
  );
}
```

### Key workspace events and when to use them

| Event                | Fires when                      | Common use                      |
| -------------------- | ------------------------------- | ------------------------------- |
| `file-open`          | A file is opened in any pane    | Update UI based on current file |
| `active-leaf-change` | The focused pane changes        | Update sidebar panels           |
| `layout-change`      | Workspace layout changes        | Recalculate positions           |
| `editor-change`      | Editor content is modified      | Auto-save, live preview         |
| `file-menu`          | Right-click on file in explorer | Add context menu items          |
| `editor-menu`        | Right-click in editor           | Add editor context menu items   |
| `resize`             | Window resizes                  | Reflow custom UI                |

## Settings patterns

### Default settings with type safety

```typescript
interface MySettings {
  apiKey: string;
  debugMode: boolean;
  maxResults: number;
}

const DEFAULT_SETTINGS: MySettings = {
  apiKey: '',
  debugMode: false,
  maxResults: 10,
};

// In plugin:
async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}

async saveSettings() {
  await this.saveData(this.settings);
}
```

### Settings migration

When adding new settings, `Object.assign` with defaults handles migration automatically. For breaking changes:

```typescript
async loadSettings() {
  const data = await this.loadData();

  // Migrate deprecated fields
  if (data?.oldFieldName !== undefined) {
    data.newFieldName = data.oldFieldName;
    delete data.oldFieldName;
  }

  this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  await this.saveSettings(); // Persist migration
}
```

## UI patterns

### Styling

1. **Use Obsidian CSS variables** for consistent theming:

```css
.my-plugin-container {
	color: var(--text-normal);
	background-color: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	padding: var(--size-4-2);
	border-radius: var(--radius-s);
}

.my-plugin-header {
	color: var(--text-accent);
	font-size: var(--font-ui-medium);
}

.my-plugin-muted {
	color: var(--text-muted);
	font-size: var(--font-ui-smaller);
}
```

2. **Test with both light and dark themes**. Never hardcode colors.

3. **Use `:has()` selectors** for modal sizing:

```css
.modal:has(.my-plugin-modal) {
	width: 600px;
	max-width: 90vw;
}
```

4. **Handle text overflow**:

```css
.my-plugin-title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
```

### Icons

Use Obsidian's built-in Lucide icons:

```typescript
import { setIcon } from 'obsidian';

// In views or modals
setIcon(element, 'bot'); // Robot icon
setIcon(element, 'settings'); // Gear icon
setIcon(element, 'file-text'); // Document icon
setIcon(element, 'search'); // Search icon
setIcon(element, 'refresh-cw'); // Refresh icon

// For ribbon and commands, use icon name directly
this.addRibbonIcon('dice', 'Random note', () => {});
this.addCommand({ id: 'cmd', name: 'Cmd', icon: 'star', callback: () => {} });
```

### HTML element creation

Use Obsidian's DOM helpers instead of `document.createElement`:

```typescript
// GOOD: Obsidian helpers
const div = container.createDiv({ cls: 'my-class', text: 'Content' });
const span = container.createSpan({ cls: 'label' });
const heading = container.createEl('h3', { text: 'Title', cls: 'section-header' });
const link = container.createEl('a', { href: '#', text: 'Click me' });

// With attributes
const input = container.createEl('input', {
	attr: { type: 'text', placeholder: 'Search...' },
	cls: 'my-input',
});

// Clear children
container.empty();

// Toggle classes
element.addClass('active');
element.removeClass('active');
element.toggleClass('visible', isVisible);
```

### Views with state

Save and restore view state for persistence across sessions:

```typescript
class MyView extends ItemView {
	state: { filter: string; sortBy: string };

	getState(): any {
		return this.state;
	}

	async setState(state: any, result: ViewStateResult): Promise<void> {
		this.state = state || { filter: '', sortBy: 'name' };
		this.refresh(); // Re-render with restored state
		super.setState(state, result);
	}
}
```

## Performance

### Cache expensive operations

```typescript
// Cache metadata lookups
private metadataCache = new Map<string, CachedMetadata>();

private getMetadata(file: TFile): CachedMetadata | null {
  const cached = this.metadataCache.get(file.path);
  if (cached) return cached;

  const metadata = this.app.metadataCache.getFileCache(file);
  if (metadata) this.metadataCache.set(file.path, metadata);
  return metadata;
}
```

### Debounce API calls and saves

```typescript
// Completions: 750ms debounce is a good default
const debouncedComplete = debounce(async () => {
	await this.triggerCompletion();
}, 750);
```

### Use `cachedRead` when freshness isn't critical

```typescript
// Faster, may be slightly stale
const content = await this.app.vault.cachedRead(file);

// Always fresh
const content = await this.app.vault.read(file);
```

### Batch DOM updates

```typescript
// GOOD: Single reflow
const fragment = document.createDocumentFragment();
items.forEach((item) => {
	const el = fragment.createDiv({ text: item.name });
});
container.append(fragment);

// BAD: Multiple reflows
items.forEach((item) => {
	container.createDiv({ text: item.name });
});
```

## Error handling

### Handle API errors gracefully

```typescript
try {
	const response = await requestUrl({
		url: 'https://api.example.com/data',
		throw: true,
	});
	return response.json;
} catch (error) {
	new Notice('Failed to fetch data. Check your connection.');
	console.error('API request failed:', error);
	return null;
}
```

### Validate file existence before operations

```typescript
const file = this.app.vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) {
	new Notice(`File not found: ${path}`);
	return;
}
await this.app.vault.read(file);
```

## Plugin submission checklist

When preparing a plugin for the Obsidian community:

1. **manifest.json** must include: id, name, version, minAppVersion, description, author
2. **No external network calls** without user consent
3. **No `eval()` or dynamic code execution**
4. **No `innerHTML` with untrusted content** - use `createEl()` and `textContent` instead
5. **Works on mobile** unless `isDesktopOnly: true`
6. **Uses `requestUrl`** not `fetch` for network requests
7. **No `require()` for Node.js built-ins** on mobile
8. **Styles use CSS variables** for theme compatibility
9. **All resources cleaned up** on plugin unload
10. **License file included** in the repository

## Common anti-patterns

| Anti-pattern                           | Better approach                                  |
| -------------------------------------- | ------------------------------------------------ |
| `vault.adapter.list()`                 | `vault.getMarkdownFiles()` or `vault.getFiles()` |
| `vault.adapter.read()`                 | `vault.read()` or `vault.cachedRead()`           |
| Manual YAML parsing                    | `fileManager.processFrontMatter()`               |
| `document.createElement()`             | `container.createEl()` / `createDiv()`           |
| `el.innerHTML = '...'`                 | `el.createEl()` and `textContent`                |
| `fetch()`                              | `requestUrl()`                                   |
| Global `console.log()` in production   | Conditional debug logging                        |
| `new Date().toISOString()` for display | `moment()` (Obsidian bundles moment.js)          |
| Hardcoded colors                       | CSS variables (`var(--text-normal)`)             |
| Manual event cleanup in `onunload`     | `this.registerEvent()`                           |
| `setTimeout` without cleanup           | `this.registerInterval()`                        |
| Polling for file changes               | Vault/MetadataCache events                       |
