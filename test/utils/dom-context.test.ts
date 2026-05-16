import {
	getContextSelection,
	createContextRange,
	insertTextAtCursor,
	moveCursorToEnd,
	execContextCommand,
} from '../../src/utils/dom-context';

describe('dom-context utils', () => {
	let element: HTMLDivElement;

	beforeEach(() => {
		// Create a target container and attach to body so selections can work properly
		element = document.createElement('div');
		element.contentEditable = 'true';
		document.body.appendChild(element);
	});

	afterEach(() => {
		document.body.removeChild(element);
		window.getSelection()?.removeAllRanges();
	});

	describe('getContextSelection', () => {
		test('retrieves current selection object', () => {
			const sel = getContextSelection(element);
			expect(sel).toBeDefined();
			expect(sel).toBe(window.getSelection());
		});
	});

	describe('createContextRange', () => {
		test('creates a valid Range object in the correct document context', () => {
			const range = createContextRange(element);
			expect(range).toBeInstanceOf(Range);
			expect(range.startContainer).toBe(document);
		});
	});

	describe('insertTextAtCursor', () => {
		test('case 1: no selection -> appends text and sets cursor to the end', () => {
			insertTextAtCursor(element, 'hello');
			expect(element.textContent).toBe('hello');

			const sel = window.getSelection();
			expect(sel).toBeDefined();
			expect(sel!.rangeCount).toBe(1);
			const range = sel!.getRangeAt(0);
			expect(range.collapsed).toBe(true);
			expect(range.startContainer).toBe(element);
			expect(range.startOffset).toBe(element.childNodes.length);
		});

		test('case 2: selection exists inside element -> inserts text at selection and moves cursor after it', () => {
			element.textContent = 'original text';
			const textNode = element.firstChild!;

			// Select 'original ' (offset 0 to 9)
			const range = document.createRange();
			range.setStart(textNode, 0);
			range.setEnd(textNode, 9);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);

			insertTextAtCursor(element, 'new ');
			expect(element.textContent).toBe('new text');

			const newSel = window.getSelection()!;
			const newRange = newSel.getRangeAt(0);
			expect(newRange.collapsed).toBe(true);
			// Cursor should be directly after the inserted text node 'new '
			const precedingNode = element.childNodes[newRange.startOffset - 1];
			expect(precedingNode).toBeDefined();
			expect(precedingNode!.textContent).toBe('new ');
		});

		test('case 3: selection is outside target element -> behaves like case 1 (appends to end)', () => {
			const externalElement = document.createElement('div');
			document.body.appendChild(externalElement);
			try {
				externalElement.textContent = 'outside';

				// Select external element
				const range = document.createRange();
				range.selectNodeContents(externalElement);
				const sel = window.getSelection()!;
				sel.removeAllRanges();
				sel.addRange(range);

				element.textContent = 'inside';
				insertTextAtCursor(element, ' text');

				expect(element.textContent).toBe('inside text');

				const newSel = window.getSelection()!;
				const newRange = newSel.getRangeAt(0);
				expect(newRange.startContainer).toBe(element);
				expect(newRange.collapsed).toBe(true);
			} finally {
				document.body.removeChild(externalElement);
			}
		});
	});

	describe('moveCursorToEnd', () => {
		test('positions the cursor at the end of the element contents', () => {
			element.textContent = 'lorem ipsum';

			moveCursorToEnd(element);

			const sel = window.getSelection()!;
			expect(sel.rangeCount).toBe(1);
			const range = sel.getRangeAt(0);
			expect(range.collapsed).toBe(true);
			expect(range.startContainer).toBe(element);
			expect(range.startOffset).toBe(element.childNodes.length);
		});
	});

	describe('execContextCommand', () => {
		test('delegates to document.execCommand', () => {
			(document as any).execCommand = vi.fn().mockReturnValue(true);
			const spy = vi.spyOn(document, 'execCommand');
			const result = execContextCommand(element, 'selectAll');
			expect(result).toBe(true);
			expect(spy).toHaveBeenCalledWith('selectAll', false, undefined);
			spy.mockRestore();
			delete (document as any).execCommand;
		});
	});
});
