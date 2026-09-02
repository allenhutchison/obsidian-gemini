import { describe, it, expect } from 'vitest';
import { classificationFromAnnotations, type MCPToolAnnotations } from '../../src/mcp/mcp-classification';
import { ToolClassification } from '../../src/types/tool-policy';

describe('classificationFromAnnotations', () => {
	it('maps destructiveHint to DESTRUCTIVE — the only honored hint (#1449)', () => {
		const annotations: MCPToolAnnotations = {
			destructiveHint: true,
			readOnlyHint: false,
			idempotentHint: false,
			openWorldHint: true,
		};
		expect(classificationFromAnnotations(annotations)).toBe(ToolClassification.DESTRUCTIVE);
	});

	it('honors destructiveHint even when readOnlyHint claims the opposite', () => {
		// A self-contradicting server: destructive wins, since the mapping can
		// only make tools stricter.
		expect(classificationFromAnnotations({ readOnlyHint: true, destructiveHint: true })).toBe(
			ToolClassification.DESTRUCTIVE
		);
	});

	it('maps readOnlyHint to EXTERNAL — never honored from an untrusted server', () => {
		// The MCP spec's own doc block warns against making tool-use decisions
		// from annotations received from untrusted servers; promoting to READ
		// would auto-approve a tool under Cautious/Edit mode on a server's
		// say-so (maintainer decision, option (a)).
		expect(classificationFromAnnotations({ readOnlyHint: true })).toBe(ToolClassification.EXTERNAL);
	});

	it('defaults to EXTERNAL for absent annotations — preserving pre-#1449 behavior', () => {
		expect(classificationFromAnnotations(undefined)).toBe(ToolClassification.EXTERNAL);
		expect(classificationFromAnnotations({})).toBe(ToolClassification.EXTERNAL);
	});

	it('defaults to EXTERNAL when hints are false or unrelated', () => {
		expect(classificationFromAnnotations({ readOnlyHint: false, destructiveHint: false })).toBe(
			ToolClassification.EXTERNAL
		);
		expect(classificationFromAnnotations({ idempotentHint: true, openWorldHint: false })).toBe(
			ToolClassification.EXTERNAL
		);
	});

	it('never returns a band more permissive than EXTERNAL (no under-gating path)', () => {
		const inputs: MCPToolAnnotations[] = [
			{},
			{ readOnlyHint: true },
			{ idempotentHint: true },
			{ openWorldHint: true },
			{ readOnlyHint: true, idempotentHint: true, openWorldHint: true },
			{ destructiveHint: false, readOnlyHint: true },
		];
		for (const annotations of inputs) {
			const result = classificationFromAnnotations(annotations);
			expect([ToolClassification.EXTERNAL, ToolClassification.DESTRUCTIVE]).toContain(result);
		}
	});
});
