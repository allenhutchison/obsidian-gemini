/**
 * Utility for formatting model responses for proper markdown rendering.
 *
 * Gemini returns text with single newlines between paragraphs, but Obsidian's
 * markdown renderer requires double newlines for paragraph breaks. This module
 * converts single newlines to double newlines while preserving table formatting,
 * which relies on single newlines between rows.
 */

/** Matches a markdown table divider line (e.g. | --- | :---: |). */
const TABLE_DIVIDER_RE = /^[\s|]*[:?\-]+\s*\|/;

/** Returns true if the line contains at least one unescaped pipe character. */
function hasUnescapedPipe(line: string): boolean {
	return line.split('\\|').join('').includes('|');
}

/**
 * Format a model response for proper markdown rendering.
 *
 * Inserts blank lines between consecutive non-empty text lines so they render
 * as separate paragraphs, while leaving markdown table blocks untouched.
 */
export function formatModelMessage(text: string): string {
	const lines = text.split('\n');
	const formattedLines: string[] = [];
	let inTable = false;
	let previousLineWasEmpty = true;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const nextLine = lines[i + 1];
		const trimmedLine = line.trim();

		const lineHasPipe = hasUnescapedPipe(line);
		const isTableDivider = TABLE_DIVIDER_RE.test(line);
		const isTableRow = lineHasPipe && !isTableDivider && trimmedLine !== '|';

		// Check if we're starting a table
		if ((isTableRow || isTableDivider) && !inTable) {
			inTable = true;
			// Add empty line before table if needed
			if (!previousLineWasEmpty && formattedLines.length > 0) {
				formattedLines.push('');
			}
		}

		// Add the current line
		formattedLines.push(line);

		// Check if we're ending a table
		if (inTable && !lineHasPipe && trimmedLine !== '') {
			inTable = false;
			// Add empty line after table
			formattedLines.push('');
		} else if (inTable && trimmedLine === '') {
			// Empty line also ends a table
			inTable = false;
		}

		// For non-table content, add empty line between paragraphs
		if (
			!inTable &&
			!lineHasPipe &&
			trimmedLine !== '' &&
			nextLine &&
			nextLine.trim() !== '' &&
			!nextLine.includes('|')
		) {
			formattedLines.push('');
		}

		previousLineWasEmpty = trimmedLine === '';
	}

	return formattedLines.join('\n');
}
