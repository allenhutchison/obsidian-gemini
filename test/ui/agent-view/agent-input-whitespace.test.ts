import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard for #1669.
 *
 * The agent input is a contenteditable div. Pasted text is inserted as a text
 * node containing literal `\n`s (`insertTextAtCursor`), and the send path reads
 * the message back with `innerText`. Under the default `white-space: normal`,
 * those newlines collapse to spaces both on screen and in `innerText`, so a
 * multi-line paste reached the model as a single line.
 *
 * jsdom does no layout, so `innerText` collapsing can't be reproduced here —
 * assert the stylesheet rule that prevents it instead.
 */
describe('agent input whitespace (#1669)', () => {
	it('preserves newlines in the rich input via white-space: pre-wrap', () => {
		const css = readFileSync(join(__dirname, '../../../styles.css'), 'utf8');
		const rule = css.match(/\.gemini-agent-input-rich\s*\{([^}]*)\}/);
		expect(rule).not.toBeNull();
		expect(rule![1]).toMatch(/white-space:\s*pre-wrap\s*;/);
	});
});
