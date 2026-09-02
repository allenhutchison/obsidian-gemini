import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPToolWrapper } from '../../src/mcp/mcp-tool-wrapper';
import { MCP_CALL_TOOL_TIMEOUT_MS } from '../../src/mcp/mcp-constants';
import { ToolClassification } from '../../src/types/tool-policy';

function makeClient(callToolImpl: () => Promise<any>) {
	return {
		callTool: vi.fn().mockImplementation(callToolImpl),
	} as any;
}

describe('MCPToolWrapper', () => {
	describe('execute', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		test('returns success with concatenated text content when callTool resolves', async () => {
			const client = makeClient(() =>
				Promise.resolve({
					content: [{ type: 'text', text: 'hello' }],
				})
			);
			const wrapper = new MCPToolWrapper(client, 'srv', { name: 'do_thing' });

			const result = await wrapper.execute({}, {} as any);

			expect(result.success).toBe(true);
			expect(result.data).toBe('hello');
			expect(client.callTool).toHaveBeenCalledWith({ name: 'do_thing', arguments: {} });
		});

		test('returns success=false with timeout message when callTool never settles', async () => {
			const client = makeClient(() => new Promise(() => {}));
			const wrapper = new MCPToolWrapper(client, 'srv', { name: 'slow_thing' });

			const settled = wrapper.execute({ q: 'x' }, {} as any);
			await vi.advanceTimersByTimeAsync(MCP_CALL_TOOL_TIMEOUT_MS + 50);
			const result = await settled;

			expect(result.success).toBe(false);
			expect(result.error).toContain('timed out');
			expect(result.error).toContain('slow_thing');
		});

		test('returns success=false when callTool rejects', async () => {
			const client = makeClient(() => Promise.reject(new Error('server down')));
			const wrapper = new MCPToolWrapper(client, 'srv', { name: 'do_thing' });

			const result = await wrapper.execute({}, {} as any);

			expect(result.success).toBe(false);
			expect(result.error).toContain('server down');
		});

		test('marks isError=true responses as failures', async () => {
			const client = makeClient(() =>
				Promise.resolve({
					isError: true,
					content: [{ type: 'text', text: 'bad input' }],
				})
			);
			const wrapper = new MCPToolWrapper(client, 'srv', { name: 'do_thing' });

			const result = await wrapper.execute({}, {} as any);

			expect(result.success).toBe(false);
			expect(result.error).toBe('bad input');
		});
	});

	describe('classification from annotations (#1449)', () => {
		it('derives DESTRUCTIVE from destructiveHint and EXTERNAL by default', () => {
			const client = makeClient(() => Promise.resolve({ content: [] }));
			const destructive = new MCPToolWrapper(client, 'srv', {
				name: 'remove_file',
				annotations: { destructiveHint: true },
			});
			const plain = new MCPToolWrapper(client, 'srv', { name: 'query' });
			const readOnly = new MCPToolWrapper(client, 'srv', {
				name: 'lookup',
				annotations: { readOnlyHint: true },
			});

			expect(destructive.classification).toBe(ToolClassification.DESTRUCTIVE);
			expect(plain.classification).toBe(ToolClassification.EXTERNAL);
			// readOnlyHint is never honored from an untrusted server.
			expect(readOnly.classification).toBe(ToolClassification.EXTERNAL);
		});
	});
});
