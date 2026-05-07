# Obsidian TypeScript API Reference

Complete reference for the `obsidian` npm package TypeScript API. For the definitive type definitions, check `node_modules/obsidian/obsidian.d.ts` in your project.

## Core Infrastructure

### Component

Base class providing lifecycle management. All views, plugins, and UI elements extend this.

```typescript
class Component {
	/** Called to register cleanup callbacks. */
	load(): void;

	/** Called when the component is being destroyed. */
	onload(): void;

	/** Called when the component is being destroyed. */
	unload(): void;

	/** Register a child component for automatic lifecycle management. */
	addChild<T extends Component>(component: T): T;

	/** Remove a child component. */
	removeChild<T extends Component>(component: T): T;

	/** Register a callback to run on unload. */
	register(cb: () => any): void;

	/** Register an event handler (auto-cleaned on unload). */
	registerEvent(eventRef: EventRef): void;

	/** Register a DOM event handler (auto-cleaned on unload). */
	registerDomEvent<K extends keyof WindowEventMap>(
		el: Window,
		type: K,
		callback: (this: HTMLElement, ev: WindowEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions
	): void;
	registerDomEvent<K extends keyof DocumentEventMap>(
		el: Document,
		type: K,
		callback: (this: HTMLElement, ev: DocumentEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions
	): void;
	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => any,
		options?: boolean | AddEventListenerOptions
	): void;

	/** Register a setInterval that auto-clears on unload. */
	registerInterval(id: number): number;
}
```

### Events

Mixin class for event handling.

```typescript
class Events {
	on(name: string, callback: (...data: any) => any, ctx?: any): EventRef;
	off(name: string, callback: (...data: any) => any): void;
	offref(ref: EventRef): void;
	trigger(name: string, ...data: any[]): void;
	tryTrigger(evt: EventRef, args: any[]): void;
}
```

### Plugin

The main entry point class. Extends Component.

```typescript
abstract class Plugin extends Component {
	app: App;
	manifest: PluginManifest;

	/** Load saved plugin data. */
	loadData(): Promise<any>;

	/** Save plugin data. */
	saveData(data: any): Promise<void>;

	/** Add a command to the command palette. */
	addCommand(command: Command): Command;

	/** Add a ribbon icon to the left sidebar. */
	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement;

	/** Add a status bar item. */
	addStatusBarItem(): HTMLElement;

	/** Add a settings tab for this plugin. */
	addSettingTab(settingTab: PluginSettingTab): void;

	/** Register a custom view type. */
	registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => View): void;

	/** Register a file extension to be handled by a view. */
	registerExtensions(extensions: string[], viewType: string): void;

	/** Register a markdown post processor. */
	registerMarkdownPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number): MarkdownPostProcessor;

	/** Register a markdown code block processor. */
	registerMarkdownCodeBlockProcessor(
		language: string,
		handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void,
		sortOrder?: number
	): MarkdownPostProcessor;

	/** Register an editor suggest (autocomplete). */
	registerEditorSuggest(editorSuggest: EditorSuggest<any>): void;

	/** Register an Obsidian URI protocol handler. */
	registerObsidianProtocolHandler(action: string, handler: (params: ObsidianProtocolData) => any): void;

	/** Register a hover link source. */
	registerHoverLinkSource(id: string, info: HoverLinkSource): void;
}

interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description: string;
	author: string;
	authorUrl?: string;
	isDesktopOnly?: boolean;
}

interface Command {
	id: string;
	name: string;
	icon?: string;
	mobileOnly?: boolean;
	callback?: () => any;
	checkCallback?: (checking: boolean) => boolean | void;
	editorCallback?: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => any;
	editorCheckCallback?: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => boolean | void;
	hotkeys?: Hotkey[];
}

interface Hotkey {
	modifiers: Modifier[];
	key: string;
}

type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';
```

### App

The root application object. Available as `this.app` in Plugin subclasses.

