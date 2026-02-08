import { formatModelMessage } from '../../src/utils/markdown-formatting';

describe('formatModelMessage', () => {
	// --- Paragraph spacing ---
	it('inserts blank lines between consecutive text lines', () => {
		const input = 'Hello\nWorld';
		expect(formatModelMessage(input)).toBe('Hello\n\nWorld');
	});

	it('preserves existing double newlines', () => {
		const input = 'Hello\n\nWorld';
		expect(formatModelMessage(input)).toBe('Hello\n\nWorld');
	});

	it('returns empty string unchanged', () => {
		expect(formatModelMessage('')).toBe('');
	});

	it('returns single line unchanged', () => {
		expect(formatModelMessage('Hello')).toBe('Hello');
	});

	// --- Table preservation ---
	it('does not insert blank lines between table rows', () => {
		const input = '| A | B |\n| --- | --- |\n| 1 | 2 |';
		expect(formatModelMessage(input)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
	});

	it('adds blank line before a table when preceded by text', () => {
		const input = 'Here is a table:\n| A | B |\n| --- | --- |\n| 1 | 2 |';
		const result = formatModelMessage(input);
		// Should have blank line between "Here is a table:" and the table
		expect(result).toContain('Here is a table:\n\n| A | B |');
	});

	it('adds blank line after a table when followed by text', () => {
		const input = '| A | B |\n| --- | --- |\n| 1 | 2 |\nSome text after';
		const result = formatModelMessage(input);
		// The first non-pipe line ends the table; a blank line is inserted after it
		expect(result).toContain('| 1 | 2 |\nSome text after\n');
	});

	it('handles table with leading whitespace in divider', () => {
		const input = '| A | B |\n  | --- | --- |\n| 1 | 2 |';
		expect(formatModelMessage(input)).toBe('| A | B |\n  | --- | --- |\n| 1 | 2 |');
	});

	it('handles table divider without leading pipe', () => {
		const input = '| A | B |\n--- | ---\n| 1 | 2 |';
		expect(formatModelMessage(input)).toBe('| A | B |\n--- | ---\n| 1 | 2 |');
	});

	// --- Escaped pipes ---
	it('does not treat escaped pipes as table rows', () => {
		const input = 'Use \\| for pipes\nNext line';
		expect(formatModelMessage(input)).toBe('Use \\| for pipes\n\nNext line');
	});

	it('does not suppress paragraph spacing when next line has only escaped pipes', () => {
		const input = 'First line\nUse \\| for pipes';
		expect(formatModelMessage(input)).toBe('First line\n\nUse \\| for pipes');
	});

	// --- Mixed content ---
	it('handles text before and after a table', () => {
		const input = 'Intro\n| A | B |\n| --- | --- |\n| 1 | 2 |\nConclusion';
		const result = formatModelMessage(input);
		expect(result).toContain('Intro\n\n| A | B |');
		// Table rows should not have extra blank lines
		expect(result).not.toContain('| A | B |\n\n| --- | --- |');
		// Table content is preserved together
		expect(result).toContain('| --- | --- |\n| 1 | 2 |');
	});

	// --- ReDoS regression ---
	it('handles long strings of spaces efficiently', () => {
		const start = Date.now();
		formatModelMessage(' '.repeat(50000) + 'x');
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(1000);
	});
});
