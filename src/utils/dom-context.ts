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
function getDOMContext(element: HTMLElement) {
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
 *
 * This is a last-resort fallback: the sole caller (the agent input paste handler)
 * tries the async Clipboard API (`navigator.clipboard.readText`) first and only
 * falls back here when it is unavailable or throws (e.g. some popout-window
 * contexts). `document.execCommand` is deprecated but remains the only synchronous
 * fallback for those environments, so the deprecation is intentionally suppressed.
 */
export function execContextCommand(element: HTMLElement, command: string, value?: string): boolean {
	const { doc } = getDOMContext(element);
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	return doc.execCommand(command, false, value);
}