```typescript
class App {
	vault: Vault;
	workspace: Workspace;
	metadataCache: MetadataCache;
	fileManager: FileManager;
	keymap: Keymap;
	scope: Scope;
	lastEvent: UserEvent | null;

	// Commonly used internal APIs (not in official d.ts but widely used):
	// app.plugins           - PluginManager
	// app.setting           - SettingManager
	// app.commands          - CommandManager
	// app.internalPlugins   - InternalPluginManager
}
```

## File System

### TAbstractFile

Base class for all vault items (files and folders).

```typescript
abstract class TAbstractFile {
	vault: Vault;
	path: string; // Full path from vault root (e.g. "folder/note.md")
	name: string; // Filename with extension (e.g. "note.md")
	parent: TFolder | null;
}
```

### TFile

Represents a file in the vault. Extends TAbstractFile.

```typescript
class TFile extends TAbstractFile {
	stat: FileStats;
	basename: string; // Filename without extension (e.g. "note")
	extension: string; // File extension without dot (e.g. "md")
}

interface FileStats {
	ctime: number; // Creation time (milliseconds since epoch)
	mtime: number; // Modification time (milliseconds since epoch)
	size: number; // File size in bytes
}
```

### TFolder

Represents a folder in the vault. Extends TAbstractFile.

```typescript
class TFolder extends TAbstractFile {
	children: TAbstractFile[];

	/** Check if this folder is the vault root. */
	isRoot(): boolean;
}
```

### Vault

File system operations. Extends Events.

```typescript
class Vault extends Events {
	/** Get the vault adapter (low-level I/O). Prefer Vault methods instead. */
	adapter: DataAdapter;

	// --- Read ---
	/** Read file contents as string. */
	read(file: TFile): Promise<string>;
	/** Read file contents from cache (may be stale). */
	cachedRead(file: TFile): Promise<string>;
	/** Read file as binary ArrayBuffer. */
	readBinary(file: TFile): Promise<ArrayBuffer>;

	// --- Create ---
	/** Create a new file. Throws if file exists. */
	create(path: string, data: string): Promise<TFile>;
	/** Create a new binary file. */
	createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
	/** Create a folder. */
	createFolder(path: string): Promise<void>;

	// --- Modify ---
	/** Overwrite a file's content. */
	modify(file: TFile, data: string): Promise<void>;
	/** Overwrite with binary data. */
	modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
	/** Append to a file. */
	append(file: TFile, data: string): Promise<void>;
	/** Atomic read-modify-write. */
	process(file: TFile, fn: (data: string) => string): Promise<string>;

	// --- Delete/Rename ---
	/** Permanently delete a file. */
	delete(file: TAbstractFile, force?: boolean): Promise<void>;
	/** Move to system or Obsidian trash. */
	trash(file: TAbstractFile, system: boolean): Promise<void>;
	/** Rename or move a file. */
	rename(file: TAbstractFile, newPath: string): Promise<void>;
	/** Copy a file. */
	copy(file: TFile, newPath: string): Promise<TFile>;

	// --- Lookup ---
	/** Get a file or folder by its vault path. Returns null if not found. */
	getAbstractFileByPath(path: string): TAbstractFile | null;
	/** Get all markdown files. */
	getMarkdownFiles(): TFile[];
	/** Get all files (including non-markdown). */
	getFiles(): TFile[];
	/** Get the root folder. */
	getRoot(): TFolder;

	// --- Events ---
	on(name: 'create', callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
	on(name: 'modify', callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
	on(name: 'delete', callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
	on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => any, ctx?: any): EventRef;

	// --- Static ---
	/** Normalize a path (forward slashes, no leading/trailing slashes). */
	static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => any): void;
}

/** Normalize a vault path. */
function normalizePath(path: string): string;
```

### FileManager

High-level file operations with metadata awareness.

```typescript
class FileManager {
	/** Process frontmatter atomically. Callback receives the frontmatter object. */
	processFrontMatter(file: TFile, fn: (frontmatter: any) => void): Promise<void>;

	/** Rename a file and update all links pointing to it. */
	renameFile(file: TAbstractFile, newPath: string): Promise<void>;

	/** Generate a unique file path to avoid collisions. */
	getNewFileParent(sourcePath: string): TFolder;

	/** Get available path (appends number if exists). */
	getAvailablePath(filename: string, extension: string): string;
}
```

### MetadataCache

