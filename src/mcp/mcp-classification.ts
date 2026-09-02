import { ToolClassification } from '../types/tool-policy';

/**
 * Tool annotations as advertised by an MCP server (`Tool.annotations` in the
 * MCP spec, carried on `Tool` by the SDK's `ToolSchema`). All four flags are
 * *hints* supplied by the server — the untrusted party — and the SDK's own doc
 * block warns: "Clients should never make tool use decisions based on
 * ToolAnnotations received from untrusted servers."
 *
 * A leaf module (imports nothing) so the mapper is unit-testable without an
 * MCP client.
 */
export interface MCPToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/**
 * Map MCP tool annotations to the plugin's ToolClassification — the axis the
 * permission presets and the execution-sort priority both resolve on (#1449).
 *
 * Trust policy (maintainer decision, option (a)): only `destructiveHint` is
 * honored, so the mapping can only ever make a tool *stricter* (EXTERNAL →
 * DESTRUCTIVE raises confirmation in every preset and moves the tool into the
 * correct execution-sort band behind native writes). A lying server only
 * hurts itself. `readOnlyHint` is deliberately NOT honored: promoting a tool
 * to READ on a server's say-so would auto-approve it under Cautious/Edit mode
 * — the exact untrusted-hint decision the MCP spec warns against.
 *
 * Everything else — absent annotations, unknown shapes, false hints — maps to
 * EXTERNAL, preserving the pre-#1449 behavior as the default. There is no
 * under-gating path: the mapper never returns a band more permissive than
 * EXTERNAL.
 */
export function classificationFromAnnotations(annotations: MCPToolAnnotations | undefined): ToolClassification {
	if (annotations?.destructiveHint === true) {
		return ToolClassification.DESTRUCTIVE;
	}
	return ToolClassification.EXTERNAL;
}
