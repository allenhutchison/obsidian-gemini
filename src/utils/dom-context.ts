/**
 * Utility functions for handling DOM operations in both main and popout windows.
 *
 * In Obsidian, when a view is popped out to a separate window, the global
 * `document` and `window` objects still refer to the main app's context.
 * This can cause issues with DOM operations like selection, range manipulation,
 * and element creation.
 *
 * These utilities ensure DOM operations use the correct document/window context
 * based on where the element actually lives.
 */

/**
 * Get the correct document and window context for a DOM element.
 * This handles both main window and popout window scenarios.
 */
export function getDOMContext(element: HTMLElement) {
	const doc = element.ownerDocument;
	const win = doc.defaultView || window;

	return { doc, win };
}

/**
 * Get the current selection for an element's context.
 * Returns null if no selection is available.
 */
export function getContextSelection(element: HTMLElement): Selection | null {
	const { win } = getDOMContext(element);
	return win.getSelection();
}

/**
 * Create a new Range in the correct document context.
 */
export function createContextRange(element: HTMLElement): Range {
	const { doc } = getDOMContext(element);
	return doc.createRange();
}

/**
 * Create a new DOM element in the correct document context.
 */
export function createContextElement<K extends keyof HTMLElementTagNameMap>(
	contextElement: HTMLElement,
	tagName: K
): HTMLElementTagNameMap[K] {
	const { doc } = getDOMContext(contextElement);
	return doc.createElement(tagName);
}

/**
 * Create a text node in the correct document context.
 */
export function createContextTextNode(contextElement: HTMLElement, text: string): Text {
	const { doc } = getDOMContext(contextElement);
	return doc.createTextNode(text);
}

/**
 * Insert text at the current cursor position within an element.
 * Handles both main window and popout window contexts.
 */
export function insertTextAtCursor(element: HTMLElement, text: string): void {
	const { doc, win } = getDOMContext(element);
	const selection = win.getSelection();

	if (!selection || selection.rangeCount === 0) {
		// No selection, append to end
		element.appendChild(doc.createTextNode(text));

		// Move cursor to end - only if we have a selection object
		if (selection) {
			const range = doc.createRange();
			range.selectNodeContents(element);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		}
		return;
	}

	const range = selection.getRangeAt(0);

	// Ensure the range is within our element
	if (element.contains(range.commonAncestorContainer)) {
		range.deleteContents();

		// Insert text node
		const textNode = doc.createTextNode(text);
		range.insertNode(textNode);

		// Move cursor to end of inserted text
		range.setStartAfter(textNode);
		range.setEndAfter(textNode);
		selection.removeAllRanges();
		selection.addRange(range);
	} else {
		// Selection is outside our element, append to end
		element.appendChild(doc.createTextNode(text));

		// Move cursor to end
		const range = doc.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}
}

/**
 * Insert a node at the current cursor position within an element.
 * Handles both main window and popout window contexts.
 */
export function insertNodeAtCursor(element: HTMLElement, node: Node): void {
	const { doc, win } = getDOMContext(element);
	const selection = win.getSelection();

	if (!selection || selection.rangeCount === 0) {
		// No selection, append to end
		element.appendChild(node);

		// Move cursor after the inserted node
		if (selection && node.parentNode) {
			const range = doc.createRange();
			range.setStartAfter(node);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		}
	} else {
		const range = selection.getRangeAt(0);

		// Ensure the range is within our element
		if (element.contains(range.commonAncestorContainer)) {
			range.insertNode(node);

			// Move cursor after the node
			range.setStartAfter(node);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		} else {
			// Selection is outside our element, append to end
			element.appendChild(node);

			// Move cursor after the inserted node
			if (node.parentNode) {
				const range = doc.createRange();
				range.setStartAfter(node);
				range.collapse(true);
				selection.removeAllRanges();
				selection.addRange(range);
			}
		}
	}
}

/**
 * Move cursor to the end of an element's content.
 */
export function moveCursorToEnd(element: HTMLElement): void {
	const { doc, win } = getDOMContext(element);
	const selection = win.getSelection();

	if (selection) {
		const range = doc.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}
}

/**
 * Execute a command in the correct document context.
 * Useful for commands like 'paste', 'copy', etc.
 */
export function execContextCommand(element: HTMLElement, command: string, value?: string): boolean {
	const { doc } = getDOMContext(element);
	return doc.execCommand(command, false, value);
}