Cached parsed metadata for vault files. Extends Events.

```typescript
class MetadataCache extends Events {
	/** Get cached metadata for a file. */
	getFileCache(file: TFile): CachedMetadata | null;

	/** Get the first file that matches a linkpath. */
	getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null;

	/** Resolve all subpaths in a link. */
	resolvedLinks: Record<string, Record<string, number>>;

	/** Unresolved links. */
	unresolvedLinks: Record<string, Record<string, number>>;

	// --- Events ---
	/** Fired when metadata for a file changes. */
	on(name: 'changed', callback: (file: TFile, data: string, cache: CachedMetadata) => any, ctx?: any): EventRef;
	/** Fired when all files have been resolved. */
	on(name: 'resolved', callback: () => any, ctx?: any): EventRef;
	/** Fired when a file is resolved. */
	on(name: 'resolve', callback: (file: TFile) => any, ctx?: any): EventRef;
}

interface CachedMetadata {
	links?: LinkCache[];
	embeds?: EmbedCache[];
	tags?: TagCache[];
	headings?: HeadingCache[];
	sections?: SectionCache[];
	listItems?: ListItemCache[];
	frontmatter?: FrontMatterCache;
	frontmatterLinks?: FrontmatterLinkCache[];
	frontmatterPosition?: Pos;
	blocks?: Record<string, BlockCache>;
}

interface LinkCache extends ReferenceCache {
	link: string; // The link target
	original: string; // Original text
	displayText?: string; // Display text
	position: Pos;
}

interface TagCache {
	tag: string; // The tag including # (e.g. "#tag")
	position: Pos;
}

interface HeadingCache {
	heading: string; // The heading text
	level: number; // 1-6
	position: Pos;
}

interface FrontMatterCache extends Record<string, any> {
	position: Pos;
}

interface Pos {
	start: Loc;
	end: Loc;
}

interface Loc {
	line: number; // 0-indexed line number
	col: number; // 0-indexed column
	offset: number; // Character offset from start of file
}
```

## Workspace & Views

### Workspace

Manages the workspace layout (all panes, tabs, sidebars). Extends Events.

```typescript
class Workspace extends Events {
	/** The active leaf. */
	activeLeaf: WorkspaceLeaf | null;

	// --- Active state ---
	/** Get the active file (from the focused leaf). */
	getActiveFile(): TFile | null;
	/** Get the active view of a specific type. */
	getActiveViewOfType<T extends View>(type: Constructor<T>): T | null;

	// --- Leaf management ---
	/** Get or create a leaf. */
	getLeaf(newLeaf?: boolean | PaneType): WorkspaceLeaf;
	/** Get all leaves of a given view type. */
	getLeavesOfType(viewType: string): WorkspaceLeaf[];
	/** Bring a leaf into focus and scroll it into view. */
	revealLeaf(leaf: WorkspaceLeaf): void;
	/** Set the active leaf. */
	setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean }): void;
	/** Get a leaf in the right sidebar. */
	getRightLeaf(shouldCreate: boolean): WorkspaceLeaf | null;
	/** Get a leaf in the left sidebar. */
	getLeftLeaf(shouldCreate: boolean): WorkspaceLeaf | null;
	/** Close all leaves of a given view type. */
	detachLeavesOfType(viewType: string): void;
	/** Open a link in appropriate leaf. */
	openLinkText(
		linktext: string,
		sourcePath: string,
		newLeaf?: boolean | PaneType,
		openViewState?: OpenViewState
	): Promise<void>;

	// --- Layout ---
	iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => any): void;
	iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => any): void;
	createLeafBySplit(leaf: WorkspaceLeaf, direction?: SplitDirection, before?: boolean): WorkspaceLeaf;
	onLayoutReady(callback: () => any): void;
	requestSaveLayout(): void;

	// --- Events ---
	on(name: 'file-open', callback: (file: TFile | null) => any, ctx?: any): EventRef;
	on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => any, ctx?: any): EventRef;
	on(name: 'layout-change', callback: () => any, ctx?: any): EventRef;
	on(name: 'resize', callback: () => any, ctx?: any): EventRef;
	on(name: 'css-change', callback: () => any, ctx?: any): EventRef;
	on(
		name: 'file-menu',
		callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => any,
		ctx?: any
	): EventRef;
	on(
		name: 'editor-menu',
		callback: (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => any,
		ctx?: any
	): EventRef;
	on(
		name: 'editor-change',
		callback: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => any,
		ctx?: any
	): EventRef;
	on(
		name: 'editor-paste',
		callback: (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => any,
		ctx?: any
	): EventRef;
	on(
		name: 'editor-drop',
		callback: (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => any,
		ctx?: any
	): EventRef;
	on(name: 'quit', callback: () => any, ctx?: any): EventRef;
	on(name: 'window-open', callback: (win: WorkspaceWindow, window: Window) => any, ctx?: any): EventRef;
	on(name: 'window-close', callback: (win: WorkspaceWindow, window: Window) => any, ctx?: any): EventRef;
}

type PaneType = 'tab' | 'split' | 'window';
type SplitDirection = 'vertical' | 'horizontal';
```

