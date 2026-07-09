import type { App } from 'obsidian';

/**
 * Shape of Obsidian's internal Settings API, which the public `App` typings
 * don't expose. Declaring it here lets us reach `app.setting` through a single
 * typed cast instead of suppressing the type-check at every call site.
 */
interface AppWithSetting extends App {
	setting: {
		open(): void;
		openTabById(id: string): void;
	};
}

/**
 * Open Obsidian's Settings modal and switch to the plugin's tab.
 *
 * Obsidian's typings don't expose `App.setting`, so the internal API is reached
 * through a single typed cast. Centralising that here keeps the workaround (and
 * the plugin ID literal) in one place.
 */
export function openPluginSettingsTab(app: App, pluginId: string): void {
	const settingApp = app as AppWithSetting;
	settingApp.setting.open();
	settingApp.setting.openTabById(pluginId);
}
