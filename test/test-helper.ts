export function attachObsidianMockMethods(el: any) {
	if (!el) return el;

	// Basic methods
	el.empty = function () {
		this.innerHTML = '';
	};
	el.addClass = function (cls: string) {
		this.classList.add(cls);
	};

	// DOM creation methods
	const createFn = (tag: string, opts?: any) => {
		const elem = document.createElement(tag);
		if (opts?.cls) elem.className = opts.cls;
		if (opts?.text) elem.textContent = opts.text;
		if (opts?.attr) {
			for (const key in opts.attr) {
				elem.setAttribute(key, opts.attr[key]);
			}
		}

		// Recursively attach methods to created elements
		attachObsidianMockMethods(elem);

		return elem;
	};

	el.createDiv = function (opts?: any) {
		const div = createFn('div', opts);
		this.appendChild(div);
		return div;
	};

	el.createSpan = function (opts?: any) {
		const span = createFn('span', opts);
		this.appendChild(span);
		return span;
	};

	el.createEl = function (tag: string, opts?: any) {
		const elem = createFn(tag, opts);
		this.appendChild(elem);
		return elem;
	};

	return el;
}