### WorkspaceLeaf

A leaf (tab/pane) in the workspace.

```typescript
class WorkspaceLeaf extends Component {
	view: View;
	openFile(file: TFile, openState?: OpenViewState): Promise<void>;
	setViewState(viewState: ViewState, eState?: any): Promise<void>;
	getViewState(): ViewState;
	detach(): void;
	setPinned(pinned: boolean): void;
	setGroup(group: string): void;
	getEphemeralState(): any;
}

interface ViewState {
	type: string;
	state?: any;
	active?: boolean;
	pinned?: boolean;
}
```

### ItemView

Base class for custom side-panel or main views. Extends View.

```typescript
abstract class ItemView extends View {
	contentEl: HTMLElement;
	abstract getViewType(): string;
	abstract getDisplayText(): string;
	getIcon(): string;
	async onOpen(): Promise<void>;
	async onClose(): Promise<void>;
	navigation: boolean;
	leaf: WorkspaceLeaf;
	app: App;
	containerEl: HTMLElement;
	addAction(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement;
	setState(state: any, result: ViewStateResult): Promise<void>;
	getState(): any;
}
```

### MarkdownView

The standard markdown editor view. Extends TextFileView.

```typescript
class MarkdownView extends TextFileView {
	editor: Editor;
	previewMode: MarkdownPreviewView;
	currentMode: MarkdownSubView;
	file: TFile;
	data: string;
	requestSave(): void;
	getViewType(): string; // returns "markdown"
	getDisplayText(): string; // filename
	getMode(): MarkdownViewModeType;
	showSearch(replace?: boolean): void;

	// Inherited from TextFileView:
	onLoadFile(file: TFile): Promise<void>;
	onUnloadFile(file: TFile): void;
	getViewData(): string;
	setViewData(data: string, clear: boolean): void;
	clear(): void;
}

type MarkdownViewModeType = 'source' | 'preview';
```

## Editor

### Editor

Abstraction over CodeMirror 6 for text editing.

```typescript
class Editor {
	// --- Cursor and selection ---
	getCursor(string?: 'from' | 'to' | 'head' | 'anchor'): EditorPosition;
	setCursor(pos: EditorPosition | number, ch?: number): void;
	setSelection(anchor: EditorPosition, head?: EditorPosition): void;
	getSelection(): string;
	replaceSelection(replacement: string, origin?: string): void;
	listSelections(): EditorSelectionOrCaret[];
	somethingSelected(): boolean;

	// --- Content access ---
	getValue(): string;
	setValue(content: string): void;
	getLine(line: number): string;
	setLine(line: number, text: string): void;
	lineCount(): number;
	lastLine(): number;
	getRange(from: EditorPosition, to: EditorPosition): string;
	replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition, origin?: string): void;

	// --- Transactions ---
	transaction(tx: EditorTransaction, origin?: string): void;

	// --- Scrolling ---
	scrollTo(x?: number | null, y?: number | null): void;
	scrollIntoView(range: EditorRange, center?: boolean): void;

	// --- History ---
	undo(): void;
	redo(): void;

	// --- Utilities ---
	focus(): void;
	blur(): void;
	hasFocus(): boolean;
	exec(command: EditorCommandName): void;
	offsetToPos(offset: number): EditorPosition;
	posToOffset(pos: EditorPosition): number;
	wordAt(pos: EditorPosition): EditorRange | null;
	cm: any; // Underlying CodeMirror 6 EditorView
}

interface EditorPosition {
	line: number;
	ch: number;
}

interface EditorRange {
	from: EditorPosition;
	to: EditorPosition;
}

interface EditorTransaction {
	replaceSelection?: string;
	selections?: EditorRangeOrCaret[];
	changes?: EditorChange[];
	selection?: EditorRange;
}

interface EditorChange extends EditorRange {
	text: string;
}
```

