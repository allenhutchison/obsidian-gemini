import type { App } from 'obsidian';

/**
 * Open Obsidian's Settings modal and switch to the plugin's tab.
 *
 * Obsidian's typings don't expose `App.setting`, so each call site has to
 * suppress the type-check twice. Centralising that here keeps the workaround
 * (and the plugin ID literal) in one place.
 */
export function openPluginSettingsTab(app: App, pluginId: string): void {
	// @ts-expect-error - Obsidian's setting API is internal and not in typings
	app.setting.open();
	// @ts-expect-error - Obsidian's setting API is internal and not in typings
	app.setting.openTabById(pluginId);
}
