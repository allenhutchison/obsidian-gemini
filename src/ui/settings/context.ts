/**
 * WP3 STUB — WP2 owns this file (`src/ui/settings/context.ts` +
 * `src/ui/settings/writer-types.ts`); replaced at integration.
 *
 * WP3 (this work package) builds the remaining settings sub-pages
 * (Vault search index, Scheduled tasks, Lifecycle hooks, MCP servers, Tool
 * permissions, Advanced) concurrently with WP2, which owns the settings-tab
 * shell, the Providers/Features pages, and the real `SettingsContext` /
 * `SettingWriter` declarations (settings-redesign design doc §5.2/§5.3).
 * WP2's files don't exist yet in this worktree, so this is a minimal local
 * copy of the same shapes — just enough for WP3's page modules and tests to
 * compile and run in isolation. Delete this file once WP2's real
 * `context.ts` / `writer-types.ts` land and re-point WP3's imports at them.
 */

import type { App } from 'obsidian';
import type { ObsidianGemini } from '../../types/plugin';

/**
 * Shared context threaded through every settings page-builder function
 * (`vaultIndexPage(ctx)`, `toolPermissionsPage(ctx)`, ...).
 */
export interface SettingsContext {
	plugin: ObsidianGemini;
	app: App;
	/**
	 * Narrow surface of the setting tab a page needs to trigger a re-render
	 * or a cheap in-place DOM refresh. Typed as a structural slice — never
	 * the concrete tab class — so page modules never import `index.ts`
	 * (which imports them), per AGENTS.md's leaf-module rule and the
	 * `lint:cycles` baseline of 0.
	 */
	tab: {
		update(): void;
		refreshDomState(): void;
	};
}

/**
 * A write handler for one dotted settings path, or a `*`-wildcard pattern
 * (e.g. `toolPolicy.toolPermissions.*`). Mutates `plugin.settings` in place
 * and reports whether the change is structural. The tab awaits
 * `plugin.saveSettings()` and then calls `update()` (when `needsUpdate` is
 * true) or `refreshDomState()` (otherwise) — never the writer itself.
 */
export type SettingWriter = (plugin: ObsidianGemini, key: string, value: unknown) => Promise<{ needsUpdate: boolean }>;