## UI Components

### Modal

Base class for modal dialogs. Extends Component.

```typescript
class Modal extends Component {
	app: App;
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	scope: Scope;

	constructor(app: App);
	open(): void;
	close(): void;
	onOpen(): void;
	onClose(): void;
	setTitle(title: string): this;
	setContent(content: string | DocumentFragment): this;
}
```

### Setting

Creates a setting control row in a container.

```typescript
class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	controlEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;

	constructor(containerEl: HTMLElement);
	setName(name: string | DocumentFragment): this;
	setDesc(desc: string | DocumentFragment): this;
	setClass(cls: string): this;
	setTooltip(tooltip: string, options?: TooltipOptions): this;
	setHeading(): this;
	setDisabled(disabled: boolean): this;

	addText(cb: (component: TextComponent) => any): this;
	addTextArea(cb: (component: TextAreaComponent) => any): this;
	addToggle(cb: (component: ToggleComponent) => any): this;
	addDropdown(cb: (component: DropdownComponent) => any): this;
	addSlider(cb: (component: SliderComponent) => any): this;
	addButton(cb: (component: ButtonComponent) => any): this;
	addExtraButton(cb: (component: ExtraButtonComponent) => any): this;
	addColorPicker(cb: (component: ColorComponent) => any): this;
	addSearch(cb: (component: SearchComponent) => any): this;
	addMomentFormat(cb: (component: MomentFormatComponent) => any): this;
	clear(): this;
	then(cb: (setting: this) => any): this;
}
```

### Setting control components

```typescript
interface TextComponent {
	setValue(value: string): this;
	setPlaceholder(placeholder: string): this;
	onChange(callback: (value: string) => any): this;
	setDisabled(disabled: boolean): this;
	inputEl: HTMLInputElement;
}

interface ToggleComponent {
	setValue(on: boolean): this;
	onChange(callback: (value: boolean) => any): this;
	setDisabled(disabled: boolean): this;
	toggleEl: HTMLElement;
}

interface DropdownComponent {
	addOption(value: string, display: string): this;
	addOptions(options: Record<string, string>): this;
	setValue(value: string): this;
	onChange(callback: (value: string) => any): this;
	selectEl: HTMLSelectElement;
}

interface ButtonComponent {
	setButtonText(name: string): this;
	setIcon(icon: string): this;
	setTooltip(tooltip: string): this;
	setCta(): this; // call-to-action styling
	setWarning(): this; // warning styling
	setDisabled(disabled: boolean): this;
	onClick(callback: (evt: MouseEvent) => any): this;
	buttonEl: HTMLButtonElement;
}

interface SliderComponent {
	setValue(value: number): this;
	setLimits(min: number, max: number, step: number | 'any'): this;
	setDynamicTooltip(): this;
	onChange(callback: (value: number) => any): this;
	setDisabled(disabled: boolean): this;
	sliderEl: HTMLInputElement;
}
```

### PluginSettingTab

```typescript
abstract class PluginSettingTab extends SettingTab {
	plugin: Plugin;
	constructor(app: App, plugin: Plugin);
	containerEl: HTMLElement;
	abstract display(): void;
	hide(): void;
}
```

### Notice

Toast notification.

```typescript
class Notice {
	noticeEl: HTMLElement;
	constructor(message: string | DocumentFragment, timeout?: number);
	setMessage(message: string | DocumentFragment): this;
	hide(): void;
}
```

### Menu

Context menu.

