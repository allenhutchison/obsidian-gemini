---
name: obsidian-plugin-development
description: >-
  Build, modify, and debug Obsidian plugins using the TypeScript API. Use this
  skill when working with Obsidian plugin source code, the obsidian npm package,
  plugin UI (views, modals, settings, commands, ribbons), vault file operations,
  editor manipulation, workspace management, metadata cache, events, markdown
  rendering, or the Obsidian CLI. Covers plugin lifecycle, best practices,
  common patterns, and the full TypeScript API surface.
metadata:
  author: obsidian-gemini
  version: "1.0"
compatibility: Requires Node.js, npm, and TypeScript. Targets the obsidian npm package.
---

# Obsidian Plugin Development

## When to use this skill

Use this skill when:
- Creating or modifying an Obsidian plugin
- Working with the `obsidian` npm package TypeScript API
- Building plugin UI: views, modals, settings tabs, commands, ribbon icons, context menus, status bar
- Performing vault file operations (read, create, modify, delete, rename)
- Manipulating the editor (cursor, selection, transactions)
- Working with the workspace (leaves, tabs, splits, sidebars)
- Using MetadataCache for frontmatter, links, tags, headings
- Handling events (vault, workspace, editor, metadata changes)
- Rendering markdown programmatically
- Making HTTP requests from a plugin (use `requestUrl`, not `fetch`)
- Using the Obsidian CLI for automation, scripting, or developer tooling
- Debugging or testing an Obsidian plugin

## Plugin anatomy

An Obsidian plugin consists of:

```
my-plugin/
  ├── main.ts          # Entry point: default export extending Plugin
  ├── manifest.json    # Plugin metadata (id, name, version, minAppVersion)
  ├── styles.css       # Optional: plugin styles
  ├── package.json     # npm dependencies
  ├── tsconfig.json    # TypeScript config
  └── esbuild.config.mjs  # Build config (or rollup/vite)
```

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "Description of plugin",
  "author": "Author Name",
  "authorUrl": "https://example.com",
  "isDesktopOnly": false
}
```

### Main plugin class

```typescript
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  settings: MySettings;

  async onload() {
    // Called when plugin is activated
    await this.loadSettings();
    this.addSettingTab(new MySettingTab(this.app, this));
    this.addCommand({ id: 'my-cmd', name: 'My Command', callback: () => {} });
    this.addRibbonIcon('icon-name', 'Tooltip', () => {});
    this.registerView('view-type', (leaf) => new MyView(leaf));
    this.registerEvent(this.app.vault.on('modify', (file) => {}));
  }

  onunload() {
    // Called when plugin is deactivated - cleanup happens automatically
    // for anything registered via this.register*() or this.add*()
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

## Core API classes

The `app` object (available as `this.app` in Plugin subclasses) provides access to the entire API:

| Property | Class | Purpose |
|----------|-------|---------|
| `app.vault` | `Vault` | File CRUD operations |
| `app.workspace` | `Workspace` | Panes, tabs, views, layout |
| `app.metadataCache` | `MetadataCache` | Cached file metadata, link resolution |
| `app.fileManager` | `FileManager` | High-level file operations, frontmatter |

### Vault - File operations

```typescript
// Read
const content = await this.app.vault.read(file);           // async read
const cached = await this.app.vault.cachedRead(file);      // faster, may be stale

// Create
const newFile = await this.app.vault.create('path/file.md', 'content');
await this.app.vault.createFolder('path/folder');

// Modify
await this.app.vault.modify(file, 'new content');
await this.app.vault.append(file, '\nappended text');

// Atomic read-modify-write
await this.app.vault.process(file, (data) => {
  return data.replace('old', 'new');
});

// Delete and rename
await this.app.vault.delete(file);
await this.app.vault.trash(file, true);  // system trash
await this.app.vault.rename(file, 'new/path.md');

// Find files
const file = this.app.vault.getAbstractFileByPath('notes/note.md');
if (file instanceof TFile) { /* use it */ }
const allMd = this.app.vault.getMarkdownFiles();
const allFiles = this.app.vault.getFiles();
```

**IMPORTANT**: Always use `vault.getAbstractFileByPath()` and check `instanceof TFile`/`TFolder`. Never construct TFile/TFolder objects directly.

### Workspace - Views, leaves, layout

```typescript
// Get active editor/file
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
const file = this.app.workspace.getActiveFile();

// Open files
const leaf = this.app.workspace.getLeaf('tab');  // 'tab' | 'split' | 'window'
await leaf.openFile(file);
await this.app.workspace.openLinkText('Note Name', '', true);

// Find views
const leaves = this.app.workspace.getLeavesOfType('my-view');
this.app.workspace.iterateAllLeaves((leaf) => { /* ... */ });

// Sidebar leaves
const rightLeaf = this.app.workspace.getRightLeaf(false);

// Layout readiness
this.app.workspace.onLayoutReady(() => { /* safe to access UI */ });
```

### MetadataCache - Parsed file metadata

```typescript
const cache = this.app.metadataCache.getFileCache(file);
if (cache) {
  cache.headings;    // HeadingCache[]
  cache.tags;        // TagCache[]
  cache.links;       // LinkCache[]
  cache.embeds;      // EmbedCache[]
  cache.frontmatter; // FrontMatterCache
  cache.sections;    // SectionCache[]
}

// Resolve a wikilink to a TFile
const target = this.app.metadataCache.getFirstLinkpathDest('Note', 'source/path.md');
```

### FileManager - High-level file operations

```typescript
// Process frontmatter (atomic read-modify-write for YAML)
await this.app.fileManager.processFrontMatter(file, (fm) => {
  fm.tags = ['tag1', 'tag2'];
  fm.modified = new Date().toISOString();
});

// Rename with metadata updates (updates links across vault)
await this.app.fileManager.renameFile(file, 'new/path.md');
```

### Editor - Text manipulation

```typescript
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (view) {
  const editor = view.editor;

  // Cursor and selection
  const cursor = editor.getCursor();          // { line, ch }
  const selection = editor.getSelection();
  editor.replaceSelection('replacement');
  editor.setSelection(anchor, head);

  // Content
  const value = editor.getValue();
  const line = editor.getLine(lineNum);
  editor.replaceRange('text', from, to);

  // Batch operations
  editor.transaction({ changes: [{ from, to, text: 'new' }] });

  // Scroll
  editor.scrollIntoView({ from, to }, true);
}
```

## UI components

### Commands

```typescript
this.addCommand({
  id: 'unique-command-id',
  name: 'Human-readable name',
  callback: () => { /* runs always */ },
  // OR for editor commands:
  editorCallback: (editor: Editor, view: MarkdownView) => { /* runs when editor active */ },
  // OR conditional:
  checkCallback: (checking: boolean) => {
    if (canRun) {
      if (!checking) { doStuff(); }
      return true;
    }
    return false;
  },
  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'p' }],
});
```

### Modals

```typescript
class MyModal extends Modal {
  constructor(app: App) { super(app); }

  onOpen() {
    this.setTitle('My Modal');
    this.contentEl.createEl('p', { text: 'Content here' });
    new Setting(this.contentEl)
      .setName('Option')
      .addToggle(t => t.setValue(true).onChange(v => {}));
  }

  onClose() { this.contentEl.empty(); }
}

// Usage: new MyModal(this.app).open();
```

### Settings tabs

```typescript
class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;
  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Setting name')
      .setDesc('Description')
      .addText(text => text
        .setPlaceholder('placeholder')
        .setValue(this.plugin.settings.value)
        .onChange(async (v) => {
          this.plugin.settings.value = v;
          await this.plugin.saveSettings();
        }));

    // Setting control types: addText, addTextArea, addToggle, addDropdown,
    // addSlider, addButton, addExtraButton, addColorPicker, addSearch
  }
}
```

### Custom views

```typescript
class MyView extends ItemView {
  getViewType() { return 'my-view-type'; }
  getDisplayText() { return 'My View'; }
  getIcon() { return 'bot'; }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl('h4', { text: 'My View' });
    this.addAction('refresh-cw', 'Refresh', () => { /* header action */ });
  }

  async onClose() { /* cleanup */ }
}

// Register in onload:
this.registerView('my-view-type', (leaf) => new MyView(leaf));

// Activate:
async activateView() {
  let leaf = this.app.workspace.getLeavesOfType('my-view-type')[0];
  if (!leaf) {
    leaf = this.app.workspace.getRightLeaf(false)!;
    await leaf.setViewState({ type: 'my-view-type', active: true });
  }
  this.app.workspace.revealLeaf(leaf);
}
```

### Other UI

```typescript
// Ribbon icon
this.addRibbonIcon('dice', 'Tooltip text', (evt) => { });

// Status bar
const statusEl = this.addStatusBarItem();
statusEl.setText('Status text');

// Notice (toast)
new Notice('Message to user');
new Notice('Persistent message', 0);  // 0 = no auto-dismiss

// Context menu
this.registerEvent(
  this.app.workspace.on('file-menu', (menu, file) => {
    menu.addItem((item) => {
      item.setTitle('My action').setIcon('icon').onClick(() => {});
    });
  })
);

// Editor context menu
this.registerEvent(
  this.app.workspace.on('editor-menu', (menu, editor, info) => {
    menu.addItem((item) => {
      item.setTitle('Editor action').onClick(() => {});
    });
  })
);

// HTML elements (Obsidian extends HTMLElement)
const div = containerEl.createDiv({ cls: 'my-class', text: 'Hello' });
const el = containerEl.createEl('span', { cls: 'highlight', attr: { 'data-id': '1' } });
el.empty();  // remove all children
el.addClass('new-class');
el.toggleClass('active', true);

// Icons (Lucide icons built in)
import { setIcon } from 'obsidian';
setIcon(element, 'lucide-icon-name');  // e.g. 'bot', 'settings', 'file-text'
```

## Events

Always use `this.registerEvent()` to ensure automatic cleanup on plugin unload:

```typescript
// Vault events
this.registerEvent(this.app.vault.on('create', (file) => {}));
this.registerEvent(this.app.vault.on('modify', (file) => {}));
this.registerEvent(this.app.vault.on('delete', (file) => {}));
this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {}));

// Workspace events
this.registerEvent(this.app.workspace.on('file-open', (file) => {}));
this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {}));
this.registerEvent(this.app.workspace.on('layout-change', () => {}));
this.registerEvent(this.app.workspace.on('editor-change', (editor, info) => {}));

// MetadataCache events
this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {}));
this.registerEvent(this.app.metadataCache.on('resolved', () => {}));

// Timed intervals
this.registerInterval(window.setInterval(() => {}, 60000));

// DOM events (auto-cleaned up)
this.registerDomEvent(document, 'click', (evt) => {});
```

## Network requests

Always use `requestUrl` instead of `fetch` for cross-platform compatibility (desktop + mobile):

```typescript
import { requestUrl } from 'obsidian';

const response = await requestUrl({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Authorization': 'Bearer TOKEN' },
  contentType: 'application/json',
  body: JSON.stringify({ key: 'value' }),
});
const data = response.json;   // parsed JSON
const text = response.text;   // raw text
const status = response.status;
```

## Markdown rendering

```typescript
import { MarkdownRenderer } from 'obsidian';

await MarkdownRenderer.render(
  this.app,
  '# Heading\nSome **bold** and a [[link]].',
  containerEl,
  '',        // sourcePath for resolving links
  this       // Component for lifecycle management
);
```

## Key best practices

1. **Always use Obsidian API over low-level alternatives**: `vault.getMarkdownFiles()` not `vault.adapter.list()`, `fileManager.processFrontMatter()` not manual YAML parsing, `app.metadataCache` not re-parsing files
2. **Register everything for cleanup**: Use `this.registerEvent()`, `this.registerInterval()`, `this.registerDomEvent()`, `this.addCommand()`, `this.addSettingTab()`, `this.registerView()` - they all auto-clean on unload
3. **Use `requestUrl` not `fetch`**: Required for mobile compatibility
4. **Wait for layout**: Use `this.app.workspace.onLayoutReady()` before accessing UI
5. **Check `instanceof`**: Always verify `TFile` vs `TFolder` when using `getAbstractFileByPath()`
6. **Use CSS variables**: Use Obsidian's theme variables for styling, test in both light and dark themes
7. **Use `setIcon()`**: Use `import { setIcon } from 'obsidian'` with Lucide icon names
8. **Debounce frequent operations**: Use `import { debounce } from 'obsidian'` for editor changes or API calls
9. **Use normalized paths**: Obsidian uses forward slashes on all platforms
10. **Never block the main thread**: Use `async/await` for file operations, API calls, and heavy computations

## Obsidian CLI

Obsidian 1.12+ includes a CLI for terminal-based vault interaction. See [the CLI reference](references/cli-reference.md) for complete command documentation.

Key developer commands:
- `obsidian dev:eval code="expression"` - Execute JavaScript in the app console
- `obsidian dev:console` - View captured console messages
- `obsidian dev:dom query="selector"` - Query DOM elements
- `obsidian dev:css query="selector"` - Inspect CSS with source locations
- `obsidian dev:screenshot` - Capture app screenshots
- `obsidian dev:mobile` - Toggle mobile emulation
- `obsidian dev:errors` - Display captured errors
- `obsidian plugin:reload` - Reload plugins during development

## Further reading

- [TypeScript API Reference](references/api-reference.md) - Complete class and interface definitions
- [CLI Reference](references/cli-reference.md) - Full Obsidian CLI command documentation
- [Best Practices](references/best-practices.md) - Detailed patterns and anti-patterns
