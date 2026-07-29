import { describe, it, expect } from 'vitest';
import { HeadlessConfirmationProvider } from '../../src/services/headless-confirmation-provider';
import type { DiffContext, IConfirmationProvider, Tool } from '../../src/tools/types';

// This provider is the auto-approve surface every unattended run goes through
// (`HookRunner`, `ScheduledTaskRunner`, via `runHeadlessAgentTurn`). A regression
// here silently changes what a scheduled task is permitted to do while nobody is
// watching, so the assertions below are about the *decision* it returns, not about
// any rendering — it has none.

const tool = { name: 'write_file', description: 'write a file' } as unknown as Tool;

const diffContext: DiffContext = {
	filePath: 'notes/target.md',
	originalContent: 'before',
	proposedContent: 'after',
	isNewFile: false,
};

describe('HeadlessConfirmationProvider', () => {
	// Typing the binding as the interface (rather than the class) means a future
	// widening of IConfirmationProvider fails `typecheck:test` here.
	const provider: IConfirmationProvider = new HeadlessConfirmationProvider();

	describe('showConfirmationInChat', () => {
		it('auto-approves without granting a session-wide bypass', async () => {
			await expect(provider.showConfirmationInChat(tool, {}, 'exec-1')).resolves.toEqual({
				confirmed: true,
				allowWithoutConfirmation: false,
			});
		});

		// `allowWithoutConfirmation: true` is what the interactive UI returns when the
		// user ticks "don't ask again"; it persists a bypass for the rest of the
		// session. A headless run has no user to have ticked it, so this must stay
		// false — the enabledTools allowlist is the only authority.
		it('never returns allowWithoutConfirmation, whatever it is asked about', async () => {
			const results = await Promise.all([
				provider.showConfirmationInChat(tool, { path: 'a.md' }, 'exec-1'),
				provider.showConfirmationInChat(tool, { path: 'b.md' }, 'exec-2', diffContext),
				provider.showConfirmationInChat({ name: 'delete_file' } as unknown as Tool, {}, 'exec-3'),
			]);

			for (const result of results) {
				expect(result.allowWithoutConfirmation).toBe(false);
				expect(result.confirmed).toBe(true);
			}
		});

		it('approves a destructive diff without surfacing edited content', async () => {
			const result = await provider.showConfirmationInChat(tool, { path: 'notes/target.md' }, 'exec-4', diffContext);

			// No user edited anything — the runner must write the model's proposed
			// content, not a `finalContent` this provider invented.
			expect(result.finalContent).toBeUndefined();
			expect(result.userEdited).toBeUndefined();
		});
	});

	describe('isToolAllowedWithoutConfirmation', () => {
		// The provider is deliberately unconditional: ASK_USER-class tools are
		// filtered out upstream by `toolRegistry.getAutoApprovedTools()` before the
		// loop ever runs, so anything that reaches here is already APPROVE-class.
		it.each(['read_file', 'write_file', 'delete_file', 'a_tool_that_does_not_exist', ''])(
			'reports %o as allowed',
			(toolName) => {
				expect(provider.isToolAllowedWithoutConfirmation(toolName)).toBe(true);
			}
		);
	});

	describe('statelessness', () => {
		it('is unaffected by allowToolWithoutConfirmation', () => {
			const fresh: IConfirmationProvider = new HeadlessConfirmationProvider();

			expect(() => fresh.allowToolWithoutConfirmation('delete_file')).not.toThrow();
			// Same answer before and after — there is no accumulated grant state that a
			// later run could inherit.
			expect(fresh.isToolAllowedWithoutConfirmation('delete_file')).toBe(true);
			expect(fresh.isToolAllowedWithoutConfirmation('some_other_tool')).toBe(true);
		});

		it('accepts progress updates as a no-op', () => {
			expect(() => provider.updateProgress?.('Reading notes/target.md', 'running')).not.toThrow();
		});

		it('two instances answer identically', async () => {
			const a: IConfirmationProvider = new HeadlessConfirmationProvider();
			const b: IConfirmationProvider = new HeadlessConfirmationProvider();
			a.allowToolWithoutConfirmation('write_file');

			await expect(a.showConfirmationInChat(tool, {}, 'exec-a')).resolves.toEqual(
				await b.showConfirmationInChat(tool, {}, 'exec-b')
			);
		});
	});

	describe('IConfirmationProvider contract', () => {
		it('implements every member AgentLoop may call', () => {
			const instance = new HeadlessConfirmationProvider();

			expect(typeof instance.showConfirmationInChat).toBe('function');
			expect(typeof instance.isToolAllowedWithoutConfirmation).toBe('function');
			expect(typeof instance.allowToolWithoutConfirmation).toBe('function');
			// Optional on the interface, but the headless runners rely on it existing.
			expect(typeof instance.updateProgress).toBe('function');
		});

		it('resolves rather than returning a bare value', () => {
			expect(new HeadlessConfirmationProvider().showConfirmationInChat(tool, {}, 'exec-1')).toBeInstanceOf(Promise);
		});
	});
});