```typescript
class Menu extends Component {
	addItem(cb: (item: MenuItem) => any): this;
	addSeparator(): this;
	showAtMouseEvent(event: MouseEvent): this;
	showAtPosition(position: Point): this;
	hide(): this;
}

class MenuItem {
	setTitle(title: string | DocumentFragment): this;
	setIcon(icon: string): this;
	setChecked(checked: boolean | null): this;
	setDisabled(disabled: boolean): this;
	setIsLabel(isLabel: boolean): this;
	setSection(section: string): this;
	onClick(callback: (evt: MouseEvent | KeyboardEvent) => any): this;
}
```

## Rendering

### MarkdownRenderer

```typescript
class MarkdownRenderer {
	static render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void>;

	static renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void>;
}
```

### Markdown post processing

```typescript
type MarkdownPostProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<any> | void;

interface MarkdownPostProcessorContext {
	docId: string;
	sourcePath: string;
	frontmatter: any | null | undefined;
	addChild(child: MarkdownRenderChild): void;
	getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null;
}

class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement);
}
```

## Network

### requestUrl

Cross-platform HTTP requests (works on desktop + mobile).

```typescript
function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse>;

interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean; // Throw on HTTP error status codes (default: true)
}

interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: any;
	text: string;
}
```

## HTML Element Extensions

Obsidian extends the global HTMLElement prototype with helper methods:

```typescript
interface HTMLElement {
	createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		o?: DomElementInfo | string,
		callback?: (el: HTMLElementTagNameMap[K]) => void
	): HTMLElementTagNameMap[K];
	createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
	createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
	empty(): void;
	addClass(...classes: string[]): void;
	removeClass(...classes: string[]): void;
	toggleClass(classes: string | string[], value: boolean): void;
}

interface DomElementInfo {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	parent?: Node;
	value?: string;
	type?: string;
	prepend?: boolean;
	placeholder?: string;
	href?: string;
}
```

## Global Utility Functions

```typescript
/** Set an icon on an element using Lucide icon names. */
function setIcon(parent: HTMLElement, iconId: string): void;

/** Set a tooltip on an element. */
function setTooltip(el: HTMLElement, tooltip: string, options?: TooltipOptions): void;

/** Normalize a vault path. */
function normalizePath(path: string): string;

/** Debounce a function. */
function debounce(cb: (...args: any[]) => any, timeout: number, resetTimer?: boolean): Debouncer<any>;

/** Parse frontmatter from a string. */
function parseFrontMatterAliases(frontmatter: any): string[] | null;
function parseFrontMatterTags(frontmatter: any): string[] | null;
function parseFrontMatterStringArray(frontmatter: any, key: string): string[] | null;
function parseFrontMatterEntry(frontmatter: any, key: string | RegExp): any;

/** Get all Lucide icon names available. */
function getIconIds(): string[];

/** Add a custom icon (SVG). */
function addIcon(iconId: string, svgContent: string): void;
```

## EditorSuggest (Autocomplete)

```typescript
abstract class EditorSuggest<T> extends PopoverSuggest<T> {
	context: EditorSuggestContext | null;

	/** Return the trigger info if the cursor is in a position that should show suggestions. */
	abstract onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null;

	/** Generate suggestion items from the trigger. */
	abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;

	/** Render a suggestion item in the dropdown. */
	abstract renderSuggestion(value: T, el: HTMLElement): void;

	/** Apply the selected suggestion. */
	abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

interface EditorSuggestTriggerInfo {
	start: EditorPosition;
	end: EditorPosition;
	query: string;
}

interface EditorSuggestContext extends EditorSuggestTriggerInfo {
	editor: Editor;
	file: TFile;
}
```

## FuzzyMatch (Search)

```typescript
abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
	abstract getItems(): T[];
	abstract getItemText(item: T): string;
	abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
}

abstract class SuggestModal<T> extends Modal {
	abstract getSuggestions(query: string): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, el: HTMLElement): void;
	abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
	setPlaceholder(placeholder: string): void;
	setInstructions(instructions: Instruction[]): void;
	inputEl: HTMLInputElement;
	resultContainerEl: HTMLElement;
}
```
