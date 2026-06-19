import type { ConfirmationResult, DiffContext, IConfirmationProvider, Tool } from '../tools/types';

/**
 * Auto-approve all tool confirmations for headless agent runs.
 *
 * Shared by `HookRunner` and `ScheduledTaskRunner`: both run unattended with an
 * explicit `enabledTools` allowlist authored by the user, so there's no surface
 * on which to display a mid-run confirmation dialog. ASK_USER tools are filtered
 * out upstream via `toolRegistry.getAutoApprovedTools()` before reaching the
 * loop, so this provider only ever sees APPROVE-class tools.
 */
export class HeadlessConfirmationProvider implements IConfirmationProvider {
	// Full signatures (rather than zero-arg stubs) pin this class to the real
	// IConfirmationProvider contract — future additions to the interface will
	// break compilation here instead of silently passing.
	async showConfirmationInChat(
		_tool: Tool,
		_parameters: unknown,
		_executionId: string,
		_diffContext?: DiffContext
	): Promise<ConfirmationResult> {
		return { confirmed: true, allowWithoutConfirmation: false };
	}
	isToolAllowedWithoutConfirmation(_toolName: string): boolean {
		return true;
	}
	allowToolWithoutConfirmation(_toolName: string): void {
		/* no-op */
	}
	updateProgress(_message: string, _status: string): void {
		/* no-op */
	}
}
