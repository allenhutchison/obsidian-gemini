import { formatToolBlock, formatToolLine, mergeToolBlock } from '../../src/subscribers/tool-execution-logger';
import { ToolResult } from '../../src/tools/types';

function success(data: unknown = {}): ToolResult {
	return { success: true, data };
}

function failure(error: string): ToolResult {
	return { success: false, error };
}

describe('formatToolLine', () => {
	it('renders the configured key param for a mapped tool when the arg is a string', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'notes/foo.md' },
			result: success(),
			durationMs: 50,
		});
		expect(line).toBe('🔧 `read_file` path="notes/foo.md" → success (50ms)');
	});

	it('uses the configured key (sourcePath) for move_file rather than the generic "path"', () => {
		const line = formatToolLine({
			toolName: 'move_file',
			args: { sourcePath: 'a.md', destinationPath: 'b.md' },
			result: success(),
			durationMs: 12,
		});
		expect(line).toBe('🔧 `move_file` sourcePath="a.md" → success (12ms)');
	});

	it('omits the param prefix for mapped tools whose KEY_PARAM_MAP entry is undefined', () => {
		const line = formatToolLine({
			toolName: 'get_workspace_state',
			args: { ignored: 'value' },
			result: success(),
			durationMs: 4,
		});
		expect(line).toBe('🔧 `get_workspace_state` → success (4ms)');
	});

	it('omits the param prefix when the mapped key is missing from args', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: {},
			result: success(),
			durationMs: 3,
		});
		expect(line).toBe('🔧 `read_file` → success (3ms)');
	});

	it('omits the param prefix when the mapped key is present but not a string', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 42 },
			result: success(),
			durationMs: 3,
		});
		expect(line).toBe('🔧 `read_file` → success (3ms)');
	});

	it('falls back to the first string arg for unmapped tools', () => {
		const line = formatToolLine({
			toolName: 'totally_new_tool',
			args: { count: 7, label: 'hello', other: 'world' },
			result: success(),
			durationMs: 8,
		});
		expect(line).toBe('🔧 `totally_new_tool` label="hello" → success (8ms)');
	});

	it('omits the param prefix for unmapped tools when no string arg is present', () => {
		const line = formatToolLine({
			toolName: 'numeric_only_tool',
			args: { count: 7, ratio: 0.5 },
			result: success(),
			durationMs: 1,
		});
		expect(line).toBe('🔧 `numeric_only_tool` → success (1ms)');
	});

	it('renders success status for successful results', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'a.md' },
			result: success(),
			durationMs: 10,
		});
		expect(line).toContain(' → success ');
	});

	it('renders error status with the message for failed results', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'a.md' },
			result: failure('file not found'),
			durationMs: 10,
		});
		expect(line).toBe('🔧 `read_file` path="a.md" → error: file not found (10ms)');
	});

	it('falls back to "unknown" when a failed result carries no error string', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'a.md' },
			result: { success: false },
			durationMs: 10,
		});
		expect(line).toBe('🔧 `read_file` path="a.md" → error: unknown (10ms)');
	});

	it('truncates error messages longer than 60 chars and appends an ellipsis', () => {
		const longError = 'a'.repeat(70);
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'a.md' },
			result: failure(longError),
			durationMs: 10,
		});
		expect(line).toBe(`🔧 \`read_file\` path="a.md" → error: ${'a'.repeat(60)}... (10ms)`);
	});

	it('does not truncate error messages of exactly 60 chars', () => {
		const exactError = 'b'.repeat(60);
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'a.md' },
			result: failure(exactError),
			durationMs: 10,
		});
		expect(line).toBe(`🔧 \`read_file\` path="a.md" → error: ${exactError} (10ms)`);
	});
});

describe('formatToolBlock', () => {
	it('returns just the callout header when given an empty lines array', () => {
		expect(formatToolBlock([])).toBe('> [!tools]- Tool Execution\n');
	});

	it('prefixes each input line with "> " under the callout header', () => {
		const block = formatToolBlock(['line one', 'line two', 'line three']);
		expect(block).toBe('> [!tools]- Tool Execution\n> line one\n> line two\n> line three');
	});

	it('produces a block that can be round-tripped through mergeToolBlock', () => {
		const block = formatToolBlock(['🔧 `read_file` path="a.md" → success (5ms)']);
		expect(block.startsWith('> [!tools]- Tool Execution\n')).toBe(true);
		expect(block).toContain('> 🔧 `read_file`');
	});
});

