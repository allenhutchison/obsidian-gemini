/**
 * Shared context threaded through every settings page/module (settings
 * redesign design doc §5.3). Published on day one alongside `writer-types.ts`
 * so WP3's page modules can compile before the rest of the settings-UI
 * package exists.
 *
 * Leaf module: page modules (`page-*.ts`) import `SettingsContext` from here,
 * never from `index.ts` — `index.ts` imports the page modules, so the reverse
 * import would be a cycle (`npm run lint:cycles`).
 */

import type { App } from 'obsidian';
import type { ObsidianGemini } from '../../types/plugin';

/**
 * The subset of the setting tab's own API page modules need. Typed
 * structurally (not as the concrete tab class) for the same leaf-module
 * reason as the rest of this file — `index.ts` is what implements this
 * shape, and nothing here imports it back.
 */
export interface SettingsTabHandle {
	/** Re-evaluate `getSettingDefinitions()` and re-render. Call after a change that adds/removes/reorders rows. */
	update(): void;
	/** Re-evaluate `visible`/`disabled`/`displayValue`/`status` predicates in place, with no re-render. */
	refreshDomState(): void;
}

/** Threaded into every `*Page(ctx)` / `*(ctx)` builder function. */
export interface SettingsContext {
	plugin: ObsidianGemini;
	app: App;
	tab: SettingsTabHandle;
}
