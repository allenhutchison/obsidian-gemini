import { formatToolLine, formatToolBlock } from '../../src/services/tool-execution-logger';

describe('formatToolLine', () => {
	it('should format a successful read_file', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'README.md' },
			result: { success: true, data: { path: 'README.md' } },
			durationMs: 245,
		});
		expect(line).toBe('🔧 `read_file` path="README.md" → success (245ms)');
	});

	it('should format a successful write_file', () => {
		const line = formatToolLine({
			toolName: 'write_file',
			args: { path: 'src/main.ts', content: 'code...' },
			result: { success: true, data: { path: 'src/main.ts' } },
			durationMs: 120,
		});
		expect(line).toBe('🔧 `write_file` path="src/main.ts" → success (120ms)');
	});

	it('should format a successful google_search', () => {
		const line = formatToolLine({
			toolName: 'google_search',
			args: { query: 'TypeScript generics' },
			result: { success: true, data: { query: 'TypeScript generics' } },
			durationMs: 1500,
		});
		expect(line).toBe('🔧 `google_search` query="TypeScript generics" → success (1500ms)');
	});

	it('should format a successful move_file', () => {
		const line = formatToolLine({
			toolName: 'move_file',
			args: { sourcePath: 'old/note.md', targetPath: 'new/note.md' },
			result: { success: true, data: {} },
			durationMs: 50,
		});
		expect(line).toBe('🔧 `move_file` sourcePath="old/note.md" → success (50ms)');
	});

	it('should format a failed tool with error message', () => {
		const line = formatToolLine({
			toolName: 'read_file',
			args: { path: 'missing.md' },
			result: { success: false, error: 'File not found' },
			durationMs: 10,
		});
		expect(line).toBe('🔧 `read_file` path="missing.md" → error: File not found (10ms)');
	});

	it('should truncate long error messages', () => {
		const line = formatToolLine({
			toolName: 'write_file',
			args: { path: 'test.md' },
			result: { success: false, error: 'A'.repeat(100) },
			durationMs: 5,
		});
		expect(line).toContain('→ error: ' + 'A'.repeat(60) + '...');
	});

	it('should handle unknown tool with first string arg as fallback', () => {
		const line = formatToolLine({
			toolName: 'custom_tool',
			args: { input: 'hello world', count: 5 },
			result: { success: true },
			durationMs: 30,
		});
		expect(line).toBe('🔧 `custom_tool` input="hello world" → success (30ms)');
	});

	it('should handle tool with no string args', () => {
		const line = formatToolLine({
			toolName: 'some_tool',
			args: { count: 5, flag: true },
			result: { success: true },
			durationMs: 15,
		});
		expect(line).toBe('🔧 `some_tool` → success (15ms)');
	});

	it('should handle empty args', () => {
		const line = formatToolLine({
			toolName: 'get_active_file',
			args: {},
			result: { success: true, data: { path: 'test.md' } },
			durationMs: 5,
		});
		expect(line).toBe('🔧 `get_active_file` → success (5ms)');
	});

	it('should format fetch_url with url param', () => {
		const line = formatToolLine({
			toolName: 'fetch_url',
			args: { url: 'https://example.com', query: 'test' },
			result: { success: true },
			durationMs: 800,
		});
		expect(line).toBe('🔧 `fetch_url` url="https://example.com" → success (800ms)');
	});

	it('should format search_file_contents with query param', () => {
		const line = formatToolLine({
			toolName: 'search_file_contents',
			args: { query: 'TODO' },
			result: { success: true, data: { results: [] } },
			durationMs: 200,
		});
		expect(line).toBe('🔧 `search_file_contents` query="TODO" → success (200ms)');
	});
});

describe('formatToolBlock', () => {
	it('should wrap lines in a collapsible callout', () => {
		const block = formatToolBlock([
			'🔧 `read_file` path="a.md" → success (10ms)',
			'🔧 `write_file` path="b.md" → success (20ms)',
		]);
		expect(block).toBe(
			'> [!tools]- Tool Execution\n> 🔧 `read_file` path="a.md" → success (10ms)\n> 🔧 `write_file` path="b.md" → success (20ms)'
		);
	});

	it('should handle single line', () => {
		const block = formatToolBlock(['🔧 `read_file` path="a.md" → success (10ms)']);
		expect(block).toBe('> [!tools]- Tool Execution\n> 🔧 `read_file` path="a.md" → success (10ms)');
	});
});
