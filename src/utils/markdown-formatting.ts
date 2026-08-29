/**
 * Utility for formatting model responses for proper markdown rendering.
 *
 * Gemini returns text with single newlines between paragraphs, but Obsidian's
 * markdown renderer requires double newlines for paragraph breaks. This module
 * converts single newlines to double newlines while preserving table formatting,
 * which relies on single newlines between rows, and fenced code blocks, whose
 * content must pass through verbatim (#1379).
 *
 * Also handles unescaping of WikiLinks that Gemini sometimes wraps in backtick
 * code spans or backslash-escapes, which prevents Obsidian from rendering them
 * as clickable internal links.
 */

/** Matches a markdown table divider line (e.g. | --- | :---: |). */
const tableDividerRe = /^[\s|]*[:?-]+\s*\|/;

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
	// Set to the fence run that opened the block ('```', '```…', '~~~'…): the
	// fence only closes on the same character with an equal-or-longer run
	// followed by whitespace only, per CommonMark — so a '```ts' line inside a
	// ```-fence stays content (#1379).
	let fenceMarker: string | null = null;
	let previousLineWasEmpty = true;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const nextLine = lines[i + 1];
		const trimmedLine = line.trim();

		// Track fenced code blocks: fenced content passes through verbatim —
		// blank-line insertion inside a fence double-spaces every code line. Per
		// CommonMark the fence closes on the same character with an
		// equal-or-longer run followed by whitespace only — a '```ts' or
		// '~~~text' line inside a fence stays content.
		if (fenceMarker) {
			const closeMatch = trimmedLine.match(/^(`{3,}|~{3,})\s*$/);
			const isClosing =
				closeMatch !== null && closeMatch[1][0] === fenceMarker[0] && closeMatch[1].length >= fenceMarker.length;
			formattedLines.push(line);
			if (isClosing) {
				fenceMarker = null;
				// Blank line after a closing fence when followed by text — mirrors
				// the paragraph-break rule so the next line starts its own block.
				if (nextLine && nextLine.trim() !== '' && formattedLines[formattedLines.length - 1] !== '') {
					formattedLines.push('');
				}
			}
			previousLineWasEmpty = trimmedLine === '';
			continue;
		}

		const fenceOpen = trimmedLine.match(/^(`{3,}|~{3,})/);
		if (fenceOpen) {
			inTable = false; // a fence can never be part of a table
			formattedLines.push(line);
			fenceMarker = fenceOpen[1];
			previousLineWasEmpty = false;
			continue;
		}

		const lineHasPipe = hasUnescapedPipe(line);
		const isTableDivider = tableDividerRe.test(line);
		const isTableRow = lineHasPipe && !isTableDivider && trimmedLine !== '|';

		// Check if we're starting a table
		if ((isTableRow || isTableDivider) && !inTable) {
			inTable = true;
			// Add empty line before table if needed
			if (!previousLineWasEmpty && formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== '') {
				formattedLines.push('');
			}
		}

		// Check if we're ending a table: the first non-empty line without a pipe
		// ends it, and the separating blank line goes BEFORE that line — so the
		// table closes as its own block and never leaves a trailing newline at
		// end of message.
		if (inTable && !lineHasPipe && trimmedLine !== '') {
			inTable = false;
			if (formattedLines[formattedLines.length - 1] !== '') {
				formattedLines.push('');
			}
		} else if (inTable && trimmedLine === '') {
			// Empty line also ends a table
			inTable = false;
		}

		// Add the current line
		formattedLines.push(line);

		// For non-table content, add empty line between paragraphs
		if (
			!inTable &&
			!lineHasPipe &&
			trimmedLine !== '' &&
			nextLine &&
			nextLine.trim() !== '' &&
			!hasUnescapedPipe(nextLine) &&
			formattedLines[formattedLines.length - 1] !== ''
		) {
			formattedLines.push('');
		}

		previousLineWasEmpty = trimmedLine === '';
	}

	return unescapeWikiLinks(formattedLines.join('\n'));
}

/**
 * Remove backtick wrapping and backslash escaping from WikiLinks.
 *
 * Gemini sometimes wraps [[WikiLinks]] in backtick code spans or
 * backslash-escapes the brackets, which prevents Obsidian's renderer
 * from making them clickable. This function fixes those patterns
 * while leaving fenced code blocks and multi-backtick code spans intact.
 */
export function unescapeWikiLinks(text: string): string {
	if (!text) return text;

	// Split on fenced code blocks (``` … ``` or ~~~ … ~~~), preserving delimiters.
	// Odd-indexed segments are inside code fences.
	const parts = text.split(/((?:`{3,}|~{3,})[\s\S]*?(?:`{3,}|~{3,}))/);

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 !== 0) continue; // Skip fenced code blocks

		let segment = parts[i];

		// Strip single-backtick wrapping: `[[note]]` → [[note]]
		// The leading (^|[^`]) group and the (?!`) lookahead prevent matching
		// multi-backtick spans. A consuming group is used instead of a negative
		// lookbehind because lookbehind is only supported on iOS 16.4+ (see
		// .claude/guidelines/coding.md) and would crash plugin load on older iOS.
		segment = segment.replace(/(^|[^`])`(\[\[[^\]]+\]\])`(?!`)/g, '$1$2');

		// Fix fully backslash-escaped brackets: \[\[note\]\] → [[note]]
		segment = segment.replace(/\\\[\\\[([^\]]+)\\\]\\\]/g, '[[$1]]');

		// Fix partially backslash-escaped brackets: \[[note\]] → [[note]]
		segment = segment.replace(/\\\[\[([^\]]+)\\\]\]/g, '[[$1]]');

		parts[i] = segment;
	}

	return parts.join('');
}
