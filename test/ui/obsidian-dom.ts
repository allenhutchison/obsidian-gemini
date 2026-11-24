/**
 * Obsidian's element-factory sugar (`createEl`, `createDiv`, `empty`, ...) for
 * jsdom, so a modal under test can render into a real DOM that the test then
 * queries and clicks. Installs on `HTMLElement.prototype`, only where a helper
 * is missing, so a file that calls it gets the sugar on every element.
 *
 * Kept to the options the modals actually pass (#1596). Add one here when a
 * new test needs it rather than growing per-test copies.
 */

interface CreateElOptions {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	href?: string;
	title?: string;
	placeholder?: string;
	type?: string;
	value?: string;
}

type Sugar = {
	createEl(tag: string, opts?: CreateElOptions): HTMLElement;
	createDiv(opts?: CreateElOptions): HTMLElement;
	createSpan(opts?: CreateElOptions): HTMLElement;
	empty(): void;
	addClass(...classes: string[]): void;
	removeClass(...classes: string[]): void;
	hasClass(cls: string): boolean;
	setText(text: string): void;
};

export function installObsidianDom(): void {
	const proto = HTMLElement.prototype as unknown as Sugar & Record<string, unknown>;
	const define = <K extends keyof Sugar>(name: K, fn: Sugar[K]) => {
		if (typeof proto[name] !== 'function') proto[name] = fn as never;
	};

	define('createEl', function (this: HTMLElement, tag: string, opts: CreateElOptions = {}) {
		const el = document.createElement(tag);
		const classes = Array.isArray(opts.cls) ? opts.cls : opts.cls ? opts.cls.split(' ') : [];
		for (const c of classes) if (c) el.classList.add(c);
		if (opts.text !== undefined) el.textContent = opts.text;
		if (opts.href !== undefined) el.setAttribute('href', opts.href);
		if (opts.title !== undefined) el.setAttribute('title', opts.title);
		if (opts.placeholder !== undefined) el.setAttribute('placeholder', opts.placeholder);
		if (opts.type !== undefined) el.setAttribute('type', opts.type);
		if (opts.value !== undefined) (el as HTMLInputElement).value = opts.value;
		for (const [k, v] of Object.entries(opts.attr ?? {})) {
			if (v !== null && v !== false) el.setAttribute(k, String(v));
		}
		this.appendChild(el);
		return el;
	});
	define('createDiv', function (this: HTMLElement, opts?: CreateElOptions) {
		return (this as unknown as Sugar).createEl('div', opts);
	});
	define('createSpan', function (this: HTMLElement, opts?: CreateElOptions) {
		return (this as unknown as Sugar).createEl('span', opts);
	});
	define('empty', function (this: HTMLElement) {
		this.replaceChildren();
	});
	define('addClass', function (this: HTMLElement, ...classes: string[]) {
		this.classList.add(...classes);
	});
	define('removeClass', function (this: HTMLElement, ...classes: string[]) {
		this.classList.remove(...classes);
	});
	define('hasClass', function (this: HTMLElement, cls: string) {
		return this.classList.contains(cls);
	});
	define('setText', function (this: HTMLElement, text: string) {
		this.textContent = text;
	});
}
