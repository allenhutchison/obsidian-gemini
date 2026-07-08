// Global test setup.
//
// Obsidian extends HTMLElement.prototype with DOM helpers (show/hide/toggle,
// toggleClass, ...) at runtime; the type declarations come from the obsidian
// package's global augmentation. jsdom doesn't provide the runtime side, so
// give unit tests minimal-faithful implementations of the helpers the plugin
// uses. Kept intentionally small -- richer per-test mocks (createDiv/createEl
// with cls/text options) stay in the tests that need them.

if (typeof HTMLElement !== 'undefined') {
	const proto = HTMLElement.prototype;
	if (typeof proto.hide !== 'function') {
		proto.hide = function (this: HTMLElement): void {
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment -- this IS the polyfill of Obsidian's hide(), which sets inline display
			this.style.display = 'none';
		};
		proto.show = function (this: HTMLElement): void {
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment -- polyfill of Obsidian's show()
			this.style.display = '';
		};
		proto.toggle = function (this: HTMLElement, show: boolean): void {
			if (show) this.show();
			else this.hide();
		};
	}
	if (typeof proto.toggleClass !== 'function') {
		proto.toggleClass = function (this: HTMLElement, classes: string | string[], value: boolean): void {
			for (const cls of Array.isArray(classes) ? classes : [classes]) {
				this.classList.toggle(cls, value);
			}
		};
	}
}

export {};