describe('mergeToolBlock', () => {
	const block = formatToolBlock(['🔧 `read_file` path="a.md" → success (5ms)']);

	it('returns a leading newline plus the block when content is empty', () => {
		// Pin current behavior — the leading newline is intentional and any change
		// should be a deliberate decision, not a silent regression.
		expect(mergeToolBlock('', block)).toBe('\n' + block + '\n');
	});

	it('appends as a new block when content has no existing callout', () => {
		const content = '# Session\n\nSome prose here.\n';
		const merged = mergeToolBlock(content, block);
		expect(merged).toBe(content + '\n' + block + '\n');
	});

	it('merges new lines into an existing trailing callout without duplicating the header', () => {
		const existing = '# Session\n\n> [!tools]- Tool Execution\n> 🔧 `read_file` path="a.md" → success (5ms)';
		const newBlock = formatToolBlock(['🔧 `write_file` path="b.md" → success (8ms)']);
		const merged = mergeToolBlock(existing, newBlock);

		// Header should appear only once.
		expect(merged.match(/> \[!tools\]- Tool Execution/g)).toHaveLength(1);
		// Both tool lines should be present.
		expect(merged).toContain('> 🔧 `read_file` path="a.md"');
		expect(merged).toContain('> 🔧 `write_file` path="b.md"');
		// Order preserved — old line precedes new line.
		expect(merged.indexOf('read_file')).toBeLessThan(merged.indexOf('write_file'));
	});

	it('appends as a new block when a non-blockquote line sits between EOF and the last callout', () => {
		// The backward scan must bail when it hits a non-blockquote, non-empty line,
		// so the earlier callout is invisible to the merge logic.
		const existing = [
			'> [!tools]- Tool Execution',
			'> 🔧 `read_file` path="a.md" → success (5ms)',
			'',
			'Some explanatory prose after the callout.',
		].join('\n');

		const merged = mergeToolBlock(existing, block);

		// Two distinct callouts should now exist — the original and the appended one.
		expect(merged.match(/> \[!tools\]- Tool Execution/g)).toHaveLength(2);
		expect(merged.endsWith(block + '\n')).toBe(true);
	});

	it('merges only into the trailing callout when content has multiple callouts', () => {
		const existing = [
			'# Session',
			'',
			'> [!tools]- Tool Execution',
			'> 🔧 `read_file` path="old.md" → success (1ms)',
			'',
			'> [!tools]- Tool Execution',
			'> 🔧 `read_file` path="recent.md" → success (2ms)',
		].join('\n');

		const newBlock = formatToolBlock(['🔧 `write_file` path="new.md" → success (3ms)']);
		const merged = mergeToolBlock(existing, newBlock);

		// Still exactly two headers — the trailing callout absorbed the new lines,
		// no third callout was appended.
		expect(merged.match(/> \[!tools\]- Tool Execution/g)).toHaveLength(2);
		// The new line should land after the "recent.md" line, in the trailing block.
		expect(merged.indexOf('write_file')).toBeGreaterThan(merged.indexOf('recent.md'));
		// And after the trailing block's header, not after the first.
		const firstHeader = merged.indexOf('> [!tools]- Tool Execution');
		const lastHeader = merged.lastIndexOf('> [!tools]- Tool Execution');
		expect(firstHeader).not.toBe(lastHeader);
		expect(merged.indexOf('write_file')).toBeGreaterThan(lastHeader);
	});

	it('treats content not ending in a newline the same as content that does', () => {
		const withNewline = '# Session\n\n> [!tools]- Tool Execution\n> 🔧 `read_file` path="a.md" → success (5ms)\n';
		const withoutNewline = withNewline.trimEnd();

		const newBlock = formatToolBlock(['🔧 `write_file` path="b.md" → success (8ms)']);
		const mergedWith = mergeToolBlock(withNewline, newBlock);
		const mergedWithout = mergeToolBlock(withoutNewline, newBlock);

		expect(mergedWith).toBe(mergedWithout);
	});

	it('does not fold a new tool line into a trailing [!reasoning] callout (#1050)', () => {
		// A prior tool batch exists earlier in the file, then a reasoning-only turn
		// was written. The backward scan must NOT walk past the reasoning callout to
		// match the earlier [!tools] header and splice the new line onto the end —
		// which lands it inside the reasoning callout. It must start a fresh block.
		const existing = [
			'# Chat History',
			'',
			'> [!tools]- Tool Execution',
			'> 🔧 `read_file` path="a.md" → success (5ms)',
			'',
			'> [!reasoning]- Reasoning',
			'> Okay, I should search the web for this.',
			'', // template writes a trailing blank line after the reasoning callout
		].join('\n');

		const newBlock = formatToolBlock(['🔧 `google_search` query="AB 2047 bill" → success (28718ms)']);
		const merged = mergeToolBlock(existing, newBlock);

		// The new tool line lands in its OWN [!tools] callout — two headers now.
		expect(merged.match(/> \[!tools\]- Tool Execution/g)).toHaveLength(2);
		// A blank line separates the reasoning callout from the new tools callout.
		expect(merged).toContain('> Okay, I should search the web for this.\n\n> [!tools]- Tool Execution');
		// The 🔧 line sits under the new tools header, never as a reasoning continuation.
		const reasoningIdx = merged.indexOf('> [!reasoning]- Reasoning');
		const newHeaderIdx = merged.lastIndexOf('> [!tools]- Tool Execution');
		expect(newHeaderIdx).toBeGreaterThan(reasoningIdx);
		expect(merged.indexOf('google_search')).toBeGreaterThan(newHeaderIdx);
	});

	it('separates a fresh tools block from a preceding reasoning callout with a blank line', () => {
		// Even with no earlier tools callout, appending after a reasoning callout
		// must insert a blank-line separator so the blockquotes do not merge.
		const existing = '> [!reasoning]- Reasoning\n> Thinking about it.\n';
		const merged = mergeToolBlock(existing, block);

		expect(merged.match(/> \[!tools\]- Tool Execution/g)).toHaveLength(1);
		expect(merged).toContain('> Thinking about it.\n\n> [!tools]- Tool Execution');
	});
});
